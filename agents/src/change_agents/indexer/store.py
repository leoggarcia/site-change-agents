import subprocess
from pathlib import Path

from psycopg.types.json import Jsonb

from change_agents.db import connect
from change_agents.indexer.markdown import to_markdown
from change_agents.indexer.schema import ProjectSummary


def site_exists(site_id: str) -> bool:
    with connect() as connection:
        return connection.execute("SELECT 1 FROM sites WHERE id = %s", (site_id,)).fetchone() is not None


def source_ref(repo: Path) -> str:
    """The commit being described, or "local" for a folder that is not a git checkout."""
    if not (repo / ".git").exists():
        return "local"
    try:
        result = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True)
    except FileNotFoundError:  # git is not installed (e.g. in the slim Docker image)
        return "local"
    return result.stdout.strip() if result.returncode == 0 else "local"


def save_summary(site_id: str, ref: str, summary: ProjectSummary, model: str, stats: dict) -> int:
    with connect() as connection:
        row = connection.execute(
            """
            INSERT INTO project_summaries (site_id, source_ref, summary, markdown, model, stats)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (site_id, ref, Jsonb(summary.model_dump()), to_markdown(summary), model, Jsonb(stats)),
        ).fetchone()
    assert row is not None
    return row[0]
