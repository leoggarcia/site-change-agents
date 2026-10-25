"""What each queue's jobs do. Every handler takes the job data and returns the result to report."""

from typing import Any

from bullmq.custom_errors import UnrecoverableError
from langchain_core.language_models import BaseChatModel

from change_agents import tracing
from change_agents.coder.runner import run_coder
from change_agents.coder.workspace import WorkspaceError
from change_agents.intake.runner import IntakeRunner, NotWaitingForAnswer
from change_agents.rag.indexing import index_code, index_knowledge
from change_agents.reviewer.runner import open_ticket_workspace, run_reviewer


def make_intake_handler(runner: IntakeRunner):  # noqa: ANN201
    def handle(data: dict[str, Any]) -> dict[str, Any]:
        text = data.get("request") or data.get("answer")
        with tracing.trace("intake", data["ticketId"], data.get("siteId", ""), input=text) as trace:
            try:
                if data["action"] == "start":
                    result = runner.start(data["threadId"], data["siteId"], data["request"], trace.callbacks)
                else:
                    result = runner.resume(data["threadId"], data["answer"], data.get("questionNumber"), trace.callbacks)
            except NotWaitingForAnswer as error:
                raise UnrecoverableError(str(error)) from error  # retrying can't fix it
            trace.output(result)
            return result

    return handle


def make_coding_handler(model: BaseChatModel):  # noqa: ANN201
    def handle(data: dict[str, Any]) -> dict[str, Any]:
        ticket = {
            "id": data["ticketId"],
            "site_id": data["siteId"],
            "summary": data["summary"],
            "details": data["details"],
            "change_type": data.get("changeType"),
            "target": data.get("target"),
            "acceptance_criteria": data.get("acceptanceCriteria") or [],
            "feedback": (data.get("revision") or {}).get("feedback") or [],
        }
        with tracing.trace("coder", data["ticketId"], data["siteId"], input=ticket) as trace:
            result = run_coder(ticket, model, revise_commit=(data.get("revision") or {}).get("commit"), callbacks=trace.callbacks)
            trace.output(result)
            return result

    return handle


def reindex(data: dict[str, Any]) -> dict[str, Any]:
    """Re-embeds only what changed (Phase 2.5's incremental indexing), so a reindex is cheap."""
    site_id = data["siteId"]
    return {"status": "done", "code": index_code(site_id, "contextual"), "knowledge": index_knowledge(site_id)}


def make_review_handler(model: BaseChatModel):  # noqa: ANN201
    def handle(data: dict[str, Any]) -> dict[str, Any]:
        ticket = {
            "id": data["ticketId"],
            "site_id": data["siteId"],
            "summary": data["summary"],
            "details": data["details"],
            "acceptance_criteria": data.get("acceptanceCriteria") or [],
            "request": data["request"],
            "conversation": data.get("conversation") or [],
            "client_feedback": data.get("clientFeedback") or [],
        }
        try:
            workspace = open_ticket_workspace(data["siteId"], data["ticketId"], data["branch"], data["commit"])
        except WorkspaceError as error:
            raise UnrecoverableError(str(error)) from error  # the branch is gone; retrying can't bring it back
        with tracing.trace("reviewer", data["ticketId"], data["siteId"], input=ticket) as trace:
            result = run_reviewer(ticket, workspace, model, callbacks=trace.callbacks)
            trace.output(result)
            return result

    return handle
