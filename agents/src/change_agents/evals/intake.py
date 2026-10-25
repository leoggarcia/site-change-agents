"""Evaluates the Intake Agent on the golden dataset.

Each case runs the real graph (real model, real RAG) with an in-memory checkpointer. A simulated client
answers the agent's questions from the case's `answers`, in order, and says "I don't know." when they run out.
Scoring is deterministic: no model judges another model here.
"""

import time
from typing import Any

from langchain_core.language_models import BaseChatModel
from langgraph.checkpoint.memory import InMemorySaver

from change_agents.intake.context import load_context
from change_agents.intake.graph import Retriever, build_intake_graph
from change_agents.intake.runner import IntakeRunner

OUTCOMES = {"ticket": "ticket", "out_of_scope": "out_of_scope", "needs_human": "needs_human"}


def frozen_retriever(context: dict[str, Any]) -> Retriever:
    """Always returns the context saved for the case, so the eval needs no database and tests the agent alone.
    (Live retrieval runs again after each answer; the frozen one keeps the first turn's context.)"""
    return lambda site_id, query: context


def run_case(case: dict[str, Any], model: BaseChatModel, retriever: Retriever = load_context) -> dict[str, Any]:
    runner = IntakeRunner(build_intake_graph(model, retriever, InMemorySaver()))
    answers = list(case.get("answers") or [])
    started = time.monotonic()
    result = runner.start(f"eval-{case['id']}", case["site"], case["request"])
    questions: list[str] = []
    while result["status"] == "question":
        questions.append(result["question"])
        result = runner.resume(f"eval-{case['id']}", answers.pop(0) if answers else "I don't know.")
    return {
        "outcome": OUTCOMES.get(result["status"], result["status"]),
        "questions": questions,
        "ticket": result.get("ticket"),
        "message": result.get("message"),
        "usage": result.get("usage", {}),
        "seconds": round(time.monotonic() - started, 1),
    }


def _ticket_text(ticket: dict[str, Any] | None) -> str:
    if not ticket:
        return ""
    target = ticket.get("target") or {}
    parts = [ticket.get("summary"), ticket.get("details"), target.get("page"), target.get("section"), *(ticket.get("acceptance_criteria") or [])]
    return " ".join(str(part) for part in parts if part).lower()


def _matches(text: str, alternatives: str) -> bool:
    """`alternatives` is "a|b|c": any of them, case-insensitive."""
    return any(option.lower() in text for option in alternatives.split("|"))


def score(case: dict[str, Any], run: dict[str, Any]) -> dict[str, Any]:
    """One check per expectation; None means the case doesn't test it."""
    expect = case["expect"]
    allowed = expect["outcome"] if isinstance(expect["outcome"], list) else [expect["outcome"]]
    text = _ticket_text(run["ticket"])
    is_ticket = run["outcome"] == "ticket"

    checks: dict[str, bool | None] = {
        "outcome": run["outcome"] in allowed,
        "asks": None if expect.get("asks") is None else bool(run["questions"]) == expect["asks"],
        "change_type": (
            _matches(run["ticket"]["change_type"], expect["change_type"]) if is_ticket and expect.get("change_type") else None
        ),
        "mentions": all(_matches(text, item) for item in expect["mentions"]) if is_ticket and expect.get("mentions") else None,
        "forbids": not any(item.lower() in text for item in expect["forbids"]) if expect.get("forbids") else None,
    }
    failed = [name for name, ok in checks.items() if ok is False]
    return {"checks": checks, "passed": not failed, "failed": failed}


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate metrics over scored cases (each row has case, run and score)."""

    def rate(values: list[bool]) -> float | None:
        return round(sum(values) / len(values), 3) if values else None

    expected_oos = [row for row in rows if row["case"]["expect"]["outcome"] == "out_of_scope"]
    predicted_oos = [row for row in rows if row["run"]["outcome"] == "out_of_scope"]
    should_ask = [row for row in rows if row["case"]["expect"].get("asks") is True]
    should_not_ask = [row for row in rows if row["case"]["expect"].get("asks") is False]
    tickets = [row for row in rows if row["score"]["checks"]["mentions"] is not None]
    usage = [row["run"]["usage"] for row in rows]
    return {
        "cases": len(rows),
        "pass_rate": rate([row["score"]["passed"] for row in rows]),
        "outcome_accuracy": rate([bool(row["score"]["checks"]["outcome"]) for row in rows]),
        "out_of_scope_recall": rate([row["run"]["outcome"] == "out_of_scope" for row in expected_oos]),
        "out_of_scope_precision": rate([row["case"]["expect"]["outcome"] == "out_of_scope" for row in predicted_oos]),
        "asks_when_needed": rate([bool(row["run"]["questions"]) for row in should_ask]),
        "no_needless_questions": rate([not row["run"]["questions"] for row in should_not_ask]),
        "ticket_values_correct": rate([bool(row["score"]["checks"]["mentions"]) for row in tickets]),
        "avg_model_calls": round(sum(item.get("model_calls", 0) for item in usage) / len(rows), 2),
        "avg_input_tokens": round(sum(item.get("input_tokens", 0) for item in usage) / len(rows)),
        "avg_output_tokens": round(sum(item.get("output_tokens", 0) for item in usage) / len(rows)),
        "avg_seconds": round(sum(row["run"]["seconds"] for row in rows) / len(rows), 1),
    }
