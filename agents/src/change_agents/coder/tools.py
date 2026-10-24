"""The Coder Agent's tools for one workspace: search, read and change files.

edit_file works like a careful human editor: it replaces an exact piece of text that must appear exactly
once, so the model has to read the file first and can't rewrite a whole file by accident.
Every change is checked against the policy here, in code.
"""

from langchain_core.tools import BaseTool, tool

from change_agents.coder.policy import ChangeLimits, path_problem
from change_agents.tools.repo import RepoSandbox, SandboxError, make_read_only_tools

MAX_SEARCH_HITS = 30


class Editor:
    """Applies edits inside a workspace and remembers which files changed."""

    def __init__(self, sandbox: RepoSandbox, limits: ChangeLimits = ChangeLimits()) -> None:
        self.sandbox = sandbox
        self.limits = limits
        self.changed: set[str] = set()

    def _check(self, path: str) -> str:
        if problem := path_problem(path):
            raise SandboxError(problem)
        clean = path.strip().lstrip("/")
        if clean not in self.changed and len(self.changed) >= self.limits.max_files:
            raise SandboxError(f"A change may touch at most {self.limits.max_files} files.")
        return clean

    def edit(self, path: str, old_text: str, new_text: str) -> str:
        clean = self._check(path)
        current = self.sandbox.read_file(clean)
        count = current.count(old_text) if old_text else 0
        if count == 0:
            raise SandboxError(
                f"old_text was not found in '{clean}'. Read the file again and copy the text exactly, "
                "including spaces and line breaks."
            )
        if count > 1:
            raise SandboxError(f"old_text appears {count} times in '{clean}'. Include more surrounding lines.")
        if old_text == new_text:
            raise SandboxError("old_text and new_text are the same.")
        self.sandbox.resolve(clean).write_text(current.replace(old_text, new_text, 1), encoding="utf-8")
        self.changed.add(clean)
        return f"Edited {clean}."

    def create(self, path: str, content: str) -> str:
        clean = self._check(path)
        target = self.sandbox.resolve(clean)
        if target.exists():
            raise SandboxError(f"'{clean}' already exists. Use edit_file to change it.")
        if len(content.encode()) > self.limits.max_new_file_bytes:
            raise SandboxError(f"New files may have at most {self.limits.max_new_file_bytes} bytes.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        self.changed.add(clean)
        return f"Created {clean}."

    def search(self, text: str) -> str:
        needle = text.strip().lower()
        if len(needle) < 2:
            raise SandboxError("Search for at least 2 characters.")
        hits: list[str] = []
        for path in self.sandbox.iter_files():
            try:
                content = self.sandbox.read_file(path)
            except SandboxError:
                continue  # binary or too large
            for number, line in enumerate(content.splitlines(), start=1):
                if needle in line.lower():
                    hits.append(f"{path}:{number}: {line.strip()[:200]}")
                    if len(hits) >= MAX_SEARCH_HITS:
                        return "\n".join(hits) + "\n(more matches not shown)"
        return "\n".join(hits) or "No matches."


def make_coder_tools(editor: Editor, rag_tools: list[BaseTool]) -> list[BaseTool]:
    @tool
    def search_code(text: str) -> str:
        """Find exact text in the site's files (case-insensitive), e.g. "618 123 4567" or "Opening hours".
        Returns "path:line: content" for each match. Use it to find every place a value appears."""
        try:
            return editor.search(text)
        except SandboxError as error:
            return f"Error: {error}"

    @tool
    def edit_file(path: str, old_text: str, new_text: str) -> str:
        """Replace one exact piece of text in a file. `old_text` must appear exactly once: copy it from
        read_file, including indentation, and include a few surrounding lines if it is short or repeated.
        To change several places, call edit_file once per place."""
        try:
            return editor.edit(path, old_text, new_text)
        except SandboxError as error:
            return f"Error: {error}"

    @tool
    def create_file(path: str, content: str) -> str:
        """Create a new file, e.g. a new component in src/components/. Fails if the file exists."""
        try:
            return editor.create(path, content)
        except SandboxError as error:
            return f"Error: {error}"

    return [*make_read_only_tools(editor.sandbox), search_code, *rag_tools, edit_file, create_file]
