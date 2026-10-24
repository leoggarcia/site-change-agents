"""Usage: agents-worker

Runs one BullMQ worker per queue in this process. The API adds the jobs; results go back on RESULTS_QUEUE.
"""

import asyncio
import logging
import signal

from bullmq import Queue, Worker

from change_agents.checkpoints import postgres_checkpointer
from change_agents.config import get_settings
from change_agents.intake.context import load_context
from change_agents.intake.graph import build_intake_graph
from change_agents.intake.runner import IntakeRunner
from change_agents.llm import chat_model
from change_agents.worker.handlers import make_coding_handler, make_intake_handler, reindex, stub_review
from change_agents.worker.processor import make_processor
from change_agents.worker.watchdog import watch

# Queue names, shared with the API (api/src/queues/queues.ts).
RESULTS_QUEUE = "agent-results"

# (handler, how many jobs at once in this process, time limit in seconds)
# coding: at most 2 tickets are being coded at the same time. Model calls share one rate limiter per model.
STAGES = {
    "intake": (None, 2, 180),
    "coding": (None, 2, 900),
    "review": (stub_review, 2, 300),
    "reindex": (reindex, 1, 900),
}


async def run() -> None:
    settings = get_settings()
    connection = {"connection": settings.redis_url}
    results = Queue(RESULTS_QUEUE, connection)

    async def report(report_id: str, payload: dict) -> None:
        # The job id makes the report idempotent: if a job runs twice, the API gets one report.
        await results.add("result", payload, {"jobId": report_id, "removeOnComplete": 1000, "removeOnFail": 1000})

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    with postgres_checkpointer() as checkpointer:
        intake_graph = build_intake_graph(chat_model(settings.intake_model), load_context, checkpointer)
        handlers = {
            "intake": make_intake_handler(IntakeRunner(intake_graph)),
            "coding": make_coding_handler(chat_model(settings.coder_model)),
        }

        workers = []
        for name, (handler, concurrency, timeout) in STAGES.items():
            processor = make_processor(name, handler or handlers[name], timeout, report)
            worker = Worker(name, processor, {**connection, "concurrency": concurrency})
            # The worker reports problems in its own loop (e.g. lost Redis connections) only through this event.
            worker.on("error", lambda error, *_, queue=name: logging.error("%s worker error: %r", queue, error))
            workers.append(worker)
        logging.info("Workers started: %s", ", ".join(STAGES))

        await watch(list(STAGES), connection, stop)  # returns when stop is set
        logging.info("Stopping: waiting for running jobs to finish")
        await asyncio.gather(*(worker.close() for worker in workers))
        await results.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    asyncio.run(run())
