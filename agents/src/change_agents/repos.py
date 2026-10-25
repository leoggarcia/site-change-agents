"""Where each site's code comes from: GitHub when it is configured, otherwise a local folder.

The token is passed to git as an HTTP header on each command, so it is never written into a
repository's config or remote URL (where a later `git remote -v` or a copied folder could leak it).
"""

import base64
import subprocess
from pathlib import Path

from change_agents.config import get_settings


class GitError(Exception):
    pass


def git(cwd: Path, *args: str, auth: bool = False, timeout: int = 120) -> str:
    # safe.directory: the source repo may belong to another user (e.g. a read-only Docker mount).
    prefix = ["git", "-c", "safe.directory=*", *(_auth_args() if auth else [])]
    result = subprocess.run([*prefix, *args], cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise GitError(f"git {args[0]} failed: {result.stderr.strip()[:500]}")
    return result.stdout


def _auth_args() -> list[str]:
    settings = get_settings()
    if not settings.github_enabled:
        return []
    credentials = base64.b64encode(f"x-access-token:{settings.github_token}".encode()).decode()
    return ["-c", f"http.https://github.com/.extraheader=AUTHORIZATION: basic {credentials}"]


def source(site_id: str) -> str:
    """What to clone a site from: its GitHub repository, or its local folder."""
    settings = get_settings()
    if settings.github_enabled:
        return f"https://github.com/{settings.github_org}/{site_id}.git"
    return str(settings.sites_repos_dir / site_id)


def checkout(site_id: str) -> Path:
    """A folder with the site's current main branch, for reading (indexing, summaries).

    With GitHub, a mirror is cloned once and brought up to date on every call.
    """
    settings = get_settings()
    if not settings.github_enabled:
        return settings.sites_repos_dir / site_id

    mirror = settings.mirrors_dir / site_id
    if not (mirror / ".git").exists():
        mirror.parent.mkdir(parents=True, exist_ok=True)
        git(mirror.parent, "clone", "--quiet", source(site_id), mirror.name, auth=True)
    else:
        git(mirror, "fetch", "--quiet", "origin", "main", auth=True)
        git(mirror, "reset", "--quiet", "--hard", "origin/main")
    return mirror
