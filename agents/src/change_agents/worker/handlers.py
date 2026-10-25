"""What each queue's jobs do. Every handler takes the job data and returns the result to report."""

from typing import Any

from bullmq.custom_errors import UnrecoverableError
from langchain_core.language_models import BaseChatModel

from change_agents.coder.runner import run_coder
from change_agents.coder.workspace import WorkspaceError
from change_agents.intake.runner import IntakeRunner, NotWaitingForAnswer
from change_agents.rag.indexing import index_code, index_knowledge
from change_agents.reviewer.runner import open_ticket_workspace, run_reviewer


def make_intake_handler(runner: IntakeRunner):  # noqa: ANN201
    def handle(data: dict[str, Any]) -> dict[str, Any]:
        try:
            if data["action"] == "start":
                return runner.start(data["threadId"], data["siteId"], data["request"])
            return runner.resume(data["threadId"], data["answer"], data.get("questionNumber"))
        except NotWaitingForAnswer as error:
            raise UnrecoverableError(str(error)) from error  # retrying can't fix it

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
        return run_coder(ticket, model, revise_commit=(data.get("revision") or {}).get("commit"))

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
        return run_reviewer(ticket, workspace, model)

    return handle
