"""The few GitHub REST calls delivery needs: pull requests and workflow runs."""

import time
from typing import Any

import httpx

from change_agents.config import get_settings

API = "https://api.github.com"
POLL_SECONDS = 10


class GitHubError(Exception):
    pass


class GitHub:
    def __init__(self, org: str, token: str, client: httpx.Client | None = None) -> None:
        self.org = org
        self.client = client or httpx.Client(
            base_url=API,
            timeout=30,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )

    @classmethod
    def from_settings(cls) -> "GitHub":
        settings = get_settings()
        if not settings.github_enabled:
            raise GitHubError("GitHub is not configured (GITHUB_ORG and GITHUB_TOKEN).")
        return cls(settings.github_org, settings.github_token)

    def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self.client.request(method, path, **kwargs)
        if response.status_code >= 400:
            raise GitHubError(f"GitHub {method} {path} answered {response.status_code}: {response.text[:300]}")
        return response.json() if response.content else None

    def open_pull_request(self, repo: str, branch: str, title: str, body: str) -> dict[str, Any]:
        """Creates the branch's pull request, or updates it if one is already open (a retry or a revision)."""
        existing = self._call("GET", f"/repos/{self.org}/{repo}/pulls", params={"head": f"{self.org}:{branch}", "state": "open"})
        if existing:
            return self._call("PATCH", f"/repos/{self.org}/{repo}/pulls/{existing[0]['number']}", json={"title": title, "body": body})
        return self._call("POST", f"/repos/{self.org}/{repo}/pulls", json={"title": title, "head": branch, "base": "main", "body": body})

    def merge(self, repo: str, number: int, title: str) -> str:
        """Squash-merges the pull request and returns the commit on main. Safe to call again after a merge."""
        pull = self._call("GET", f"/repos/{self.org}/{repo}/pulls/{number}")
        if pull["merged"]:
            return pull["merge_commit_sha"]
        result = self._call("PUT", f"/repos/{self.org}/{repo}/pulls/{number}/merge", json={"merge_method": "squash", "commit_title": title})
        return result["sha"]

    def download_artifact(self, repo: str, run_id: int, name: str) -> bytes:
        """The zip of a workflow run's artifact. GitHub redirects the download to its storage."""
        artifacts = self._call("GET", f"/repos/{self.org}/{repo}/actions/runs/{run_id}/artifacts")["artifacts"]
        artifact = next((item for item in artifacts if item["name"] == name and not item["expired"]), None)
        if artifact is None:
            raise GitHubError(f"Run {run_id} has no '{name}' artifact.")
        # httpx drops the Authorization header when the redirect leaves api.github.com.
        response = self.client.get(f"/repos/{self.org}/{repo}/actions/artifacts/{artifact['id']}/zip", follow_redirects=True)
        if response.status_code >= 400:
            raise GitHubError(f"Downloading artifact {artifact['id']} answered {response.status_code}.")
        return response.content

    def latest_runs(self, repo: str, event: str, branch: str) -> list[dict[str, Any]]:
        return self._call(
            "GET", f"/repos/{self.org}/{repo}/actions/runs", params={"event": event, "branch": branch, "status": "completed"}
        )["workflow_runs"]

    def wait_for_run(self, repo: str, event: str, head_sha: str, timeout_seconds: int = 720) -> dict[str, Any]:
        """Waits for the deploy workflow run of a commit to finish and returns it.

        Polling the API (instead of receiving a webhook) means the system needs no public URL.
        """
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            runs = self._call("GET", f"/repos/{self.org}/{repo}/actions/runs", params={"event": event, "head_sha": head_sha})
            finished = [run for run in runs["workflow_runs"] if run["status"] == "completed"]
            if finished:
                return max(finished, key=lambda run: run["run_number"])
            time.sleep(POLL_SECONDS)
        raise TimeoutError(f"No finished {event} deploy for {head_sha[:7]} after {timeout_seconds} seconds.")
