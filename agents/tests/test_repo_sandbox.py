from pathlib import Path

import pytest

from change_agents.tools.repo import RepoSandbox, SandboxError, make_read_only_tools


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "site"
    (root / "src" / "components").mkdir(parents=True)
    (root / "src" / "components" / "Footer.astro").write_text("<footer>618 123 4567</footer>")
    (root / "node_modules" / "astro").mkdir(parents=True)
    (root / "node_modules" / "astro" / "index.js").write_text("// dependency")
    (root / ".env").write_text("SECRET=1")
    (tmp_path / "outside.txt").write_text("not part of the repo")
    (root / "link-outside.txt").symlink_to(tmp_path / "outside.txt")
    return root


def test_lists_files_without_dependencies_or_secrets(repo: Path) -> None:
    files = RepoSandbox(repo).list_files()

    assert any(f.startswith("src/components/Footer.astro") for f in files)
    assert not any("node_modules" in f or ".env" in f for f in files)


def test_reads_a_file_inside_the_repo(repo: Path) -> None:
    assert "618 123 4567" in RepoSandbox(repo).read_file("src/components/Footer.astro")


@pytest.mark.parametrize(
    "path",
    ["../outside.txt", "/etc/passwd", "src/../../outside.txt", "link-outside.txt", ".env", "node_modules/astro/index.js"],
)
def test_refuses_paths_it_should_not_read(repo: Path, path: str) -> None:
    with pytest.raises(SandboxError):
        RepoSandbox(repo).read_file(path)


def test_tools_return_errors_to_the_model_instead_of_raising(repo: Path) -> None:
    _, read_file = make_read_only_tools(RepoSandbox(repo))

    assert read_file.invoke({"path": "../outside.txt"}).startswith("Error:")
