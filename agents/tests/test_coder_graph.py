from pathlib import Path

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage

from change_agents.coder.graph import MAX_EDIT_TURNS, build_coder_graph, initial_state
from change_agents.coder.schema import ChangePlan
from change_agents.coder.tools import Editor, make_coder_tools
from change_agents.coder.workspace import BuildResult, DiffStat
from change_agents.tools.repo import RepoSandbox

TICKET = {
    "id": 7,
    "site_id": "test-site",
    "summary": "Update the phone number",
    "change_type": "content_update",
    "target": {"page": "global", "section": "Footer"},
    "details": "Change 618 123 4567 to 618 765 4321",
    "acceptance_criteria": ["The footer shows 618 765 4321"],
}
GOOD_PLAN = ChangePlan(
    understanding="Replace the phone number.",
    feasible=True,
    steps=[{"file": "src/data/business.json", "action": "edit", "what": "New phone number"}],
)


def call(name: str, call_id: str, **args: str) -> dict:
    return {"name": name, "args": args, "id": call_id, "type": "tool_call"}


def edit_phone(call_id: str = "e1") -> AIMessage:
    return AIMessage(content="", tool_calls=[call("edit_file", call_id, path="src/data/business.json", old_text="618 123 4567", new_text="618 765 4321")])


class ScriptedModel:
    def __init__(self, plans: list[ChangePlan | Exception], replies: list[AIMessage]) -> None:
        self.plans, self.replies = plans, replies
        self.calls: list[list[BaseMessage]] = []

    def bind_tools(self, tools):  # noqa: ANN001
        return self

    def invoke(self, messages: list[BaseMessage]) -> AIMessage:
        self.calls.append(messages)
        return self.replies.pop(0) if self.replies else AIMessage(content="Done.")

    def with_structured_output(self, schema, include_raw=False):  # noqa: ANN001
        model = self

        class Structured:
            def invoke(self, messages: list[BaseMessage]) -> dict:
                model.calls.append(messages)
                plan = model.plans.pop(0)
                if isinstance(plan, Exception):
                    return {"raw": AIMessage(content=""), "parsed": None, "parsing_error": plan}
                return {"raw": AIMessage(content=""), "parsed": plan, "parsing_error": None}

        return Structured()


class FakeWorkspace:
    def __init__(self, editor: Editor, builds: list[BuildResult]) -> None:
        self.editor, self.builds, self.commits = editor, builds, []

    def build(self) -> BuildResult:
        return self.builds.pop(0) if self.builds else BuildResult(True, "")

    def diff_stat(self) -> DiffStat:
        return DiffStat(sorted(self.editor.changed), 1, 1)

    def commit(self, message: str) -> str:
        self.commits.append(message)
        return "abc123"


def run(tmp_path: Path, plans, replies, builds=()):  # noqa: ANN001, ANN201
    (tmp_path / "src" / "data").mkdir(parents=True)
    (tmp_path / "src" / "data" / "business.json").write_text('{"phone": "618 123 4567"}')
    (tmp_path / "package.json").write_text("{}")
    editor = Editor(RepoSandbox(tmp_path))
    workspace = FakeWorkspace(editor, list(builds))
    model = ScriptedModel(list(plans), list(replies))
    graph = build_coder_graph(model, make_coder_tools(editor, []), editor, workspace, lambda ticket: "<relevant_files/>")
    state = graph.invoke(initial_state(TICKET), {"recursion_limit": 60})
    return state, model, workspace, tmp_path


def test_plans_edits_builds_and_commits(tmp_path: Path) -> None:
    state, model, workspace, root = run(tmp_path, [GOOD_PLAN], [edit_phone(), AIMessage(content="Updated the phone in business.json.")])

    assert state["outcome"] == {
        "status": "done",
        "summary": "Updated the phone in business.json.",
        "commit": "abc123",
        "files": ["src/data/business.json"],
        "insertions": 1,
        "deletions": 1,
        "buildRounds": 1,
    }
    assert "618 765 4321" in (root / "src/data/business.json").read_text()
    assert workspace.commits[0].startswith("Update the phone number\n\nUpdated the phone")
    assert "<plan>" in model.calls[1][1].content  # the edit loop starts from the plan


def test_sends_build_errors_back_to_the_model(tmp_path: Path) -> None:
    failed = BuildResult(False, "error: Unexpected token in business.json")
    state, model, _, _ = run(
        tmp_path, [GOOD_PLAN], [edit_phone(), AIMessage(content="Done."), AIMessage(content="Fixed it.")], [failed]
    )

    assert state["outcome"]["status"] == "done"
    assert state["outcome"]["buildRounds"] == 2
    assert "Unexpected token in business.json" in model.calls[-1][-1].content


def test_hands_off_when_the_plan_is_not_feasible(tmp_path: Path) -> None:
    plan = ChangePlan(understanding="Add a booking widget.", feasible=False, blocker="It needs an external script.")
    state, model, _, _ = run(tmp_path, [plan], [])

    assert state["outcome"]["status"] == "needs_human"
    assert "external script" in state["outcome"]["message"]
    assert len(model.calls) == 1  # no edit loop at all


def test_rejects_plans_that_touch_forbidden_files(tmp_path: Path) -> None:
    bad = ChangePlan(understanding="x", feasible=True, steps=[{"file": "package.json", "action": "edit", "what": "x"}])
    state, model, _, _ = run(tmp_path, [bad, GOOD_PLAN], [edit_phone(), AIMessage(content="Done.")])

    assert state["outcome"]["status"] == "done"
    assert "dependencies are changed by people" in model.calls[1][-1].content


def test_a_refused_edit_changes_nothing(tmp_path: Path) -> None:
    evil = AIMessage(content="", tool_calls=[call("edit_file", "e1", path="package.json", old_text="{}", new_text='{"x": 1}')])
    state, model, _, root = run(tmp_path, [GOOD_PLAN], [evil, AIMessage(content="I could not do it.")])

    refusal = next(m for m in model.calls[-1] if isinstance(m, ToolMessage))
    assert refusal.content.startswith("Error: 'package.json' can't be changed")
    assert state["outcome"] == {"status": "needs_human", "message": "The agent finished without changing any file.", "buildOutput": None}
    assert (root / "package.json").read_text() == "{}"


def test_the_turn_limit_lives_in_code(tmp_path: Path) -> None:
    searches = [AIMessage(content="", tool_calls=[call("search_code", f"s{i}", text="phone")]) for i in range(30)]
    state, model, _, _ = run(tmp_path, [GOOD_PLAN], searches)

    assert state["turns"] == MAX_EDIT_TURNS
    assert state["outcome"]["status"] == "needs_human"
