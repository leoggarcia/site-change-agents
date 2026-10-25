"""The Reviewer Agent as a LangGraph graph.

    START -> checks --(a blocking check failed)--> verdict -> END     (no model call)
                |
                v
             review --(invalid reply, retry)--> review
                |
                v
             verdict -> END

checks:  code. Allowed files, size, secrets, scripts, new links, then the build.
review:  one structured-output call (Review) comparing the diff with the ticket and the client's words.
verdict: code. The approval rule (`decide`) is applied to the checks and the model's judgments.
"""

from collections.abc import Callable
from typing import Any, Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from change_agents.llm import add_usage
from change_agents.reviewer.checks import BranchLike, run_checks
from change_agents.reviewer.prompts import REVIEW_PROMPT
from change_agents.reviewer.schema import Review, decide

MAX_ATTEMPTS = 2
MAX_DIFF_CHARS = 30_000

KnowledgeFetcher = Callable[[str, str], str]


class ReviewerState(TypedDict):
    ticket: dict[str, Any]
    checks: list[dict[str, Any]]
    review: dict[str, Any] | None
    error: str | None
    attempts: int
    outcome: dict[str, Any] | None
    usage: dict[str, int]


def _ticket_block(ticket: dict[str, Any]) -> str:
    criteria = "\n".join(f"- {item}" for item in ticket.get("acceptance_criteria") or []) or "- (none given)"
    # The intake questions and answers: the client may have corrected or completed the request there.
    conversation = "\n".join(
        f"Q{i}: {item['question']}\nA{i}: {item['answer']}" for i, item in enumerate(ticket.get("conversation") or [], start=1)
    )
    # What the client asked to change after seeing a preview: part of the request from then on.
    feedback = "\n".join(f"- {item}" for item in ticket.get("client_feedback") or [])
    feedback_block = f"<client_feedback>\n{feedback}\n</client_feedback>\n\n" if feedback else ""
    return (
        f"<client_request>\n{ticket.get('request') or ticket['summary']}\n</client_request>\n\n"
        f"<conversation>\n{conversation or '(no questions were asked)'}\n</conversation>\n\n"
        f"{feedback_block}"
        f"<ticket>\nSummary: {ticket['summary']}\nDetails: {ticket.get('details') or ''}\n"
        f"Acceptance criteria:\n{criteria}\n</ticket>"
    )


def _checks_block(checks: list[dict[str, Any]]) -> str:
    lines = []
    for check in checks:
        mark = "passed" if check["passed"] else ("FAILED" if check["level"] == "blocking" else "warning")
        lines.append(f"- {check['name']}: {mark}. {check['details']}")
        lines += [f"    {finding}" for finding in check["findings"][:5]]
    return "\n".join(lines)


def build_reviewer_graph(model: BaseChatModel, branch: BranchLike, fetch_knowledge: KnowledgeFetcher) -> CompiledStateGraph:
    reviewer = model.with_structured_output(Review, include_raw=True)

    def checks(state: ReviewerState) -> dict:
        return {"checks": [check.as_dict() for check in run_checks(branch)]}

    def after_checks(state: ReviewerState) -> Literal["review", "verdict"]:
        failed = any(not check["passed"] and check["level"] == "blocking" for check in state["checks"])
        return "verdict" if failed else "review"

    def review(state: ReviewerState) -> dict:
        ticket = state["ticket"]
        diff = branch.branch_diff()
        if len(diff) > MAX_DIFF_CHARS:
            diff = diff[:MAX_DIFF_CHARS] + "\n[diff truncated]"
        knowledge = fetch_knowledge(ticket["site_id"], f"{ticket['summary']} {ticket.get('details') or ''}")
        content = (
            f"{_ticket_block(ticket)}\n\n<client_knowledge>\n{knowledge}\n</client_knowledge>\n\n"
            f"<checks>\n{_checks_block(state['checks'])}\n</checks>\n\n<diff>\n{diff}\n</diff>"
        )
        messages = [SystemMessage(REVIEW_PROMPT), HumanMessage(content)]
        if state["error"]:
            messages.append(HumanMessage(f"Your previous review could not be used: {state['error']}\nReply again."))
        result = reviewer.invoke(messages)

        parsed: Review | None = result["parsed"]
        error = str(result["parsing_error"]) if parsed is None else None
        expected = len(ticket.get("acceptance_criteria") or [])
        if parsed and len(parsed.criteria) < expected:
            error = f"The ticket has {expected} acceptance criteria; review every one of them."
        return {
            "review": parsed.model_dump() if parsed and not error else None,
            "error": error,
            "attempts": state["attempts"] + 1,
            "usage": add_usage(state["usage"], result["raw"]),
        }

    def after_review(state: ReviewerState) -> Literal["review", "verdict"]:
        return "review" if state["error"] and state["attempts"] < MAX_ATTEMPTS else "verdict"

    def verdict(state: ReviewerState) -> dict:
        failed = [check for check in state["checks"] if check["level"] == "blocking" and not check["passed"]]
        if failed:
            # The checks decide alone: a failed build or a forbidden file needs no opinion.
            issues = [
                {
                    "severity": "blocker",
                    "file": None,
                    "problem": f"{check['name']} check failed: {'; '.join(check['findings'][:3])}",
                    "fix": "Undo or correct the part of the change that fails this check.",
                }
                for check in failed
            ]
            outcome = {
                "status": "changes_requested",
                "decidedBy": "checks",
                "summary": f"Automatic checks failed: {', '.join(check['name'] for check in failed)}.",
                "issues": issues,
                "criteria": [],
            }
        elif state["review"] is None:
            raise RuntimeError(f"The reviewer gave no valid review: {state['error']}")  # retried by the queue
        else:
            parsed = Review.model_validate(state["review"])
            approved = decide(parsed)
            outcome = {
                "status": "approved" if approved else "changes_requested",
                "decidedBy": "reviewer",
                "summary": parsed.summary,
                "issues": [issue.model_dump() for issue in parsed.all_issues()],
                "criteria": [item.model_dump() for item in parsed.criteria],
            }
        return {"outcome": {**outcome, "checks": state["checks"]}}

    graph = StateGraph(ReviewerState)
    graph.add_node("checks", checks)
    graph.add_node("review", review)
    graph.add_node("verdict", verdict)
    graph.add_edge(START, "checks")
    graph.add_conditional_edges("checks", after_checks)
    graph.add_conditional_edges("review", after_review)
    graph.add_edge("verdict", END)
    return graph.compile()


def initial_state(ticket: dict[str, Any]) -> ReviewerState:
    return {"ticket": ticket, "checks": [], "review": None, "error": None, "attempts": 0, "outcome": None, "usage": {}}

