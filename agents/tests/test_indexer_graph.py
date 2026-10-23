from pathlib import Path

from langchain_core.messages import AIMessage, BaseMessage

from change_agents.indexer.graph import build_indexer_graph, initial_state
from change_agents.indexer.markdown import to_markdown
from change_agents.indexer.schema import ProjectSummary, Styling
from change_agents.tools.repo import RepoSandbox, make_read_only_tools

SUMMARY = ProjectSummary(
    site_name="Test Café",
    framework="Astro static site",
    overview="A small test site.",
    pages=[],
    shared_components=[],
    content_locations=[],
    styling=Styling(approach="Global CSS", global_stylesheet=None, colors=[], fonts=[]),
    notes=[],
)


def call(name: str, call_id: str, **args: str) -> dict:
    return {"name": name, "args": args, "id": call_id, "type": "tool_call"}


class ScriptedModel:
    """Stands in for a chat model: replays scripted replies and records what it was sent."""

    def __init__(self, replies: list[AIMessage]) -> None:
        self.replies = replies
        self.summarizer_input: list[BaseMessage] = []

    def bind_tools(self, tools):  # noqa: ANN001
        return self

    def invoke(self, messages: list[BaseMessage]) -> AIMessage:
        return self.replies.pop(0) if self.replies else AIMessage(content="done")

    def with_structured_output(self, schema, include_raw=False):  # noqa: ANN001
        model = self

        class Structured:
            def invoke(self, messages: list[BaseMessage]) -> dict:
                model.summarizer_input = messages
                return {"raw": AIMessage(content=""), "parsed": SUMMARY, "parsing_error": None}

        return Structured()


def make_repo(tmp_path: Path) -> Path:
    (tmp_path / "src" / "pages").mkdir(parents=True)
    (tmp_path / "src" / "pages" / "index.astro").write_text("<h1>Welcome</h1>")
    (tmp_path / "src" / "pages" / "menu.astro").write_text("<h1>Menu</h1>")
    (tmp_path / ".env").write_text("SECRET=1")
    return tmp_path


def test_explores_with_tools_then_summarizes(tmp_path: Path) -> None:
    model = ScriptedModel(
        [
            AIMessage(content="", tool_calls=[call("list_files", "1")]),
            AIMessage(
                content="",
                tool_calls=[
                    call("read_file", "2", path="src/pages/index.astro"),
                    call("read_file", "3", path="src/pages/menu.astro"),
                    call("read_file", "4", path=".env"),
                ],
            ),
            AIMessage(content="I have read everything."),
        ]
    )
    graph = build_indexer_graph(model, make_read_only_tools(RepoSandbox(make_repo(tmp_path))))  # type: ignore[arg-type]

    result = graph.invoke(initial_state("test-cafe"))

    assert result["summary"] == SUMMARY
    assert result["turns"] == 3
    files_text = model.summarizer_input[-1].content
    assert '<file path="src/pages/index.astro">' in files_text and "Welcome" in files_text
    assert "Menu" in files_text
    assert "SECRET" not in files_text  # the sandbox refused .env, and errors are not passed on


def test_turn_limit_is_enforced_in_code(tmp_path: Path) -> None:
    always_wants_more = [AIMessage(content="", tool_calls=[call("list_files", str(i))]) for i in range(50)]
    model = ScriptedModel(always_wants_more)
    graph = build_indexer_graph(model, make_read_only_tools(RepoSandbox(make_repo(tmp_path))), max_turns=3)  # type: ignore[arg-type]

    result = graph.invoke(initial_state("test-cafe"))

    assert result["turns"] == 3
    assert result["summary"] == SUMMARY


def test_markdown_renders_the_summary() -> None:
    assert to_markdown(SUMMARY).startswith("# Test Café")
