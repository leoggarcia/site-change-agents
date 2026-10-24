import pytest
from langchain_core.messages import AIMessage, BaseMessage
from langgraph.checkpoint.memory import InMemorySaver
from pydantic import ValidationError

from change_agents.intake.context import IntakeContext
from change_agents.intake.graph import build_intake_graph
from change_agents.intake.runner import IntakeRunner, NotWaitingForAnswer
from change_agents.intake.schema import IntakeDecision

TICKET = {
    "summary": "Update the phone number in the footer",
    "change_type": "content_update",
    "target": {"page": "global", "section": "Footer"},
    "details": "Change 618 123 4567 to 618 765 4321",
    "acceptance_criteria": ["The footer shows 618 765 4321 on every page"],
    "risk": "low",
}


def ask(question: str) -> IntakeDecision:
    return IntakeDecision(reasoning="The new number is missing.", action="ask_client", question=question)


def ticket(**changes: object) -> IntakeDecision:
    return IntakeDecision(reasoning="All clear.", action="create_ticket", ticket={**TICKET, **changes})


class ScriptedModel:
    """Stands in for a chat model with structured output: replays decisions (or parsing errors)."""

    def __init__(self, replies: list[IntakeDecision | Exception]) -> None:
        self.replies = replies
        self.calls: list[list[BaseMessage]] = []

    def with_structured_output(self, schema, include_raw=False):  # noqa: ANN001
        model = self

        class Structured:
            def invoke(self, messages: list[BaseMessage]) -> dict:
                model.calls.append(messages)
                reply = model.replies.pop(0)
                if isinstance(reply, Exception):
                    return {"raw": AIMessage(content="{}"), "parsed": None, "parsing_error": reply}
                return {"raw": AIMessage(content=""), "parsed": reply, "parsing_error": None}

        return Structured()


class Retriever:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def __call__(self, site_id: str, query: str) -> IntakeContext:
        self.queries.append(query)
        return {
            "project_summary": "Pages: / and /menu/",
            "routes": ["/", "/menu/"],
            "client_knowledge": "Source: plan › includes\nText updates.",
            "site_search": "src/data/business.json: contact details\n618 123 4567",
        }


def _raising(model: ScriptedModel):  # noqa: ANN202
    """A structured model whose call raises the scripted exception, like a provider outage."""

    def with_structured_output(schema, include_raw=False):  # noqa: ANN001
        class Structured:
            def invoke(self, messages: list[BaseMessage]) -> dict:
                model.calls.append(messages)
                reply = model.replies.pop(0)
                if isinstance(reply, Exception):
                    raise reply
                return {"raw": AIMessage(content=""), "parsed": reply, "parsing_error": None}

        return Structured()

    return with_structured_output


def make_runner(replies: list[IntakeDecision | Exception]) -> tuple[IntakeRunner, ScriptedModel, Retriever]:
    model, retriever = ScriptedModel(replies), Retriever()
    graph = build_intake_graph(model, retriever, InMemorySaver())
    return IntakeRunner(graph), model, retriever


def test_pauses_on_a_question_and_resumes_with_the_answer() -> None:
    runner, model, retriever = make_runner([ask("What is the new phone number?"), ticket()])

    result = runner.start("t1", "luna-cafe", "Change the phone number")
    assert result["status"] == "question"
    assert result["question"] == "What is the new phone number?"
    assert (result["number"], result["max"]) == (1, 3)

    result = runner.resume("t1", " 618 765 4321 ")
    assert result["status"] == "ticket"
    assert result["ticket"]["details"] == TICKET["details"]
    assert result["qa"] == [{"question": "What is the new phone number?", "answer": "618 765 4321"}]
    # Retrieval ran again with the answer, and the model saw the conversation.
    assert retriever.queries[-1] == "Change the phone number 618 765 4321"
    assert "A1: 618 765 4321" in model.calls[-1][1].content
    assert result["usage"]["model_calls"] == 2


