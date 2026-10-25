"""Wraps a stage's work (plain sync code) into a BullMQ processor.

Every job goes through the same steps:
1. Run the handler in a thread with a time limit. Agents are sync code (LangGraph, psycopg); running them
   in a thread keeps the event loop free, so BullMQ can keep renewing the job's lock while the model thinks.
2. Report what happened to the API through the results queue: the result, or "retrying" / "failed".
3. Re-raise errors, so BullMQ retries the job with backoff, or moves it to failed after the last attempt.

The API owns the tickets: workers never change a ticket's status, they only report.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from bullmq.custom_errors import UnrecoverableError

from change_agents import tracing
from change_agents.llm import is_daily_quota_error

logger = logging.getLogger(__name__)

Handler = Callable[[dict[str, Any]], dict[str, Any]]
Report = Callable[[str, dict[str, Any]], Awaitable[None]]
"""(report_id, payload) -> None. The report id makes reports idempotent if a job runs twice."""


class StageTimeout(Exception):
    pass


def make_processor(stage: str, handler: Handler, timeout_seconds: float, report: Report):  # noqa: ANN201
    async def process(job: Any, token: str) -> dict[str, Any]:
        attempt = job.attemptsMade + 1
        attempts = job.opts.get("attempts", 1)
        base = {"stage": stage, "jobId": job.id, "ticketId": job.data.get("ticketId"), "attempt": attempt, "attempts": attempts}
        logger.info("%s job %s: attempt %s of %s", stage, job.id, attempt, attempts)

        try:
            # The thread keeps running after a timeout (Python can't kill threads); its result is ignored.
            result = await asyncio.wait_for(asyncio.to_thread(handler, job.data), timeout_seconds)
        except Exception as error:
            await asyncio.to_thread(tracing.flush)
            if isinstance(error, TimeoutError):
                error = StageTimeout(f"no result after {timeout_seconds:g} seconds")
            elif is_daily_quota_error(error):
                # Retrying in a few seconds can't help; stop now so a person can decide.
                error = UnrecoverableError(f"The model's daily quota is used up: {str(error)[:200]}")
            will_retry = attempt < attempts and not isinstance(error, UnrecoverableError)
            outcome = "retrying" if will_retry else "failed"
            logger.warning("%s job %s %s: %s: %s", stage, job.id, outcome, type(error).__name__, error)
            await report(
                f"{stage}-{job.id}-attempt-{attempt}",
                {**base, "result": {"status": outcome, "error": f"{type(error).__name__}: {error}"[:500]}},
            )
            raise error

        await asyncio.to_thread(tracing.flush)  # send this job's trace now, not whenever the batch fills
        await report(f"{stage}-{job.id}-result", {**base, "result": result})
        return result

    return process
