import io
import json
import zipfile
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from change_agents.delivery import github as github_module
from change_agents.delivery import sites
from change_agents.delivery.github import GitHub
from change_agents.delivery.publish import pull_request_body


def fake_github(routes: dict[tuple[str, str], list]) -> tuple[GitHub, list[tuple[str, str, dict]]]:
    """Each route replays its responses in order; every request is recorded."""
    calls: list[tuple[str, str, dict]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        calls.append((request.method, request.url.path, body))
        return httpx.Response(200, json=routes[(request.method, request.url.path)].pop(0))

    client = httpx.Client(base_url="https://api.github.com", transport=httpx.MockTransport(handler))
    return GitHub("leo-sites", "token", client), calls


def test_opens_a_pull_request_once_then_updates_it() -> None:
    pulls = "/repos/leo-sites/luna-cafe/pulls"
    github, calls = fake_github(
        {
            ("GET", pulls): [[], [{"number": 4}]],
            ("POST", pulls): [{"number": 4, "html_url": "https://github.com/leo-sites/luna-cafe/pull/4"}],
            ("PATCH", f"{pulls}/4"): [{"number": 4, "html_url": "https://github.com/leo-sites/luna-cafe/pull/4"}],
        }
    )

    first = github.open_pull_request("luna-cafe", "agent/ticket-12", "Add a review", "body")
    again = github.open_pull_request("luna-cafe", "agent/ticket-12", "Add a review", "new body")

    assert first["number"] == again["number"] == 4
    assert [call[0] for call in calls] == ["GET", "POST", "GET", "PATCH"]
    assert calls[1][2] == {"title": "Add a review", "head": "agent/ticket-12", "base": "main", "body": "body"}


def test_merge_is_safe_to_repeat() -> None:
    pull = "/repos/leo-sites/luna-cafe/pulls/4"
    github, calls = fake_github({("GET", pull): [{"merged": True, "merge_commit_sha": "abc"}]})

    assert github.merge("luna-cafe", 4, "Add a review") == "abc"
    assert [call[0] for call in calls] == ["GET"]  # already merged: no second merge


def test_waits_for_the_deploy_run_to_finish(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(github_module, "POLL_SECONDS", 0)
    runs = "/repos/leo-sites/luna-cafe/actions/runs"
    github, calls = fake_github(
        {
            ("GET", runs): [
                {"workflow_runs": []},  # the run hasn't started yet
                {"workflow_runs": [{"status": "in_progress", "run_number": 7}]},
                {"workflow_runs": [{"status": "completed", "conclusion": "success", "run_number": 7, "html_url": "u"}]},
            ]
        }
    )

    run = github.wait_for_run("luna-cafe", "pull_request", "abc")

    assert run["conclusion"] == "success"
    assert len(calls) == 3


def test_the_pull_request_explains_the_change() -> None:
    body = pull_request_body(
        {
            "ticketId": 12,
            "ticketUrl": "http://app.localhost/tickets/12",
            "request": "Please add Ana's review.",
            "details": "Add the review by Ana P.",
            "acceptanceCriteria": ["The review is shown"],
            "review": {"summary": "Looks right.", "checks": [{"name": "Build", "passed": True, "level": "blocking"}]},
        }
    )

    assert "[#12](http://app.localhost/tickets/12)" in body
    assert "> Please add Ana's review." in body
    assert "- [x] The review is shown" in body
    assert "- ✅ Build" in body


def make_zip(files: dict[str, str]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_publishes_a_build_by_swapping_folders(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sites, "get_settings", lambda: SimpleNamespace(sites_dir=tmp_path))
    sites.install(make_zip({"index.html": "v1", "menu/index.html": "menu"}), "previews/luna-cafe/pr-4")
    sites.install(make_zip({"index.html": "v2"}), "previews/luna-cafe/pr-4")

    target = tmp_path / "previews/luna-cafe/pr-4"
    assert (target / "index.html").read_text() == "v2"
    assert not (target / "menu").exists()  # the old build is gone, not merged with the new one
    assert sorted(path.name for path in target.parent.iterdir()) == ["pr-4"]  # no leftovers

    sites.remove("previews/luna-cafe/pr-4")
    assert not target.exists()


def test_refuses_unsafe_builds_and_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sites, "get_settings", lambda: SimpleNamespace(sites_dir=tmp_path))
    with pytest.raises(sites.PublishError, match="Unsafe path"):
        sites.install(make_zip({"index.html": "x", "../../evil.sh": "x"}), "luna-cafe")
    with pytest.raises(sites.PublishError, match="no index.html"):
        sites.install(make_zip({"style.css": "x"}), "luna-cafe")
    with pytest.raises(sites.PublishError, match="outside the sites folder"):
        sites.remove("../somewhere-else")
    assert not (tmp_path / "luna-cafe").exists()
