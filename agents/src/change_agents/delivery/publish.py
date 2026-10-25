"""Delivery jobs: open the pull request and publish its preview; merge it and publish production.

The site's own GitHub Action builds each pull request and each merge, and uploads the result as an
artifact. These jobs wait for that run, download the build and put it where the web server serves it.
Nothing has to reach into the server, so it can sit behind a tunnel or NAT.
"""

from typing import Any

from change_agents.coder.runner import branch_name
from change_agents.coder.workspace import Workspace
from change_agents.config import get_settings
from change_agents.delivery import sites
from change_agents.delivery.github import GitHub


ARTIFACT = "site"


def preview_path(site_id: str, number: int) -> str:
    return f"previews/{site_id}/pr-{number}"


def url_for(path: str) -> str:
    return f"{get_settings().sites_base_url.rstrip('/')}/{path}/"


def publish_run(github: GitHub, site_id: str, run: dict[str, Any], path: str) -> str:
    """Downloads a successful run's build and publishes it at `path`. Returns its public URL."""
    sites.install(github.download_artifact(site_id, run["id"], ARTIFACT), path)
    return url_for(path)


def pull_request_body(data: dict[str, Any]) -> str:
    """The description reviewers on GitHub see: the request, the ticket and the automatic review."""
    criteria = "\n".join(f"- [x] {item}" for item in data.get("acceptanceCriteria") or [])
    review = data.get("review") or {}
    checks = "\n".join(
        f"- {'✅' if check['passed'] else ('⚠️' if check['level'] == 'warning' else '❌')} {check['name']}"
        for check in review.get("checks") or []
    )
    lines = [
        f"Ticket [#{data['ticketId']}]({data['ticketUrl']}) · made by the Coder Agent, approved by the Reviewer Agent.",
        "",
        "## Client request",
        "",
        "> " + data["request"].replace("\n", "\n> "),
        "",
        "## Ticket",
        "",
        data["details"],
    ]
    if criteria:
        lines += ["", "### Done when", "", criteria]
    if review:
        lines += ["", "## Automatic review", "", review.get("summary", ""), "", checks]
    lines += ["", "---", "Merging happens from the panel when the client approves the preview."]
    return "\n".join(lines)


def open_pull_request(data: dict[str, Any]) -> dict[str, Any]:
    site_id, ticket_id = data["siteId"], data["ticketId"]
    branch = branch_name(ticket_id)
    workspace = Workspace.reopen(site_id, f"{site_id}-ticket-{ticket_id}", branch, data["commit"])
    head = workspace.push()

    github = GitHub.from_settings()
    pull = github.open_pull_request(site_id, branch, f"{data['summary']} (ticket #{ticket_id})", pull_request_body(data))
    run = github.wait_for_run(site_id, "pull_request", head)
    result = {"prNumber": pull["number"], "prUrl": pull["html_url"], "headSha": head, "runUrl": run["html_url"]}
    if run["conclusion"] != "success":
        return {"status": "preview_failed", **result, "conclusion": run["conclusion"]}
    url = publish_run(github, site_id, run, preview_path(site_id, pull["number"]))
    return {"status": "preview_ready", **result, "previewUrl": url}


def merge_pull_request(data: dict[str, Any]) -> dict[str, Any]:
    site_id = data["siteId"]
    github = GitHub.from_settings()
    sha = github.merge(site_id, data["prNumber"], f"{data['summary']} (ticket #{data['ticketId']})")
    run = github.wait_for_run(site_id, "push", sha)
    result = {"mergeSha": sha, "runUrl": run["html_url"]}
    if run["conclusion"] != "success":
        return {"status": "deploy_failed", **result, "conclusion": run["conclusion"]}
    url = publish_run(github, site_id, run, site_id)
    sites.remove(preview_path(site_id, data["prNumber"]))  # the preview has done its job
    return {"status": "deployed", **result, "productionUrl": url}


def handle(data: dict[str, Any]) -> dict[str, Any]:
    return open_pull_request(data) if data["action"] == "open_pr" else merge_pull_request(data)


def publish_latest_production(site_id: str) -> str:
    """Publishes the latest successful build of main, e.g. to put a site online for the first time."""
    github = GitHub.from_settings()
    runs = github.latest_runs(site_id, event="push", branch="main")
    run = next((run for run in runs if run["conclusion"] == "success"), None)
    if run is None:
        raise RuntimeError(f"{site_id} has no successful build of main yet.")
    return publish_run(github, site_id, run, site_id)


def publish_site_main() -> None:
    """Usage: publish-site <site id> [<site id> ...]"""
    import sys

    for site_id in sys.argv[1:] or sys.exit("Usage: publish-site <site id> [<site id> ...]"):
        print(f"{site_id}: live at {publish_latest_production(site_id)}")
