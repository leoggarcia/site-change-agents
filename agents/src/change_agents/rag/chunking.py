"""Splits site files and client documents into the pieces (chunks) we embed and search.

Strategies for code, compared by the retrieval eval:
- "contextual": one chunk per component/page/data entry, plus a context line taken from the
  Project Indexer's summary (e.g. 'Section "Reviews" on /: customer testimonials').
- "component":  the same chunks without that context line.
- "fixed":      blind windows of FIXED_SIZE characters, the usual naive baseline.
"""

import json
import re
from dataclasses import dataclass
from pathlib import PurePosixPath

from change_agents.tools.repo import RepoSandbox, SandboxError

CODE_EXTENSIONS = {".astro", ".ts", ".js", ".mjs", ".json", ".css", ".md", ".mdx", ".html"}
SKIPPED_FILES = {"package-lock.json", "tsconfig.json", "README.md"}
SKIPPED_DIRS = {".github", "public"}
MAX_CHUNK_CHARS = 4000
FIXED_SIZE = 800
FIXED_OVERLAP = 200


@dataclass(frozen=True)
class CodeChunk:
    file_path: str
    chunk_index: int
    kind: str
    title: str
    context: str
    content: str

    def embedding_text(self) -> str:
        return "\n".join(part for part in (self.title, self.context, self.content) if part)


@dataclass(frozen=True)
class KnowledgeChunk:
    source_path: str
    source_type: str
    source_title: str
    chunk_index: int
    heading: str
    content: str

    def embedding_text(self) -> str:
        return f"{self.source_title} › {self.heading}\n{self.content}"


def code_kind(path: str) -> str:
    parts = PurePosixPath(path).parts
    suffix = PurePosixPath(path).suffix
    if "pages" in parts:
        return "page"
    if "layouts" in parts:
        return "layout"
    if "components" in parts:
        return "component"
    if suffix == ".css":
        return "style"
    if suffix == ".json" and "src" in parts:
        return "data"
    if PurePosixPath(path).name.startswith(("astro.config", "package.json")):
        return "config"
    return "other"


def indexable_files(sandbox: RepoSandbox) -> list[str]:
    return [
        path
        for path in sandbox.iter_files()
        if PurePosixPath(path).suffix in CODE_EXTENSIONS
        and PurePosixPath(path).name not in SKIPPED_FILES
        and not set(PurePosixPath(path).parts) & SKIPPED_DIRS
    ]


def summary_context(summary: dict | None) -> dict[str, list[str]]:
    """file path -> what the Project Indexer said about it (sections it renders, content it holds)."""
    notes: dict[str, list[str]] = {}
    if not summary:
        return notes
    for page in summary.get("pages", []):
        notes.setdefault(page["file"], []).append(f'Page "{page["title"]}" at {page["route"]}.')
        for section in page.get("sections", []):
            target = section.get("component_file") or page["file"]
            notes.setdefault(target, []).append(
                f'Section "{section["name"]}" on {page["route"]}: {section["description"]}'
            )
    for component in summary.get("shared_components", []):
        notes.setdefault(component["file"], []).append(
            f"Shared on {', '.join(component['used_on'])}: {component['purpose']}"
        )
    for location in summary.get("content_locations", []):
        notes.setdefault(location["file"], []).append(f"Holds: {location['content']}.")
    return notes


def _split_long(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """Splits at blank lines so pieces stay readable; only used for unusually long files."""
    if len(text) <= limit:
        return [text]
    pieces, current = [], ""
    for block in re.split(r"\n\s*\n", text):
        if current and len(current) + len(block) > limit:
            pieces.append(current)
            current = ""
        current = f"{current}\n\n{block}" if current else block
    return pieces + ([current] if current else [])


def _json_entries(path: str, text: str) -> list[tuple[str, str]]:
    """One entry per array item (a plan, a FAQ); small objects stay whole."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return [(path, text)]
    if isinstance(data, list):
        entries = []
        for number, item in enumerate(data, start=1):
            label = item.get("name") or item.get("question") or item.get("title") if isinstance(item, dict) else None
            entries.append((f"{path} item {number}" + (f": {label}" if label else ""), json.dumps(item, indent=2, ensure_ascii=False)))
        return entries
    if isinstance(data, dict) and len(text) > MAX_CHUNK_CHARS:
        return [(f"{path} › {key}", json.dumps({key: value}, indent=2, ensure_ascii=False)) for key, value in data.items()]
    return [(path, text)]


def chunk_code(sandbox: RepoSandbox, strategy: str, summary: dict | None = None) -> list[CodeChunk]:
    notes = summary_context(summary) if strategy == "contextual" else {}
    chunks: list[CodeChunk] = []
    for path in indexable_files(sandbox):
        try:
            text = sandbox.read_file(path)
        except SandboxError:
            continue
        kind = code_kind(path)

        if strategy == "fixed":
            step = FIXED_SIZE - FIXED_OVERLAP
            windows = [text[start : start + FIXED_SIZE] for start in range(0, max(len(text) - FIXED_OVERLAP, 1), step)]
            chunks += [CodeChunk(path, i, kind, f"{path} (part {i + 1})", "", w) for i, w in enumerate(windows)]
            continue

        context = " ".join(notes.get(path, []))
        if PurePosixPath(path).suffix == ".json":
            entries = _json_entries(path, text)
        else:
            parts = _split_long(text)
            entries = [(path if len(parts) == 1 else f"{path} (part {i + 1})", part) for i, part in enumerate(parts)]
        chunks += [
            CodeChunk(path, i, kind, f"{title} [{kind}]", context, content) for i, (title, content) in enumerate(entries)
        ]
    return chunks


def chunk_markdown(source_path: str, source_type: str, text: str) -> list[KnowledgeChunk]:
    """One chunk per "## " section; the document's "# " title is kept as the source title."""
    title_match = re.search(r"^# (.+)$", text, re.MULTILINE)
    source_title = title_match.group(1).strip() if title_match else source_path
    sections = re.split(r"^## ", text, flags=re.MULTILINE)
    intro, rest = sections[0], sections[1:]

    chunks: list[KnowledgeChunk] = []
    intro_body = re.sub(r"^# .+$", "", intro, flags=re.MULTILINE).strip()
    if intro_body:
        chunks.append(KnowledgeChunk(source_path, source_type, source_title, 0, "Overview", intro_body))
    for section in rest:
        heading, _, body = section.partition("\n")
        chunks.append(
            KnowledgeChunk(source_path, source_type, source_title, len(chunks), heading.strip(), body.strip())
        )
    return chunks
