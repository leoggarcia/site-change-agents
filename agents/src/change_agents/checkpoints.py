"""LangGraph checkpoints in Postgres, so a paused graph survives restarts and can be resumed anywhere."""

from collections.abc import Iterator
from contextlib import contextmanager

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from change_agents.config import get_settings


@contextmanager
def postgres_checkpointer() -> Iterator[PostgresSaver]:
    """A checkpointer backed by a small connection pool.

    setup() creates LangGraph's own tables (checkpoints, checkpoint_blobs, checkpoint_writes,
    checkpoint_migrations) if they are missing. They belong to LangGraph, not to the API's migrations.
    """
    pool_kwargs = {"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row}
    with ConnectionPool(get_settings().database_url, kwargs=pool_kwargs, max_size=4, open=True) as pool:
        saver = PostgresSaver(pool)
        saver.setup()
        yield saver
