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


def evaluate(model_name: str, only: list[str] | None = None, verbose: bool = True) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Plants each case on a branch and reviews it. Returns the rows and the metrics."""
    data = json.loads(DATASET.read_text())
    cases = [case for case in data["cases"] if not only or case["id"] in only]
    model = chat_model(model_name)
    workspace = Workspace.create(SITE, f"eval-review-{SITE}", "eval/base")
    workspace.install()

    rows = []
    started = time.monotonic()
    for case in cases:
        _plant(workspace, case)
        ticket = {"id": case["id"], "site_id": SITE, "conversation": [], **data["tickets"][case["ticket"]]}
        result = run_reviewer(ticket, workspace, model)
        rows.append({"case": case, "run": result})
        if verbose:
            first = result["issues"][0]["problem"] if result["issues"] else "-"
            print(f"{case['id']:22} expected {case['expect']:8} → {result['status']:17} by {result['decidedBy']:8}  {first[:90]}")

    bad = [row for row in rows if row["case"]["expect"] == "reject"]
    good = [row for row in rows if row["case"]["expect"] == "approve"]
    caught = [row for row in bad if row["run"]["status"] == "changes_requested"]
    metrics = {
        "cases": len(rows),
        "bad_caught": round(len(caught) / len(bad), 3) if bad else None,
        "caught_by_checks": sum(row["run"]["decidedBy"] == "checks" for row in caught),
        "caught_by_reviewer": sum(row["run"]["decidedBy"] == "reviewer" for row in caught),
        "good_approved": round(sum(row["run"]["status"] == "approved" for row in good) / len(good), 3) if good else None,
        "missed": [row["case"]["id"] for row in bad if row["run"]["status"] != "changes_requested"],
        "false_rejections": [row["case"]["id"] for row in good if row["run"]["status"] != "approved"],
        "model_calls": sum(row["run"]["usage"].get("model_calls", 0) for row in rows),
        "total_seconds": round(time.monotonic() - started),
    }
    return rows, metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure what the checks and the Reviewer Agent catch.")
    parser.add_argument("--only", nargs="*", help="Case ids to run.")
    args = parser.parse_args()

    settings = get_settings()
    print(f"Reviewing planted changes on {SITE} with {settings.reviewer_model}\n")
    _, metrics = evaluate(settings.reviewer_model, args.only)
    print()
    for name, value in metrics.items():
        print(f"  {name:20} {value}")
