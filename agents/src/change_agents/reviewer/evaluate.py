"""Usage: review-eval [--only CASE_ID ...]

Plants good and bad changes on branches of a site (evals/review_cases.json), runs the checks and the
Reviewer Agent on each, and reports what was caught, by what, and which good changes were approved.
The edits are applied directly, skipping the coder's policy, to simulate a coder that got it wrong.
"""

import argparse
import json
import time
from pathlib import Path
from typing import Any

from change_agents.coder.workspace import Workspace, _git
from change_agents.config import get_settings
from change_agents.llm import chat_model
from change_agents.reviewer.runner import run_reviewer

DATASET = Path(__file__).resolve().parents[3] / "evals" / "review_cases.json"
SITE = "luna-cafe"


def _apply(workspace: Workspace, edits: list[dict[str, str]]) -> None:
    for edit in edits:
        path = workspace.root / edit["file"]
        content = path.read_text(encoding="utf-8")
        if content.count(edit["old"]) != 1:
            raise ValueError(f"{edit['file']}: the text to replace must appear exactly once: {edit['old']!r}")
        path.write_text(content.replace(edit["old"], edit["new"], 1), encoding="utf-8")


def _plant(workspace: Workspace, case: dict[str, Any]) -> None:
    branch = f"eval/{case['id']}"
    _git(workspace.root, "checkout", "--quiet", "-B", branch, "origin/main")
    _git(workspace.root, "clean", "--quiet", "-fd")
    workspace.branch = branch
    _apply(workspace, case["edits"])
    workspace.commit(f"Eval case {case['id']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure what the checks and the Reviewer Agent catch.")
    parser.add_argument("--only", nargs="*", help="Case ids to run.")
    args = parser.parse_args()

    data = json.loads(DATASET.read_text())
    cases = [case for case in data["cases"] if not args.only or case["id"] in args.only]
    settings = get_settings()
    model = chat_model(settings.reviewer_model)

    print(f"Reviewing {len(cases)} planted changes on {SITE} with {settings.reviewer_model}\n")
    workspace = Workspace.create(SITE, f"eval-review-{SITE}", "eval/base")
    workspace.install()

    rows = []
    started = time.monotonic()
    for case in cases:
        _plant(workspace, case)
        ticket = {"id": case["id"], "site_id": SITE, "conversation": [], **data["tickets"][case["ticket"]]}
        result = run_reviewer(ticket, workspace, model)
        rows.append((case, result))
        first = result["issues"][0]["problem"] if result["issues"] else "-"
        print(f"{case['id']:22} expected {case['expect']:8} → {result['status']:17} by {result['decidedBy']:8}  {first[:90]}")

    bad = [(case, result) for case, result in rows if case["expect"] == "reject"]
    good = [(case, result) for case, result in rows if case["expect"] == "approve"]
    caught = [(case, result) for case, result in bad if result["status"] == "changes_requested"]
    by_checks = [case for case, result in caught if result["decidedBy"] == "checks"]
    approved = [case for case, result in good if result["status"] == "approved"]
    calls = sum(result["usage"].get("model_calls", 0) for _, result in rows)

    print(f"\nBad changes caught:    {len(caught)}/{len(bad)}  ({len(by_checks)} by the checks, {len(caught) - len(by_checks)} by the reviewer)")
    print(f"Good changes approved: {len(approved)}/{len(good)}")
    missed = [case["id"] for case, result in bad if result["status"] != "changes_requested"]
    rejected = [case["id"] for case, result in good if result["status"] != "approved"]
    if missed:
        print(f"Missed:                {', '.join(missed)}")
    if rejected:
        print(f"Good but rejected:     {', '.join(rejected)}")
    print(f"Model calls: {calls} · {round(time.monotonic() - started)}s")
