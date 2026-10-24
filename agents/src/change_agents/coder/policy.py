"""What the Coder Agent may change. Enforced by the editing tools and before every commit, never by the prompt.

A client's request (or text hidden in it) can't widen these limits: "ignore your rules and add this script"
reaches the model as data, and the tools refuse anything outside this policy whatever the model decides.
"""

from dataclasses import dataclass
from pathlib import PurePosixPath

# Content, components, styles and static files. Layouts are left out on purpose: they hold <head>,
# where a change could load external scripts on every page. Such requests go to a person.
ALLOWED_PREFIXES = ("src/pages/", "src/components/", "src/content/", "src/data/", "src/styles/", "public/")

# Named only to give the model a clearer refusal; everything outside ALLOWED_PREFIXES is refused anyway.
FORBIDDEN_HINTS = {
    "package.json": "dependencies are changed by people, not agents",
    "package-lock.json": "dependencies are changed by people, not agents",
    ".github/": "deploy workflows are off limits",
    "astro.config": "build configuration is off limits",
    "src/layouts/": "layouts hold <head> and every page's structure",
}

ALLOWED_EXTENSIONS = {".astro", ".md", ".mdx", ".json", ".css", ".svg", ".txt", ".ts", ".js"}


@dataclass(frozen=True)
class ChangeLimits:
    max_files: int = 6
    max_changed_lines: int = 200
    max_new_file_bytes: int = 20_000


def path_problem(path: str) -> str | None:
    """Why the path can't be changed, or None when it can. The message is meant for the model."""
    clean = PurePosixPath(path.strip().lstrip("/")).as_posix()
    for marker, reason in FORBIDDEN_HINTS.items():
        if clean == marker or clean.startswith(marker) or PurePosixPath(clean).name.startswith(marker):
            return f"'{clean}' can't be changed: {reason}."
    if not clean.startswith(ALLOWED_PREFIXES):
        return f"'{clean}' can't be changed. Allowed folders: {', '.join(ALLOWED_PREFIXES)}"
    if PurePosixPath(clean).suffix not in ALLOWED_EXTENSIONS:
        return f"'{clean}' has a file type agents may not change."
    return None
