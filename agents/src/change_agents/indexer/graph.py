"""The Project Indexer as a LangGraph graph.

    START -> explore -> (tool calls?) -> tools -> explore -> ... -> summarize -> END

explore:   the model looks at what it has seen so far and asks for tools (list_files, read_file).
tools:     our code runs those tool calls inside the repo sandbox and adds the results to the conversation.
summarize: once the model stops asking for tools (or hits the turn limit), a second call turns
           everything it read into a ProjectSummary (structured output).
"""

from typing import Annotated, Literal, TypedDict

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode

from change_agents.indexer.prompts import EXPLORE_PROMPT, SUMMARIZE_PROMPT
from change_agents.indexer.schema import ProjectSummary

DEFAULT_MAX_TURNS = 8


class IndexerState(TypedDict):
    # add_messages appends each node's new messages instead of replacing the list.
    messages: Annotated[list[AnyMessage], add_messages]
    turns: int
    summary: ProjectSummary | None
    usage: dict[str, int]


def _add_usage(usage: dict[str, int], message: AIMessage | None) -> dict[str, int]:
    meta = (message.usage_metadata if message else None) or {}
    return {
        "input_tokens": usage.get("input_tokens", 0) + meta.get("input_tokens", 0),
        "output_tokens": usage.get("output_tokens", 0) + meta.get("output_tokens", 0),
        "model_calls": usage.get("model_calls", 0) + 1,
    }


def _files_read(messages: list[AnyMessage]) -> str:
    """Builds the summarizer's input: every file the explorer read, with its path.

    Passing plain text instead of the raw tool-call history keeps this step independent of
    how each provider formats tool calls.
    """
    paths = {
        call["id"]: call["args"].get("path", "")
        for message in messages
        if isinstance(message, AIMessage)
        for call in message.tool_calls
        if call["name"] == "read_file"
    }
    blocks: list[str] = []
    for message in messages:
        if isinstance(message, ToolMessage) and message.tool_call_id in paths:
            content = message.content if isinstance(message.content, str) else str(message.content)
            if not content.startswith("Error:"):
                blocks.append(f'<file path="{paths[message.tool_call_id]}">\n{content}\n</file>')

    listing = next(
        (m.content for m in messages if isinstance(m, ToolMessage) and m.name == "list_files"),
        "(not listed)",
    )
    return f"<file_list>\n{listing}\n</file_list>\n\n" + "\n\n".join(blocks)


def build_indexer_graph(
    model: BaseChatModel, tools: list[BaseTool], max_turns: int = DEFAULT_MAX_TURNS
) -> CompiledStateGraph:
    explorer = model.bind_tools(tools)  # sends the tools' names, docstrings and arguments with every call
    summarizer = model.with_structured_output(ProjectSummary, include_raw=True)

    def explore(state: IndexerState) -> dict:
        response = explorer.invoke([SystemMessage(EXPLORE_PROMPT), *state["messages"]])
        return {"messages": [response], "turns": state["turns"] + 1, "usage": _add_usage(state["usage"], response)}

    def after_explore(state: IndexerState) -> Literal["tools", "summarize"]:
        last = state["messages"][-1]
        wants_tools = isinstance(last, AIMessage) and bool(last.tool_calls)
        # The turn limit lives in code: the model cannot talk its way into more steps.
        return "tools" if wants_tools and state["turns"] < max_turns else "summarize"

    def summarize(state: IndexerState) -> dict:
        result = summarizer.invoke(
            [SystemMessage(SUMMARIZE_PROMPT), HumanMessage(_files_read(state["messages"]))]
        )
        if result["parsed"] is None:
            raise ValueError(f"The model's summary did not match the schema: {result['parsing_error']}")
        return {"summary": result["parsed"], "usage": _add_usage(state["usage"], result["raw"])}

    graph = StateGraph(IndexerState)
    graph.add_node("explore", explore)
    graph.add_node("tools", ToolNode(tools))
    graph.add_node("summarize", summarize)
    graph.add_edge(START, "explore")
    graph.add_conditional_edges("explore", after_explore)
    graph.add_edge("tools", "explore")
    graph.add_edge("summarize", END)
    return graph.compile()


def initial_state(site_id: str) -> IndexerState:
    return {
        "messages": [HumanMessage(f'Index the repository of the website "{site_id}". Start by listing its files.')],
        "turns": 0,
        "summary": None,
        "usage": {},
    }
