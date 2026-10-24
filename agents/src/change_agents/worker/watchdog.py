"""Makes due retries start on time.

A retried job waits in the queue's "delayed" set until its backoff is over, and the worker is supposed
to pick it up then. With jobs added by the API (Node BullMQ, tried 5.81 and 6.4) and processed here
(bullmq for Python 3.4.3), an idle Python worker doesn't: the retry waits until another job arrives.
Jobs added from Python retry fine. The root cause is somewhere in how the two libraries share Redis;
we haven't found it.

So this checks every couple of seconds, promotes any retry that is due (moves it to "waiting", which
wakes the worker) and logs it, so we can see when the worker would have missed one.
"""

import asyncio
import logging
import time

from bullmq import Job, Queue

logger = logging.getLogger(__name__)

CHECK_EVERY_SECONDS = 2
GRACE_SECONDS = 2


def _due_score(now_ms: int) -> int:
    # BullMQ stores a delayed job's due time in milliseconds, shifted left by 12 bits (see Job.delay docs).
    return now_ms * 0x1000


async def promote_overdue(queue: Queue) -> list[str]:
    now_ms = int(time.time() * 1000)
    overdue = await queue.client.zrangebyscore(queue.keys["delayed"], 0, _due_score(now_ms - GRACE_SECONDS * 1000))
    promoted = []
    for raw_id in overdue:
        job_id = raw_id.decode() if isinstance(raw_id, bytes) else raw_id
        job = await Job.fromId(queue, job_id)
        if job is None:
            continue
        try:
            await job.promote()
            promoted.append(job_id)
        except Exception as error:  # noqa: BLE001 - e.g. the worker started it in the meantime
            logger.debug("Could not promote %s: %s", job_id, error)
    if promoted:
        logger.info("%s: promoted %s due retry(ies): %s", queue.name, len(promoted), ", ".join(promoted))
    return promoted


async def watch(queue_names: list[str], connection: dict, stop: asyncio.Event) -> None:
    queues = [Queue(name, connection) for name in queue_names]
    try:
        while not stop.is_set():
            for queue in queues:
                try:
                    await promote_overdue(queue)
                except Exception as error:  # noqa: BLE001 - never let the watchdog take the worker down
                    logger.warning("Watchdog check of %s failed: %r", queue.name, error)
            try:
                await asyncio.wait_for(stop.wait(), CHECK_EVERY_SECONDS)
            except TimeoutError:
                pass
    finally:
        await asyncio.gather(*(queue.close() for queue in queues))
