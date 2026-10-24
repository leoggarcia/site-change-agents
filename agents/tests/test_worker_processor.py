import asyncio
import time
from types import SimpleNamespace

import pytest
from bullmq.custom_errors import UnrecoverableError

from change_agents.worker.processor import StageTimeout, make_processor


def job(attempts_made: int = 0, attempts: int = 3) -> SimpleNamespace:
    return SimpleNamespace(id="7", attemptsMade=attempts_made, opts={"attempts": attempts}, data={"ticketId": 42})


def run(handler, the_job: SimpleNamespace, timeout: float = 5):  # noqa: ANN001, ANN201
    reports: list[tuple[str, dict]] = []

    async def report(report_id: str, payload: dict) -> None:
        reports.append((report_id, payload))

    process = make_processor("coding", handler, timeout, report)
    try:
        return asyncio.run(process(the_job, "token")), reports
    except Exception as error:  # noqa: BLE001
        return error, reports


def failing(error: Exception):  # noqa: ANN201
    def handler(data: dict) -> dict:
        raise error

    return handler


def test_reports_the_result() -> None:
    result, reports = run(lambda data: {"status": "done"}, job())

    assert result == {"status": "done"}
    assert reports == [
        ("coding-7-result", {"stage": "coding", "jobId": "7", "ticketId": 42, "attempt": 1, "attempts": 3, "result": {"status": "done"}})
    ]


def test_reports_retrying_while_attempts_remain() -> None:
    error, reports = run(failing(RuntimeError("provider down")), job(attempts_made=1))

    assert isinstance(error, RuntimeError)  # re-raised, so BullMQ schedules the retry
    report_id, payload = reports[0]
    assert report_id == "coding-7-attempt-2"
    assert payload["result"] == {"status": "retrying", "error": "RuntimeError: provider down"}


def test_reports_failed_on_the_last_attempt() -> None:
    _, reports = run(failing(RuntimeError("provider down")), job(attempts_made=2))
    assert reports[0][1]["result"]["status"] == "failed"


def test_unrecoverable_errors_fail_at_once() -> None:
    _, reports = run(failing(UnrecoverableError("no such thread")), job(attempts_made=0))
    assert reports[0][1]["result"]["status"] == "failed"


def test_times_out() -> None:
    error, reports = run(lambda data: time.sleep(1), job(attempts_made=2), timeout=0.1)

    assert isinstance(error, StageTimeout)
    assert reports[0][1]["result"] == {"status": "failed", "error": "StageTimeout: no result after 0.1 seconds"}


@pytest.mark.parametrize("attempts_made", [0, 1])
def test_report_ids_differ_per_attempt(attempts_made: int) -> None:
    _, reports = run(failing(RuntimeError("x")), job(attempts_made=attempts_made))
    assert reports[0][0] == f"coding-7-attempt-{attempts_made + 1}"
