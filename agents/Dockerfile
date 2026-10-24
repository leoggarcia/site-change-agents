FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY src ./src
COPY evals ./evals
RUN uv sync --locked --no-dev
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "change_agents.main:app", "--host", "0.0.0.0", "--port", "8000"]
