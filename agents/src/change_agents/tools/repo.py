"""Read-only access to one site's repository, for agents.

The model can ask for any path; this code decides what it gets. Paths outside the repo,
secrets and generated folders are refused here, not in the prompt.
"""

import os
from pathlib import Path

from langchain_core.tools import BaseTool, tool

IGNORED_DIRS = {".git", "node_modules", "dist", ".astro", ".venv", "__pycache__", ".vscode", ".idea"}
MAX_FILE_BYTES = 50_000


class SandboxError(Exception):
    """The requested path is not allowed. The message is safe to show to the model."""


def _is_secret(name: str) -> bool:
    return name.startswith(".env")


class RepoSandbox:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        if not self.root.is_dir():
            raise FileNotFoundError(f"Repository folder not found: {self.root}")

    def resolve(self, relative_path: str) -> Path:
        # resolve() also follows symlinks, so a link pointing outside the repo is caught below.
        candidate = (self.root / relative_path.strip().lstrip("/")).resolve()
        if not candidate.is_relative_to(self.root):
            raise SandboxError(f"'{relative_path}' is outside the repository.")

        parts = candidate.relative_to(self.root).parts
        if any(part in IGNORED_DIRS for part in parts):
            raise SandboxError(f"'{relative_path}' is in an ignored folder (dependencies or build output).")
        if any(_is_secret(part) for part in parts):
            raise SandboxError(f"'{relative_path}' may contain secrets and cannot be read.")
        return candidate

    def iter_files(self, directory: str = "") -> list[str]:
        """Relative paths of every readable file, skipping ignored folders and secrets."""
        start = self.resolve(directory)
        if not start.is_dir():
            raise SandboxError(f"'{directory}' is not a folder.")

        files: list[str] = []
        for current, dirs, names in os.walk(start):
            dirs[:] = sorted(d for d in dirs if d not in IGNORED_DIRS and not _is_secret(d))
            files += [(Path(current) / name).relative_to(self.root).as_posix() for name in sorted(names) if not _is_secret(name)]
        return files

    def list_files(self, directory: str = "") -> list[str]:
        return [f"{path} ({(self.root / path).stat().st_size} bytes)" for path in self.iter_files(directory)]

    def read_file(self, path: str) -> str:
        target = self.resolve(path)
        if not target.is_file():
            raise SandboxError(f"'{path}' does not exist or is not a file.")
        if target.stat().st_size > MAX_FILE_BYTES:
            raise SandboxError(f"'{path}' is larger than {MAX_FILE_BYTES} bytes.")
        try:
            return target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            raise SandboxError(f"'{path}' is a binary file.") from None


def make_read_only_tools(sandbox: RepoSandbox) -> list[BaseTool]:
    """Tools bound to one repository. The docstrings are what the model reads to decide when to call them."""

    @tool
    def list_files(directory: str = "") -> str:
        """List every file in the repository (or in one folder of it), with sizes.
        Dependencies, build output and secret files are left out."""
        try:
            files = sandbox.list_files(directory)
        except SandboxError as error:
            return f"Error: {error}"
        return "\n".join(files) if files else "(no files)"

    @tool
    def read_file(path: str) -> str:
        """Read one text file from the repository. `path` is relative to the repository root,
        e.g. "src/components/Footer.astro". Call it several times in one turn to read several files."""
        try:
            return sandbox.read_file(path)
        except SandboxError as error:
            return f"Error: {error}"

    return [list_files, read_file]
