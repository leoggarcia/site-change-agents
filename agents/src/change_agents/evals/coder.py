"""Evaluates the Coder Agent on the golden cases that have a reference ticket.

The coder gets the reference ticket (not the Intake Agent's), so this measures the coder alone. Success
is checked on the built site: the HTML in dist/ must contain the new values and no longer the old ones.
"""

from typing import Any

from langchain_core.language_models import BaseChatModel

from change_agents.coder.runner import run_coder
from change_agents.config import get_settings


def run_case(case: dict[str, Any], model: BaseChatModel) -> dict[str, Any]:
    ticket = {"id": f"eval-{case['id']}", "site_id": case["site"], **case["ticket"]}
    result = run_coder(ticket, model)
    dist = get_settings().workspaces_dir / f"{case['site']}-ticket-{ticket['id']}" / "dist"
    return {**result, "dist": str(dist)}


def score(case: dict[str, Any], run: dict[str, Any]) -> dict[str, Any]:
    """Every site check must hold on the built HTML. A coder that stopped (needs_human) fails them all."""
    built = run["status"] == "done"
    results = []
    for check in case["site_checks"]:
        page = f"{run['dist']}/{check['page']}"
        try:
            html = open(page, encoding="utf-8").read() if built else ""
        except FileNotFoundError:
            html = ""
        ok = built and bool(html) and (check["contains"] in html if "contains" in check else check["not_contains"] not in html)
        results.append({**check, "ok": ok})
    failed = [check for check in results if not check["ok"]]
    return {"built": built, "checks": results, "passed": built and not failed, "failed": failed}


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    done = [row for row in rows if row["score"]["built"]]
    usage = [row["run"].get("usage", {}) for row in rows]
    return {
        "cases": len(rows),
        "success_rate": round(sum(row["score"]["passed"] for row in rows) / len(rows), 3),
        "build_and_commit_rate": round(len(done) / len(rows), 3),
        "first_build_passed": round(sum(row["run"].get("buildRounds") == 1 for row in done) / len(done), 3) if done else None,
        "avg_files_changed": round(sum(len(row["run"].get("files", [])) for row in done) / len(done), 2) if done else None,
        "avg_model_calls": round(sum(item.get("model_calls", 0) for item in usage) / len(rows), 2),
        "avg_input_tokens": round(sum(item.get("input_tokens", 0) for item in usage) / len(rows)),
        "avg_output_tokens": round(sum(item.get("output_tokens", 0) for item in usage) / len(rows)),
        "avg_seconds": round(sum(row["run"].get("seconds", 0) for row in rows) / len(rows), 1),
    }
