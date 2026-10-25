"""Usage: uv run evals/run.py {intake,coder,reviewer,all} [--only ID ...] [--site SITE] [--model provider:model] [--label NAME]

intake:   every golden case (evals/golden.jsonl): questions, scope and ticket values.
coder:    the golden cases with a reference ticket: build, commit and checks on the built HTML.
reviewer: the planted good and bad changes (evals/review_cases.json).
all:      the three, then one summary table.
Results are saved to evals/results/ so runs can be compared.
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from change_agents.config import get_settings
from change_agents.evals import coder, intake
from change_agents.llm import chat_model
from change_agents.reviewer import evaluate as reviewer_eval

EVALS_DIR = Path(__file__).resolve().parents[3] / "evals"
DATASET = EVALS_DIR / "golden.jsonl"
RESULTS = EVALS_DIR / "results"
CONTEXTS = EVALS_DIR / "fixtures" / "intake_contexts.json"

# The CI subset: a few cases of every kind (clear, missing info, out of scope, injection, brand), ~15 model calls.
CI_CASES = [
    "luna-phone-clear", "luna-phone-missing", "luna-online-ordering", "luna-prompt-injection",
    "bs-friday-hours", "bs-emergency-missing", "bs-online-booking", "bs-off-brand-headline",
    "ns-starter-price", "ns-careers-page", "ns-document-portal", "ns-send-invoice",
]
# CI fails when a metric drops below these.
CI_THRESHOLDS = {"pass_rate": 0.8, "out_of_scope_recall": 0.9, "ticket_values_correct": 0.9}


def load_cases(only: list[str] | None = None, site: str | None = None) -> list[dict[str, Any]]:
    cases = [json.loads(line) for line in DATASET.read_text().splitlines() if line.strip()]
    return [case for case in cases if (not only or case["id"] in only) and (not site or case["site"] == site)]


def _mark(ok: bool | None) -> str:
    return "·" if ok is None else ("✓" if ok else "✗")


def freeze_contexts(cases: list[dict[str, Any]]) -> None:
    """Saves what retrieval returns for each case, for evals that must run without the database (CI)."""
    from change_agents.intake.context import load_context

    contexts = {case["id"]: load_context(case["site"], case["request"]) for case in cases}
    CONTEXTS.parent.mkdir(parents=True, exist_ok=True)
    CONTEXTS.write_text(json.dumps(contexts, indent=1, ensure_ascii=False))
    print(f"Saved the retrieval context of {len(contexts)} cases to {CONTEXTS.relative_to(EVALS_DIR.parent)}")


def run_intake(
    cases: list[dict[str, Any]], model_name: str, frozen: bool = False
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    model = chat_model(model_name)
    contexts = json.loads(CONTEXTS.read_text()) if frozen else {}
    rows = []
    print(f"{'case':32} {'outcome':13} {'asked':5}  out ask typ val ban  {'calls':>5} {'secs':>5}")
    for case in cases:
        try:
            if frozen:
                run = intake.run_case(case, model, intake.frozen_retriever(contexts[case["id"]]))
            else:
                run = intake.run_case(case, model)
        except Exception as error:  # a provider error fails the case, not the whole eval
            run = {"outcome": f"error: {type(error).__name__}", "questions": [], "ticket": None, "usage": {}, "seconds": 0}
        result = intake.score(case, run)
        rows.append({"case": case, "run": run, "score": result})
        c = result["checks"]
        print(
            f"{case['id']:32} {run['outcome'][:13]:13} {len(run['questions']):>5}  "
            f" {_mark(c['outcome'])}   {_mark(c['asks'])}   {_mark(c['change_type'])}   {_mark(c['mentions'])}   {_mark(c['forbids'])}"
            f"  {run['usage'].get('model_calls', 0):>5} {run['seconds']:>5}"
        )
    return rows, intake.summarize(rows)


MIN_NODE = (22, 23, 4)  # Astro 7's requirement (the sites' package.json "engines")


def check_node() -> None:
    """Fails before any model call if the local Node can't build the sites, instead of letting the
    coder spend its fix rounds on a build that can never pass."""
    try:
        version = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        sys.exit("The coder eval needs Node to build the sites, and `node` was not found.")
    if tuple(int(part) for part in version.lstrip("v").split(".")) < MIN_NODE:
        sys.exit(f"Node {version} can't build the sites (they need {'.'.join(map(str, MIN_NODE))} or newer). Run `nvm use` in the project first.")


def run_coder(cases: list[dict[str, Any]], model_name: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    check_node()
    model = chat_model(model_name)
    rows = []
    print(f"{'case':32} {'result':12} {'checks':7} {'files':>5} {'builds':>6} {'calls':>5} {'secs':>5}")
    for case in [case for case in cases if case.get("ticket")]:
        try:
            run = coder.run_case(case, model)
        except Exception as error:  # a provider or git error fails the case, not the whole eval
            run = {"status": f"error: {type(error).__name__}", "dist": "", "usage": {}, "seconds": 0}
        result = coder.score(case, run)
        rows.append({"case": case, "run": run, "score": result})
        passed = sum(check["ok"] for check in result["checks"])
        print(
            f"{case['id']:32} {run['status'][:12]:12} {passed}/{len(result['checks']):<5} {len(run.get('files', [])):>5}"
            f" {run.get('buildRounds', '-'):>6} {run.get('usage', {}).get('model_calls', 0):>5} {run.get('seconds', 0):>5}"
        )
    return rows, coder.summarize(rows)


def _print_metrics(metrics: dict[str, Any]) -> None:
    for name, value in metrics.items():
        print(f"  {name:24} {value}")


def _save(agent: str, model_name: str, label: str, metrics: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    path = RESULTS / f"{agent}-{stamp}{'-' + label if label else ''}.json"
    path.write_text(json.dumps({"agent": agent, "model": model_name, "label": label, "metrics": metrics, "rows": rows}, indent=2, ensure_ascii=False))
    print(f"Saved {path.relative_to(EVALS_DIR.parent)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the evals on the golden dataset.")
    parser.add_argument("agent", choices=["intake", "coder", "reviewer", "all", "freeze"])
    parser.add_argument("--only", nargs="*", help="Case ids to run.")
    parser.add_argument("--site", help="Only the cases of one site.")
    parser.add_argument("--model", help="Override the agent's model, e.g. google_genai:gemini-3.8-flash.")
    parser.add_argument("--label", default="", help="A name for this run in the results file, e.g. 'baseline'.")
    parser.add_argument("--frozen", action="store_true", help="Intake: use the saved retrieval contexts (no database).")
    parser.add_argument("--ci", action="store_true", help="Intake: the CI subset, frozen, failing below the thresholds.")
    args = parser.parse_args()

    settings = get_settings()
    cases = load_cases(CI_CASES if args.ci else args.only, args.site)
    if args.agent == "freeze":
        freeze_contexts(cases)
        return
    agents = ["intake", "coder", "reviewer"] if args.agent == "all" else [args.agent]
    models = {"intake": settings.intake_model, "coder": settings.coder_model, "reviewer": settings.reviewer_model}
    summary: dict[str, dict[str, Any]] = {}

    for agent in agents:
        model_name = args.model or models[agent]
        print(f"\n=== {agent} · {model_name}\n")
        started = time.monotonic()
        if agent == "intake":
            rows, metrics = run_intake(cases, model_name, frozen=args.frozen or args.ci)
        elif agent == "coder":
            rows, metrics = run_coder(cases, model_name)
        else:
            rows, metrics = reviewer_eval.evaluate(model_name, args.only if args.agent == "reviewer" else None)
        metrics.setdefault("total_seconds", round(time.monotonic() - started))
        print("\nMetrics")
        _print_metrics(metrics)
        if agent == "intake":
            for row in [row for row in rows if not row["score"]["passed"]]:
                run = row["run"]
                detail = run["questions"][0] if run["questions"] else (run["ticket"] or {}).get("details") or run.get("message") or ""
                print(f"  ✗ {row['case']['id']}: failed {', '.join(row['score']['failed'])} · {str(detail)[:140]}")
        elif agent == "coder":
            for row in [row for row in rows if not row["score"]["passed"]]:
                reason = row["run"].get("message") or "; ".join(
                    f"{check['page']} {'missing' if 'contains' in check else 'still has'} {check.get('contains') or check.get('not_contains')}"
                    for check in row["score"]["failed"]
                )
                print(f"  ✗ {row['case']['id']}: {reason[:160]}")
        if not args.ci:
            _save(agent, model_name, args.label, metrics, rows)
        summary[agent] = metrics

    if args.ci:
        below = {name: metrics[name] for name, minimum in CI_THRESHOLDS.items() if (metrics[name] or 0) < minimum}
        if below:
            sys.exit(f"\nQuality below the CI thresholds {CI_THRESHOLDS}: {below}")
        print(f"\nAll metrics at or above the CI thresholds {CI_THRESHOLDS}.")

    if len(summary) > 1:
        print("\n=== Summary")
        intake_m, coder_m, review_m = summary["intake"], summary["coder"], summary["reviewer"]
        print(f"  Intake    pass {intake_m['pass_rate']:.0%} · out of scope recall {intake_m['out_of_scope_recall']:.0%} / precision {intake_m['out_of_scope_precision']:.0%} · asks when needed {intake_m['asks_when_needed']:.0%} · {intake_m['avg_model_calls']} calls/case")
        print(f"  Coder     success {coder_m['success_rate']:.0%} · built {coder_m['build_and_commit_rate']:.0%} · {coder_m['avg_model_calls']} calls, {coder_m['avg_seconds']} s per ticket")
        print(f"  Reviewer  bad caught {review_m['bad_caught']:.0%} ({review_m['caught_by_checks']} checks, {review_m['caught_by_reviewer']} reviewer) · good approved {review_m['good_approved']:.0%}")


if __name__ == "__main__":
    main()
