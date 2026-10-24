"""Usage:
    review-run --ticket 11                        # a ticket from the database, on its branch
    review-run northside-accounting cli-a7fcec "Add a 'Why choose us' section" --request "..." --criteria "..."

Runs the checks and the Reviewer Agent on a ticket's branch and prints the verdict.
"""

import argparse
import sys
from typing import Any

from change_agents.config import get_settings
from change_agents.db import connect
from change_agents.llm import chat_model
from change_agents.reviewer.runner import intake_conversation, open_ticket_workspace, run_reviewer

MARKS = {True: "✓", False: "✗"}


def _ticket_from_db(ticket_id: int) -> dict[str, Any]:
    with connect() as connection:
        row = connection.execute(
            "SELECT id, site_id, summary, details, acceptance_criteria, request, branch, commit_sha FROM tickets WHERE id = %s",
            (ticket_id,),
        ).fetchone()
    if row is None or not row[6]:
        sys.exit(f"Ticket {ticket_id} not found, or it has no branch yet.")
    id_, site_id, summary, details, criteria, request, branch, commit = row
    return {"conversation": intake_conversation(ticket_id), "id": id_, "site_id": site_id, "summary": summary or request, "details": details, "acceptance_criteria": criteria, "request": request, "branch": branch, "commit": commit}


def _print_update(node: str, output: dict[str, Any]) -> None:
    if node == "checks":
        print("[checks]")
        for check in output["checks"]:
            mark = MARKS[check["passed"]] if check["level"] == "blocking" or check["passed"] else "!"
            print(f"  {mark} {check['name']}: {check['details']}")
            for finding in check["findings"][:3]:
                print(f"      {finding[:200]}")
    elif node == "review":
        print("[review]   " + ("invalid reply, retrying: " + output["error"] if output.get("error") else "review received"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Review a ticket's branch.")
    parser.add_argument("site_id", nargs="?")
    parser.add_argument("ticket_id", nargs="?", help="The id in the workspace name, e.g. cli-a7fcec")
    parser.add_argument("summary", nargs="?")
    parser.add_argument("--ticket", type=int, help="Use a ticket from the database instead.")
    parser.add_argument("--request", default="", help="The client's own words.")
    parser.add_argument("--details", default="")
    parser.add_argument("--criteria", action="append", default=[], help="An acceptance criterion (repeatable).")
    args = parser.parse_args()

    if args.ticket:
        ticket = _ticket_from_db(args.ticket)
    elif args.site_id and args.ticket_id and args.summary:
        ticket = {"id": args.ticket_id, "site_id": args.site_id, "summary": args.summary, "details": args.details, "acceptance_criteria": args.criteria, "request": args.request or args.summary, "branch": f"agent/ticket-{args.ticket_id}", "commit": "HEAD"}
    else:
        parser.error("give --ticket ID, or a site id, the workspace's ticket id and a summary")

    settings = get_settings()
    print(f"Reviewing ticket {ticket['id']} on {ticket['site_id']} with {settings.reviewer_model}\n")
    try:
        workspace = open_ticket_workspace(ticket["site_id"], ticket["id"], ticket["branch"], ticket["commit"])
        result = run_reviewer(ticket, workspace, chat_model(settings.reviewer_model), on_update=_print_update)
    except Exception as error:  # provider and git errors are long; show the useful part
        sys.exit(f"\nThe reviewer stopped: {type(error).__name__}: {str(error)[:500]}")

    print(f"\nVerdict: {result['status'].upper()} (decided by the {result['decidedBy']})")
    print(f"Summary: {result['summary']}")
    for item in result["criteria"]:
        print(f"  {MARKS[item['met']]} {item['criterion']} — {item['evidence']}")
    for issue in result["issues"]:
        print(f"  [{issue['severity']}] {issue['file'] or ''} {issue['problem']}\n      fix: {issue['fix']}")
    print(f"usage: {result['usage']} · {result['seconds']}s")
