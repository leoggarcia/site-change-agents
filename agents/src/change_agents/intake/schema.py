"""What the Intake Agent must return on every turn (structured output).

Field descriptions are sent to the model as part of the JSON schema. Pydantic then checks the reply:
anything that fails here goes back to the model with the error message, so it can fix its answer.
"""

from typing import Literal, Self

from pydantic import BaseModel, Field, model_validator

ChangeType = Literal["content_update", "style_change", "new_section", "image_change"]
Risk = Literal["low", "medium", "high"]


class Target(BaseModel):
    page: str = Field(
        description='Route of the page from the project summary, e.g. "/" or "/menu/". '
        'Use "global" for parts shared by every page, like the header or the footer.'
    )
    section: str = Field(description='Section name from the project summary, e.g. "Footer" or "Opening hours".')


class TicketDraft(BaseModel):
    summary: str = Field(max_length=90, description='Short title in plain words, e.g. "Update the phone number in the footer".')
    change_type: ChangeType
    target: Target
    details: str = Field(
        description="Exactly what changes, with the current and the new values when there are any, "
        'e.g. "Change 618 123 4567 to 618 765 4321". Everything the developer needs, nothing invented.'
    )
    acceptance_criteria: list[str] = Field(
        min_length=1,
        max_length=5,
        description="1 to 5 checks a reviewer can verify on the preview, each one sentence.",
    )
    risk: Risk = Field(
        description="low: text or image swap. medium: style changes or anything on several pages. "
        "high: new sections or changes to navigation or layout."
    )


class IntakeDecision(BaseModel):
    # Asked for first, so the model writes down what it knows before it picks an action.
    reasoning: str = Field(
        description="Internal note for the agency, one or two sentences: what is clear, what is missing "
        "and why you chose this action. The client never sees it."
    )
    action: Literal["ask_client", "create_ticket", "out_of_scope"]
    question: str | None = Field(
        default=None,
        description="Only for ask_client: ONE short question in plain, friendly language a non-technical client "
        "can answer in a few words. Otherwise null.",
    )
    ticket: TicketDraft | None = Field(default=None, description="Only for create_ticket. Otherwise null.")
    client_message: str | None = Field(
        default=None,
        description="Only for out_of_scope: two or three friendly sentences to the client saying what is not "
        "included and what they can do instead, citing the plan. Otherwise null.",
    )
    sources: list[str] = Field(
        default_factory=list,
        description='Client knowledge sources you relied on, written as "title › heading". Empty if none.',
    )

    @model_validator(mode="after")
    def matches_action(self) -> Self:
        required = {"ask_client": "question", "create_ticket": "ticket", "out_of_scope": "client_message"}[self.action]
        if not getattr(self, required):
            raise ValueError(f'action "{self.action}" requires the "{required}" field')
        return self
