"""The plan the Coder Agent writes before touching any file (structured output)."""

from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator


class PlannedStep(BaseModel):
    file: str = Field(description='Repository path, e.g. "src/data/business.json".')
    action: Literal["edit", "create"]
    what: str = Field(description="One sentence: what changes in this file.")


class ChangePlan(BaseModel):
    understanding: str = Field(description="One or two sentences: what the ticket asks for, in your own words.")
    feasible: bool = Field(
        description="false if the change needs files agents may not touch (layouts, package.json, config, "
        "workflows), new dependencies or external scripts. Otherwise true."
    )
    blocker: str | None = Field(default=None, description="Only when feasible is false: why, in one sentence.")
    steps: list[PlannedStep] = Field(
        default_factory=list, description="The smallest set of file changes that does the ticket. Empty if not feasible."
    )

    @model_validator(mode="after")
    def consistent(self) -> Self:
        if self.feasible and not self.steps:
            raise ValueError("a feasible plan needs at least one step")
        if not self.feasible and not self.blocker:
            raise ValueError("an unfeasible plan needs a blocker")
        return self
