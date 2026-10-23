from contextlib import contextmanager
from collections.abc import Iterator

import psycopg

from change_agents.config import get_settings


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """A connection that commits when the block ends without errors. The schema is owned by the API's migrations."""
    with psycopg.connect(get_settings().database_url) as connection:
        yield connection
