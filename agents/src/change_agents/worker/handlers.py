"""What each queue's jobs do. Every handler takes the job data and returns the result to report."""

import random
import time
from typing import Any

from bullmq.custom_errors import UnrecoverableError
from langchain_core.language_models import BaseChatModel

from change_agents.coder.runner import run_coder
from change_agents.config import get_settings
from change_agents.intake.runner import IntakeRunner, NotWaitingForAnswer
from change_agents.rag.indexing import index_code, index_knowledge


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
        }
        return run_coder(ticket, model)

    return handle


def reindex(data: dict[str, Any]) -> dict[str, Any]:
    """Re-embeds only what changed (Phase 2.5's incremental indexing), so a reindex is cheap."""
    site_id = data["siteId"]
    return {"status": "done", "code": index_code(site_id, "contextual"), "knowledge": index_knowledge(site_id)}


# Stand-in until the Reviewer Agent exists (Phase 6). It takes a few seconds, and fails now and then
# when STUB_FAILURE_RATE is set, so retries can be seen working.


def _maybe_fail(stage: str) -> None:
    if random.random() < get_settings().stub_failure_rate:
        raise RuntimeError(f"simulated {stage} failure (STUB_FAILURE_RATE)")


def stub_review(data: dict[str, Any]) -> dict[str, Any]:
    time.sleep(random.uniform(2, 4))
    _maybe_fail("review")
    return {"status": "approved", "summary": "Stub reviewer (until Phase 6): approved without looking."}
