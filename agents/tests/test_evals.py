from pathlib import Path

from change_agents.evals import coder, intake

TICKET = {
    "summary": "Update the phone number",
    "change_type": "content_update",
    "target": {"page": "global", "section": "Footer"},
    "details": "Change 618 123 4567 to 618 765 4321.",
    "acceptance_criteria": ["The footer shows 618 765 4321"],
}


def run(outcome: str = "ticket", questions: list[str] | None = None, ticket: dict | None = TICKET) -> dict:
    return {"outcome": outcome, "questions": questions or [], "ticket": ticket if outcome == "ticket" else None, "usage": {}, "seconds": 1}


def case(**expect: object) -> dict:
    return {"id": "x", "expect": {"outcome": "ticket", **expect}}


def test_a_correct_ticket_passes_every_check() -> None:
    result = intake.score(case(asks=False, change_type="content_update", mentions=["618 765 4321"]), run())
    assert result["passed"]
    assert result["checks"] == {"outcome": True, "asks": True, "change_type": True, "mentions": True, "forbids": None}


def test_alternatives_and_case_do_not_matter() -> None:
    result = intake.score(case(mentions=["FOOTER", "6 pm|618 765 4321"], change_type="new_section|content_update"), run())
    assert result["passed"]


def test_each_failure_is_named() -> None:
    result = intake.score(case(asks=False, mentions=["555 0000"], forbids=["618"]), run(questions=["Which number?"]))
    assert result["failed"] == ["asks", "mentions", "forbids"]


def test_out_of_scope_skips_the_ticket_checks() -> None:
    result = intake.score({"id": "x", "expect": {"outcome": "out_of_scope", "asks": False}}, run(outcome="out_of_scope"))
    assert result["passed"]
    assert result["checks"]["mentions"] is None


def test_metrics_count_scope_precision_and_needless_questions() -> None:
    rows = []
    for expected, got, asks_expected, asked in [
        ("out_of_scope", "out_of_scope", False, False),
        ("ticket", "out_of_scope", False, False),  # a false "not in your plan"
        ("ticket", "ticket", True, True),
        ("ticket", "ticket", False, True),  # a needless question
    ]:
        c = {"id": "x", "expect": {"outcome": expected, "asks": asks_expected}}
        r = run(outcome=got, questions=["?"] if asked else [])
        rows.append({"case": c, "run": r, "score": intake.score(c, r)})

    metrics = intake.summarize(rows)
    assert (metrics["out_of_scope_recall"], metrics["out_of_scope_precision"]) == (1.0, 0.5)
    assert (metrics["asks_when_needed"], metrics["no_needless_questions"]) == (1.0, 0.667)


def test_coder_checks_read_the_built_html(tmp_path: Path) -> None:
    (tmp_path / "menu").mkdir()
    (tmp_path / "menu" / "index.html").write_text("<td>Cold Brew</td><td>$5.00</td>")
    golden = {"site_checks": [{"page": "menu/index.html", "contains": "$5.00"}, {"page": "menu/index.html", "not_contains": "$4.75"}]}

    assert coder.score(golden, {"status": "done", "dist": str(tmp_path)})["passed"]
    stopped = coder.score(golden, {"status": "needs_human", "dist": str(tmp_path)})
    assert not stopped["passed"] and len(stopped["failed"]) == 2  # a coder that stopped fails every check
