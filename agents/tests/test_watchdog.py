"""Needs the local Redis (docker compose up redis). Uses its own database number."""

import asyncio
import time

import pytest
import redis.asyncio as redis
from bullmq import Queue

from change_agents.worker.watchdog import GRACE_SECONDS, promote_overdue

URL = "redis://localhost:6379/5"


async def _reachable() -> bool:
    try:
        client = redis.from_url(URL)
        await client.ping()
        await client.aclose()
        return True
    except Exception:  # noqa: BLE001
        return False


def test_promotes_only_overdue_delayed_jobs() -> None:
    async def scenario() -> tuple[list[str], dict]:
        if not await _reachable():
            pytest.skip("Redis is not running")
        queue = Queue("watchdog-test", {"connection": URL})
        await queue.obliterate(force=True)
        await queue.add("x", {}, {"jobId": "overdue", "delay": 60_000})
        await queue.add("x", {}, {"jobId": "not-yet", "delay": 60_000})
        # Pretend "overdue" became due long ago.
        long_ago = int(time.time() * 1000) - (GRACE_SECONDS + 60) * 1000
        await queue.client.zadd(queue.keys["delayed"], {"overdue": long_ago * 0x1000})

        promoted = await promote_overdue(queue)
        counts = await queue.getJobCounts("delayed", "wait")
        await queue.obliterate(force=True)
        await queue.close()
        return promoted, counts

    promoted, counts = asyncio.run(scenario())
    assert promoted == ["overdue"]
    assert counts == {"delayed": 1, "wait": 1}
