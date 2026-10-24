"""What the Reviewer Agent returns (structured output).

The model gives judgments (is each criterion met, what is wrong and how bad); the approval rule is applied
in code from those judgments (see `decide`), so the model can't approve a change it found problems in.
"""

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["blocker", "major", "minor"]


class CriterionCheck(BaseModel):
    criterion: str = Field(description="One acceptance criterion from the ticket, copied as written.")
    met: bool
    evidence: str = Field(description="Where in the diff it is (or isn't) done, in one sentence.")


class Issue(BaseModel):
    severity: Severity = Field(
        description="blocker: wrong, harmful or not what was asked. major: missing part of the ticket, "
        "unrequested change, invented content or a brand-guide violation. minor: small polish, doesn't block."
    )
    file: str | None = Field(default=None, description="Repository path, if the issue is in one file.")
    problem: str = Field(description="What is wrong, in one or two sentences.")
    fix: str = Field(description="What the developer should do, concretely.")


class AddedText(BaseModel):
    text: str = Field(description="A sentence, heading, label or value the diff adds to what visitors see.")
    source: Literal["client", "ticket", "site", "invented"] = Field(
        description="Where it comes from: the client's words or answers, the ticket, text already on the site "
        "(moved or reused), or none of them (invented)."
    )


class Review(BaseModel):
    # Written first so the verdict follows from the reading.
    reasoning: str = Field(description="Two or three sentences: what the diff does compared with the ticket.")
    criteria: list[CriterionCheck] = Field(description="One entry per acceptance criterion in the ticket.")
    added_text: list[AddedText] = Field(
        description="Every piece of visible text the diff adds (not code, class names or styles). Empty if none."
    )
    issues: list[Issue] = Field(description="Every problem found. Empty if none.")
    summary: str = Field(description="One or two sentences for the agency: the change and the verdict.")

    def all_issues(self) -> list[Issue]:
        """The model's issues plus one for each piece of invented text, which the rules treat as major."""
        invented = [
            Issue(
                severity="major",
                problem=f"Text nobody asked for: “{item.text}”.",
                fix="Remove it, or ask the client for the text.",
            )
            for item in self.added_text
            if item.source == "invented"
        ]
        return [*self.issues, *invented]


def decide(review: Review) -> bool:
    """Approved only when every criterion is met and no issue is blocker or major (invented text included)."""
    return all(item.met for item in review.criteria) and not any(
        issue.severity in ("blocker", "major") for issue in review.all_issues()
    )
