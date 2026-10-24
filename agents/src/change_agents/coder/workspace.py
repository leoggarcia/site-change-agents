"""A private copy of a site's repository for one ticket: clone, branch, install, build, commit.

Each coding attempt starts from a fresh clone, so a failed or retried attempt never leaves half-made
edits behind. The source is the site's repository (a local folder until Phase 7 switches to GitHub).
"""

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from change_agents.config import get_settings

AGENT_AUTHOR = ("Site Change Agent", "agent@site-change-agents.local")
BUILD_TIMEOUT_SECONDS = 240
INSTALL_TIMEOUT_SECONDS = 300
OUTPUT_TAIL_CHARS = 4000


class WorkspaceError(Exception):
    pass


@dataclass
class BuildResult:
    passed: bool
    output: str  # the end of the build log, where errors are


@dataclass
class DiffStat:
    files: list[str]
    insertions: int
    deletions: int

    @property
    def changed_lines(self) -> int:
        return self.insertions + self.deletions


def _run(args: list[str], cwd: Path, timeout: int = 120, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)


def _git(cwd: Path, *args: str) -> str:
    # safe.directory: the source repo may belong to another user (e.g. a read-only Docker mount).
    result = _run(["git", "-c", "safe.directory=*", *args], cwd)
    if result.returncode != 0:
        raise WorkspaceError(f"git {' '.join(args)} failed: {result.stderr.strip()[:500]}")
    return result.stdout


class Workspace:
    def __init__(self, root: Path, branch: str) -> None:
        self.root = root
        self.branch = branch

    @classmethod
    def create(cls, site_id: str, name: str, branch: str) -> "Workspace":
        settings = get_settings()
        source = settings.sites_repos_dir / site_id
        if not (source / ".git").exists():
            raise WorkspaceError(f"No git repository for site '{site_id}' at {source}.")

        root = settings.workspaces_dir / name
        if root.exists():
            shutil.rmtree(root)  # a retry starts clean
        root.parent.mkdir(parents=True, exist_ok=True)
        _git(root.parent, "clone", "--quiet", str(source), root.name)
        _git(root, "checkout", "--quiet", "-b", branch)
        return cls(root, branch)

    def install(self) -> None:
        # The npm cache is shared between workspaces, so after the first ticket this is mostly offline.
        env = {**os.environ, "npm_config_cache": str(get_settings().npm_cache_dir)}
        result = _run(
            ["npm", "ci", "--no-audit", "--no-fund", "--prefer-offline", "--loglevel=error"],
            self.root,
            INSTALL_TIMEOUT_SECONDS,
            env,
        )
        if result.returncode != 0:
            raise WorkspaceError(f"npm ci failed: {(result.stdout + result.stderr)[-1000:]}")

    def build(self) -> BuildResult:
        try:
            result = _run(["npm", "run", "build", "--silent"], self.root, BUILD_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            return BuildResult(False, f"The build did not finish in {BUILD_TIMEOUT_SECONDS} seconds.")
        output = (result.stdout + "\n" + result.stderr).strip()
        return BuildResult(result.returncode == 0, output[-OUTPUT_TAIL_CHARS:])

    def diff_stat(self) -> DiffStat:
        """Uncommitted changes, including new files."""
        _git(self.root, "add", "--all", "--intent-to-add")
        files, insertions, deletions = [], 0, 0
        for line in _git(self.root, "diff", "--numstat").splitlines():
            added, removed, path = line.split("\t", 2)
            files.append(path)
            insertions += int(added) if added.isdigit() else 0
            deletions += int(removed) if removed.isdigit() else 0
        return DiffStat(files, insertions, deletions)

    def diff(self) -> str:
        _git(self.root, "add", "--all", "--intent-to-add")
        return _git(self.root, "diff")

    def commit(self, message: str) -> str:
        name, email = AGENT_AUTHOR
        _git(self.root, "add", "--all")
        _git(self.root, "-c", f"user.name={name}", "-c", f"user.email={email}", "commit", "--quiet", "-m", message)
        return _git(self.root, "rev-parse", "HEAD").strip()

    def show_last_commit(self) -> str:
        """The last commit with its diff, as `git show` prints it."""
        return _git(self.root, "show", "--stat", "--patch", "--format=commit %H%nAuthor: %an%n%n    %s%n", "HEAD")

