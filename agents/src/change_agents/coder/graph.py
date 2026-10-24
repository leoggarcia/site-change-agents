"""The Coder Agent as a LangGraph graph.

    START -> locate -> plan --(not feasible)--> hand_off -> END
                         |
                         v
                       edit <-> tools          (the model reads, searches and edits, in a loop)
                         |
                         v
                       check --(build failed, rounds left)--> edit
                         |
                         +--(build passed)--> commit -> END
                         +--(no changes / diff too big / build still failing)--> hand_off -> END

locate: code, no model. RAG finds the files that look relevant and they are read in full, so the model
        starts with the right files instead of spending calls exploring.
plan:   one structured-output call (ChangePlan). Planned files are checked against the policy.
edit:   a tool-calling loop (ReAct) with a turn limit and a token budget, both in code.
check:  code. Diff size limits, then `npm run build`. A failed build goes back to the model with the error.

There is no checkpointer: the graph's work lives in files on disk. A retried job starts over from a
fresh clone, which is simpler and always consistent.
"""

from collections.abc import Callable
from typing import Annotated, Any, Literal, Protocol, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode

from change_agents.coder.policy import ChangeLimits, path_problem
from change_agents.coder.prompts import BUILD_FAILED, CODER_PROMPT, PLAN_PROMPT, PLAN_RETRY
from change_agents.coder.schema import ChangePlan
from change_agents.coder.tools import Editor
from change_agents.coder.workspace import BuildResult, DiffStat
from change_agents.llm import add_usage

MAX_EDIT_TURNS = 12  # model calls in the edit loop, across all build rounds
MAX_FIX_ROUNDS = 3  # builds that may fail and go back to the model
MAX_PLAN_ATTEMPTS = 2
MAX_INPUT_TOKENS = 200_000  # per ticket; stops a runaway loop before it burns the quota

Locator = Callable[[dict[str, Any]], str]


class WorkspaceLike(Protocol):
    def build(self) -> BuildResult: ...
    def diff_stat(self) -> DiffStat: ...
    def commit(self, message: str) -> str: ...


class CoderState(TypedDict):
    ticket: dict[str, Any]
    context: str
    plan: dict[str, Any] | None
    plan_error: str | None
    plan_attempts: int
    messages: Annotated[list[AnyMessage], add_messages]
    turns: int
    build_rounds: int
    build_output: str | None
    stop_reason: str | None
    outcome: dict[str, Any] | None
    usage: dict[str, int]


def ticket_text(ticket: dict[str, Any]) -> str:
    criteria = "\n".join(f"- {item}" for item in ticket.get("acceptance_criteria") or [])
    target = ticket.get("target") or {}
    return (
        "<ticket>\n"
        f"Summary: {ticket['summary']}\n"
        f"Type: {ticket.get('change_type') or 'unknown'}\n"
        f"Where: {target.get('page', '?')} › {target.get('section', '?')}\n"
        f"Details: {ticket.get('details') or ''}\n"
        f"Done when:\n{criteria or '- (not given)'}\n"
        "</ticket>"
    )