def test_hands_off_after_three_questions() -> None:
    runner, _, _ = make_runner([ask("Q1?"), ask("Q2?"), ask("Q3?"), ask("Q4?")])

    result = runner.start("t2", "luna-cafe", "Make it nicer")
    for answer in ("not sure", "anything", "you decide"):
        assert result["status"] == "question"
        result = runner.resume("t2", answer)

    assert result["status"] == "needs_human"
    assert len(result["qa"]) == 3
    assert "after 3 questions" in result["message"]


def test_sends_a_validation_error_back_to_the_model() -> None:
    error = ValueError('action "create_ticket" requires the "ticket" field')
    runner, model, _ = make_runner([error, ticket()])

    result = runner.start("t3", "luna-cafe", "Change the phone to 618 765 4321")

    assert result["status"] == "ticket"
    assert len(model.calls) == 2
    assert 'requires the "ticket" field' in model.calls[1][-1].content


def test_rejects_a_page_that_is_not_in_the_site() -> None:
    runner, model, _ = make_runner([ticket(target={"page": "/contact/", "section": "Form"}), ticket()])

    result = runner.start("t4", "luna-cafe", "Change the phone to 618 765 4321")

    assert result["status"] == "ticket"
    assert '"/contact/" is not a page of this site' in model.calls[1][-1].content


def test_gives_up_after_repeated_invalid_replies() -> None:
    runner, _, _ = make_runner([ValueError("bad"), ValueError("bad"), ValueError("still bad")])

    result = runner.start("t5", "luna-cafe", "Change the phone")

    assert result["status"] == "needs_human"
    assert "still bad" in result["message"]


def test_out_of_scope_needs_no_questions() -> None:
    decision = IntakeDecision(
        reasoning="The plan excludes e-commerce.",
        action="out_of_scope",
        client_message="Online ordering is not included in your Basic plan.",
        sources=["Luna Café plan: Basic › What the plan does not include"],
    )
    runner, _, _ = make_runner([decision])

    result = runner.start("t6", "luna-cafe", "Add online ordering")

    assert result["status"] == "out_of_scope"
    assert result["sources"] == ["Luna Café plan: Basic › What the plan does not include"]
    assert result["qa"] == []


def test_repeated_calls_do_not_redo_work() -> None:
    # Queue jobs can run twice (a retry after a crash). Each repeat must return the same state.
    runner, model, _ = make_runner([ask("What is the new phone number?"), ticket()])

    first = runner.start("t7", "luna-cafe", "Change the phone number")
    assert runner.start("t7", "luna-cafe", "Change the phone number") == first

    done = runner.resume("t7", "618 765 4321", question_number=1)
    assert runner.resume("t7", "618 765 4321", question_number=1) == done
    assert done["status"] == "ticket"
    assert len(model.calls) == 2


def test_continues_after_a_crash_mid_run() -> None:
    model = ScriptedModel([RuntimeError("provider down")])
    model.with_structured_output = _raising(model)  # type: ignore[method-assign]
    retriever = Retriever()
    runner = IntakeRunner(build_intake_graph(model, retriever, InMemorySaver()))

    with pytest.raises(RuntimeError):
        runner.start("t8", "luna-cafe", "Change the phone to 618 765 4321")

    model.replies = [ticket()]
    result = runner.start("t8", "luna-cafe", "Change the phone to 618 765 4321")
    assert result["status"] == "ticket"
    assert len(retriever.queries) == 1  # retrieve was checkpointed, so the retry skipped it


def test_answering_an_unknown_thread_fails() -> None:
    runner, _, _ = make_runner([])
    with pytest.raises(NotWaitingForAnswer):
        runner.resume("missing", "hello")


def test_decision_must_fill_the_field_of_its_action() -> None:
    with pytest.raises(ValidationError, match='requires the "question" field'):
        IntakeDecision(reasoning="x", action="ask_client")
