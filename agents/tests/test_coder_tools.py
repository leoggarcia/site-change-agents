import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from change_agents.coder import workspace as workspace_module
from change_agents.coder.policy import ChangeLimits, path_problem
from change_agents.coder.tools import Editor
from change_agents.coder.workspace import Workspace
from change_agents.tools.repo import RepoSandbox, SandboxError

FOOTER = '<footer>\n  <a href="tel:6181234567">618 123 4567</a>\n</footer>\n'


@pytest.mark.parametrize(
    "path",
    [
        "src/components/Footer.astro",
        "src/data/business.json",
        "src/styles/global.css",
        "src/pages/menu.astro",
        "/public/favicon.svg",
    ],
)
def test_allows_content_components_and_styles(path: str) -> None:
    assert path_problem(path) is None


@pytest.mark.parametrize(
    ("path", "reason"),
    [
        ("package.json", "dependencies"),
        ("package-lock.json", "dependencies"),
        (".github/workflows/deploy.yml", "deploy workflows"),
        ("astro.config.mjs", "build configuration"),
        ("src/layouts/Layout.astro", "<head>"),
        (".env", "Allowed folders"),
        ("src/lib/url.ts", "Allowed folders"),
        ("public/run.sh", "file type"),
    ],
)
def test_refuses_everything_else(path: str, reason: str) -> None:
    assert reason in (path_problem(path) or "")


def make_editor(tmp_path: Path, limits: ChangeLimits = ChangeLimits()) -> Editor:
    (tmp_path / "src" / "components").mkdir(parents=True)
    (tmp_path / "src" / "components" / "Footer.astro").write_text(FOOTER)
    (tmp_path / "package.json").write_text("{}")
    return Editor(RepoSandbox(tmp_path), limits)


def test_edits_one_exact_occurrence(tmp_path: Path) -> None:
    editor = make_editor(tmp_path)

    editor.edit("src/components/Footer.astro", ">618 123 4567<", ">618 765 4321<")

    assert ">618 765 4321<" in (tmp_path / "src/components/Footer.astro").read_text()
    assert editor.changed == {"src/components/Footer.astro"}


def test_refuses_missing_or_ambiguous_text(tmp_path: Path) -> None:
    editor = make_editor(tmp_path)
    with pytest.raises(SandboxError, match="not found"):
        editor.edit("src/components/Footer.astro", "555 000 0000", "x")
    with pytest.raises(SandboxError, match="appears 2 times"):
        editor.edit("src/components/Footer.astro", "618", "x")  # in the href and in the text


def test_refuses_forbidden_files_whatever_the_model_asks(tmp_path: Path) -> None:
    editor = make_editor(tmp_path)
    with pytest.raises(SandboxError, match="dependencies"):
        editor.edit("package.json", "{}", '{"dependencies": {"evil": "1.0"}}')
    with pytest.raises(SandboxError, match="outside the repository"):
        editor.create("src/components/../../../escape.astro", "x")
    assert (tmp_path / "package.json").read_text() == "{}"


def test_limits_how_many_files_a_change_touches(tmp_path: Path) -> None:
    editor = make_editor(tmp_path, ChangeLimits(max_files=1))
    editor.create("src/components/Banner.astro", "<div>Hi</div>")
    with pytest.raises(SandboxError, match="at most 1 files"):
        editor.create("src/components/Other.astro", "<div>Hi</div>")


def test_creates_new_files_only(tmp_path: Path) -> None:
    editor = make_editor(tmp_path)
    with pytest.raises(SandboxError, match="already exists"):
        editor.create("src/components/Footer.astro", "x")


def test_searches_exact_text(tmp_path: Path) -> None:
    editor = make_editor(tmp_path)
    assert editor.search("618 123") == "src/components/Footer.astro:2: <a href=\"tel:6181234567\">618 123 4567</a>"


def test_workspace_clones_branches_and_commits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "repos" / "test-site"
    (source / "src" / "components").mkdir(parents=True)
    (source / "src" / "components" / "Footer.astro").write_text(FOOTER)
    for args in (["init", "-q", "-b", "main"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]):
        subprocess.run(["git", *args], cwd=source, check=True)
    settings = SimpleNamespace(sites_repos_dir=tmp_path / "repos", workspaces_dir=tmp_path / "work", npm_cache_dir=tmp_path / "npm")
    monkeypatch.setattr(workspace_module, "get_settings", lambda: settings)

    workspace = Workspace.create("test-site", "ticket-1", "agent/ticket-1")
    Editor(RepoSandbox(workspace.root)).edit("src/components/Footer.astro", ">618 123 4567<", ">618 765 4321<")
    stat = workspace.diff_stat()
    sha = workspace.commit("Update the phone number")

    assert (stat.files, stat.insertions, stat.deletions) == (["src/components/Footer.astro"], 1, 1)
    log = subprocess.run(["git", "log", "--format=%an|%s", "agent/ticket-1"], cwd=workspace.root, capture_output=True, text=True)
    assert log.stdout.splitlines()[0] == "Site Change Agent|Update the phone number"
    assert len(sha) == 40
    assert "618 123 4567" in (source / "src/components/Footer.astro").read_text()  # the source is untouched