def _final_text(messages: list[AnyMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, AIMessage) and not message.tool_calls and message.text.strip():
            return message.text.strip()
    return ""


def build_coder_graph(
    model: BaseChatModel,
    tools: list[BaseTool],
    editor: Editor,
    workspace: WorkspaceLike,
    locate_files: Locator,
    limits: ChangeLimits = ChangeLimits(),
) -> CompiledStateGraph:
    planner = model.with_structured_output(ChangePlan, include_raw=True)
    coder = model.bind_tools(tools)

    def locate(state: CoderState) -> dict:
        return {"context": locate_files(state["ticket"])}

    def plan(state: CoderState) -> dict:
        messages = [SystemMessage(PLAN_PROMPT), HumanMessage(f"{ticket_text(state['ticket'])}\n\n{state['context']}")]
        if state["plan_error"]:
            messages.append(HumanMessage(PLAN_RETRY.format(error=state["plan_error"])))
        result = planner.invoke(messages)
        parsed: ChangePlan | None = result["parsed"]
        error = str(result["parsing_error"]) if parsed is None else None
        if parsed and parsed.feasible:
            # The plan is checked against the policy before any edit, in code.
            problems = [problem for step in parsed.steps if (problem := path_problem(step.file))]
            error = " ".join(problems) or None
        return {
            "plan": parsed.model_dump() if parsed and not error else None,
            "plan_error": error,
            "plan_attempts": state["plan_attempts"] + 1,
            "usage": add_usage(state["usage"], result["raw"]),
        }

    def after_plan(state: CoderState) -> Literal["plan", "edit", "hand_off"]:
        if state["plan_error"]:
            return "plan" if state["plan_attempts"] < MAX_PLAN_ATTEMPTS else "hand_off"
        return "edit" if state["plan"]["feasible"] else "hand_off"

    def edit(state: CoderState) -> dict:
        new: list[AnyMessage] = []
        if not state["messages"]:
            steps = "\n".join(f"- {step['action']} {step['file']}: {step['what']}" for step in state["plan"]["steps"])
            new.append(HumanMessage(f"{ticket_text(state['ticket'])}\n\n<plan>\n{steps}\n</plan>\n\n{state['context']}"))
        response = coder.invoke([SystemMessage(CODER_PROMPT), *state["messages"], *new])
        return {"messages": [*new, response], "turns": state["turns"] + 1, "usage": add_usage(state["usage"], response)}

    def after_edit(state: CoderState) -> Literal["tools", "check"]:
        last = state["messages"][-1]
        wants_tools = isinstance(last, AIMessage) and bool(last.tool_calls)
        within_limits = state["turns"] < MAX_EDIT_TURNS and state["usage"].get("input_tokens", 0) < MAX_INPUT_TOKENS
        # Limits live in code: out of turns or tokens, whatever was done so far goes to the build check.
        return "tools" if wants_tools and within_limits else "check"

    def check(state: CoderState) -> dict:
        if not editor.changed:
            return {"stop_reason": "The agent finished without changing any file."}
        stat = workspace.diff_stat()
        if stat.changed_lines > limits.max_changed_lines:
            return {"stop_reason": f"The change is too big ({stat.changed_lines} lines; the limit is {limits.max_changed_lines})."}

        build = workspace.build()
        rounds = state["build_rounds"] + 1
        if build.passed:
            return {"build_rounds": rounds, "build_output": None, "stop_reason": None}
        if rounds > MAX_FIX_ROUNDS or state["turns"] >= MAX_EDIT_TURNS:
            return {"build_rounds": rounds, "build_output": build.output, "stop_reason": "The build still fails after the fixes."}
        return {
            "build_rounds": rounds,
            "build_output": build.output,
            "messages": [HumanMessage(BUILD_FAILED.format(output=build.output))],
        }

    def after_check(state: CoderState) -> Literal["edit", "commit", "hand_off"]:
        if state["stop_reason"]:
            return "hand_off"
        return "edit" if state["build_output"] else "commit"

    def commit(state: CoderState) -> dict:
        ticket = state["ticket"]
        summary = _final_text(state["messages"]) or state["plan"]["understanding"]
        stat = workspace.diff_stat()
        sha = workspace.commit(f"{ticket['summary']}\n\n{summary}\n\nTicket #{ticket['id']}")
        return {
            "outcome": {
                "status": "done",
                "summary": summary,
                "commit": sha,
                "files": stat.files,
                "insertions": stat.insertions,
                "deletions": stat.deletions,
                "buildRounds": state["build_rounds"],
            }
        }

    def hand_off(state: CoderState) -> dict:
        if state["plan"] and not state["plan"]["feasible"]:
            reason = f"This change can't be made automatically: {state['plan']['blocker']}"
        elif state["plan_error"]:
            reason = f"The agent could not write a valid plan: {state['plan_error']}"
        else:
            reason = state["stop_reason"] or "The agent stopped."
        return {"outcome": {"status": "needs_human", "message": reason, "buildOutput": state["build_output"]}}

    graph = StateGraph(CoderState)
    graph.add_node("locate", locate)
    graph.add_node("plan", plan)
    graph.add_node("edit", edit)
    graph.add_node("tools", ToolNode(tools))
    graph.add_node("check", check)
    graph.add_node("commit", commit)
    graph.add_node("hand_off", hand_off)
    graph.add_edge(START, "locate")
    graph.add_edge("locate", "plan")
    graph.add_conditional_edges("plan", after_plan)
    graph.add_conditional_edges("edit", after_edit)
    graph.add_edge("tools", "edit")
    graph.add_conditional_edges("check", after_check)
    graph.add_edge("commit", END)
    graph.add_edge("hand_off", END)
    return graph.compile()


def initial_state(ticket: dict[str, Any]) -> CoderState:
    return {
        "ticket": ticket,
        "context": "",
        "plan": None,
        "plan_error": None,
        "plan_attempts": 0,
        "messages": [],
        "turns": 0,
        "build_rounds": 0,
        "build_output": None,
        "stop_reason": None,
        "outcome": None,
        "usage": {},
    }
