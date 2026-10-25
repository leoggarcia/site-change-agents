"""The Intake Agent as a LangGraph graph.

    START -> retrieve -> decide --(invalid reply, retry)--> decide
                           |
                           +-- ask_client -> (graph pauses until the client answers) -> retrieve
                           +-- create_ticket   -> END
                           +-- out_of_scope    -> END
                           +-- hand_off        -> END   (still unclear after MAX_QUESTIONS, or invalid replies)

retrieve:   code, no model. Project summary plus RAG over the client's knowledge and the site's code.
decide:     one model call with structured output (IntakeDecision). The reply is checked by Pydantic and
            by our own rules; when it fails, the error is sent back to the model on the next attempt.
ask_client: calls interrupt(). The graph stops, a checkpointer saves its state, and the question goes to
            the client. When the answer arrives, the graph is resumed from that saved state.
"""

import operator
from collections.abc import Callable
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from change_agents.intake.context import IntakeContext
from change_agents.intake.prompts import INTAKE_PROMPT, RETRY_PROMPT
from change_agents.intake.schema import IntakeDecision, decision_schema
from change_agents.llm import add_usage

MAX_QUESTIONS = 3
MAX_ATTEMPTS = 3

Retriever = Callable[[str, str], IntakeContext]


class QA(TypedDict):
    question: str
    answer: str


class IntakeState(TypedDict):
    site_id: str
    request: str
    # operator.add appends: each answered question is added to the list instead of replacing it.
    qa: Annotated[list[QA], operator.add]
    context: IntakeContext | None
    # Plain dicts, not Pydantic objects: the checkpointer stores the state as JSON-like data.
    decision: dict[str, Any] | None
    error: str | None
    attempts: int
    outcome: dict[str, Any] | None
    usage: dict[str, int]


def _render(state: IntakeState) -> str:
    context = state["context"]
    assert context is not None
    conversation = "\n".join(
        f"Q{i}: {item['question']}\nA{i}: {item['answer']}" for i, item in enumerate(state["qa"], start=1)
    )
    return (
        f"<project_summary>\n{context['project_summary']}\n</project_summary>\n\n"
        f"<client_knowledge>\n{context['client_knowledge']}\n</client_knowledge>\n\n"
        f"<site_search>\n{context['site_search']}\n</site_search>\n\n"
        f"<client_request>\n{state['request']}\n</client_request>\n\n"
        f"<conversation>\n{conversation or '(no questions asked yet)'}\n</conversation>\n\n"
        f"Questions you may still ask: {MAX_QUESTIONS - len(state['qa'])}"
    )


def check_rules(decision: IntakeDecision, routes: list[str]) -> str | None:
    """Rules Pydantic can't know because they depend on the site. Returns an error for the model, or None."""
    if decision.ticket and routes and decision.ticket.target.page not in [*routes, "global"]:
        allowed = ", ".join(f'"{route}"' for route in [*routes, "global"])
        return f'ticket.target.page "{decision.ticket.target.page}" is not a page of this site. Use one of: {allowed}.'
    return None


def build_intake_graph(
    model: BaseChatModel,
    retrieve_context: Retriever,
    checkpointer: BaseCheckpointSaver | None = None,
    max_questions: int = MAX_QUESTIONS,
) -> CompiledStateGraph:

    def retrieve(state: IntakeState) -> dict:
        query = " ".join([state["request"], *(item["answer"] for item in state["qa"])])
        return {"context": retrieve_context(state["site_id"], query), "error": None, "attempts": 0}

    def decide(state: IntakeState) -> dict:
        messages = [SystemMessage(INTAKE_PROMPT), HumanMessage(_render(state))]
        if state["error"]:
            messages.append(HumanMessage(RETRY_PROMPT.format(error=state["error"])))
        routes = state["context"]["routes"]
        # The schema lists this site's pages, so the model can only pick a real one.
        decider = model.with_structured_output(decision_schema(tuple(routes)), include_raw=True)
        result = decider.invoke(messages)

        decision: IntakeDecision | None = result["parsed"]
        error = str(result["parsing_error"]) if decision is None else check_rules(decision, routes)
        return {
            "decision": decision.model_dump() if decision and not error else None,
            "error": error,
            "attempts": state["attempts"] + 1,
            "usage": add_usage(state["usage"], result["raw"]),
        }

    def after_decide(state: IntakeState) -> Literal["decide", "ask_client", "create_ticket", "out_of_scope", "hand_off"]:
        if state["error"]:
            return "decide" if state["attempts"] < MAX_ATTEMPTS else "hand_off"
        action = state["decision"]["action"]
        if action == "ask_client":
            # The question limit lives in code: the model can't keep asking forever.
            return "ask_client" if len(state["qa"]) < max_questions else "hand_off"
        return action

    def ask_client(state: IntakeState) -> dict:
        question = state["decision"]["question"]
        # Pauses the graph here. On resume this node runs again from the top, and interrupt()
        # returns the client's answer instead of pausing, so nothing before it may have side effects.
        answer = interrupt({"question": question, "number": len(state["qa"]) + 1, "max": max_questions})
        return {"qa": [{"question": question, "answer": str(answer).strip()}]}

    def _finish(decision: dict[str, Any] | None, status: str, **fields: Any) -> dict:
        decision = decision or {}
        outcome = {"status": status, **fields, "reasoning": decision.get("reasoning"), "sources": decision.get("sources", [])}
        return {"outcome": outcome}

    def create_ticket(state: IntakeState) -> dict:
        return _finish(state["decision"], "ticket", ticket=state["decision"]["ticket"])

    def out_of_scope(state: IntakeState) -> dict:
        return _finish(state["decision"], "out_of_scope", message=state["decision"]["client_message"])

    def hand_off(state: IntakeState) -> dict:
        if state["error"]:
            message = f"The intake model gave {MAX_ATTEMPTS} invalid replies in a row. Last error: {state['error']}"
        else:
            message = f"The request is still unclear after {max_questions} questions."
        return _finish(state["decision"], "needs_human", message=message)

    graph = StateGraph(IntakeState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("decide", decide)
    graph.add_node("ask_client", ask_client)
    graph.add_node("create_ticket", create_ticket)
    graph.add_node("out_of_scope", out_of_scope)
    graph.add_node("hand_off", hand_off)
    graph.add_edge(START, "retrieve")
    graph.add_edge("retrieve", "decide")
    graph.add_conditional_edges("decide", after_decide)
    graph.add_edge("ask_client", "retrieve")
    for node in ("create_ticket", "out_of_scope", "hand_off"):
        graph.add_edge(node, END)
    return graph.compile(checkpointer=checkpointer)


def initial_state(site_id: str, request: str) -> IntakeState:
    return {
        "site_id": site_id,
        "request": request,
        "qa": [],
        "context": None,
        "decision": None,
        "error": None,
        "attempts": 0,
        "outcome": None,
        "usage": {},
    }
