from langchain_core.messages import AIMessage, BaseMessage

from change_agents.coder.workspace import BuildResult, DiffStat
from change_agents.reviewer.checks import added_lines, check_active_content, check_new_links, check_secrets, run_checks
from change_agents.reviewer.graph import build_reviewer_graph, initial_state
from change_agents.reviewer.schema import Review

PHONE_DIFF = """\
diff --git a/src/data/business.json b/src/data/business.json
--- a/src/data/business.json
+++ b/src/data/business.json
@@ -3,3 +3,3 @@
-  "phone": "618 123 4567",
+  "phone": "618 765 4321",
"""

TICKET = {
    "id": 11,
    "site_id": "test-site",
    "summary": "Update the phone number",
    "details": "Change 618 123 4567 to 618 765 4321",
    "acceptance_criteria": ["The footer shows 618 765 4321"],
    "request": "Please change our phone to 618 765 4321",
}


class FakeBranch:
    def __init__(self, diff: str = PHONE_DIFF, files: list[tuple[str, str]] | None = None, build: bool = True) -> None:
        self.diff, self.files, self.build_passes, self.builds = diff, files or [("M", "src/data/business.json")], build, 0

    def branch_diff(self) -> str:
        return self.diff

    def branch_files(self) -> list[tuple[str, str]]:
        return self.files

    def branch_stat(self) -> DiffStat:
        return DiffStat([path for _, path in self.files], 1, 1)

    def build(self) -> BuildResult:
        self.builds += 1
        return BuildResult(self.build_passes, "" if self.build_passes else "error: Unexpected token")


class ScriptedReviewer:
    def __init__(self, reviews: list[Review]) -> None:
        self.reviews, self.calls = reviews, 0
        self.seen: list[BaseMessage] = []

    def with_structured_output(self, schema, include_raw=False):  # noqa: ANN001
        model = self

        class Structured:
            def invoke(self, messages: list[BaseMessage]) -> dict:
                model.calls += 1
                model.seen = messages
                return {"raw": AIMessage(content=""), "parsed": model.reviews.pop(0), "parsing_error": None}

        return Structured()


def review(met: bool = True, issues: list[dict] | None = None, added: list[dict] | None = None) -> Review:
    return Review(
        reasoning="The diff changes the phone number.",
        criteria=[{"criterion": "The footer shows 618 765 4321", "met": met, "evidence": "business.json line 4"}],
        added_text=added or [{"text": "618 765 4321", "source": "client"}],
        issues=issues or [],
        summary="Phone updated.",
    )


def run(branch: FakeBranch, reviews: list[Review]) -> tuple[dict, ScriptedReviewer]:
    model = ScriptedReviewer(reviews)
    graph = build_reviewer_graph(model, branch, lambda site, query: "Source: plan › includes\nText updates.")
    return graph.invoke(initial_state(TICKET))["outcome"], model


def test_reads_added_lines_per_file() -> None:
    assert added_lines(PHONE_DIFF) == [("src/data/business.json", '  "phone": "618 765 4321",')]


def test_finds_secrets_and_active_content() -> None:
    added = [
        ("src/data/business.json", '  "mapsKey": "AIzaSyA1234567890abcdefghijklmnopqrstuv",'),
        ("src/components/Footer.astro", '<script src="https://evil.example/x.js"></script>'),
        ("src/components/Footer.astro", '<a href="#" onclick="steal()">Hi</a>'),
    ]
    assert check_secrets(added).findings == ["Possible Google API key in src/data/business.json"]
    assert [finding.split(" added")[0] for finding in check_active_content(added).findings] == ["<script> tag", "inline event handler"]


def test_new_links_are_a_warning_not_a_failure() -> None:
    diff = "+++ b/src/data/business.json\n+  \"facebook\": \"https://facebook.com/luna\",\n-  \"x\": \"https://instagram.com/luna\",\n"
    result = check_new_links(diff)
    assert (result.passed, result.level, result.findings) == (False, "warning", ["New link to facebook.com"])


def test_build_only_runs_when_cheaper_checks_pass() -> None:
    branch = FakeBranch(files=[("M", "package.json")])
    checks = run_checks(branch)
    assert [check.name for check in checks if not check.passed] == ["Allowed files"]
    assert branch.builds == 0


def test_approves_a_correct_change() -> None:
    outcome, model = run(FakeBranch(), [review()])

    assert outcome["status"] == "approved"
    assert outcome["decidedBy"] == "reviewer"
    assert "618 765 4321" in model.seen[1].content  # the reviewer saw the diff and the client's words


def test_failed_checks_reject_without_a_model_call() -> None:
    outcome, model = run(FakeBranch(build=False), [])

    assert outcome["status"] == "changes_requested"
    assert outcome["decidedBy"] == "checks"
    assert outcome["issues"][0]["problem"].startswith("Build check failed")
    assert model.calls == 0


def test_the_approval_rule_lives_in_code() -> None:
    # A major issue means changes requested, whatever the model's summary says.
    major = {"severity": "major", "file": "src/components/Hero.astro", "problem": "Headline changed too.", "fix": "Revert it."}
    outcome, _ = run(FakeBranch(), [review(issues=[major])])
    assert outcome["status"] == "changes_requested"

    minor = {"severity": "minor", "file": None, "problem": "Could add a space.", "fix": "Optional."}
    outcome, _ = run(FakeBranch(), [review(issues=[minor])])
    assert outcome["status"] == "approved"

    outcome, _ = run(FakeBranch(), [review(met=False)])
    assert outcome["status"] == "changes_requested"


def test_asks_again_when_criteria_are_skipped() -> None:
    skipped = Review(reasoning="x", criteria=[], added_text=[], issues=[], summary="ok")
    outcome, model = run(FakeBranch(), [skipped, review()])

    assert model.calls == 2
    assert outcome["status"] == "approved"


def test_invented_text_blocks_approval_even_if_the_model_raises_no_issue() -> None:
    added = [{"text": "618 765 4321", "source": "client"}, {"text": "Call us, we never sleep!", "source": "invented"}]
    outcome, _ = run(FakeBranch(), [review(added=added)])

    assert outcome["status"] == "changes_requested"
    assert outcome["issues"] == [
        {"severity": "major", "file": None, "problem": "Text nobody asked for: “Call us, we never sleep!”.", "fix": "Remove it, or ask the client for the text."}
    ]
