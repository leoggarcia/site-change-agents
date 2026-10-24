"""The only place that turns the EMBEDDING_MODEL setting into an embeddings client."""

import time
from collections import deque
from functools import lru_cache

from langchain.embeddings import init_embeddings

from change_agents.config import get_settings


class Embedder:
    """Turns texts into vectors of a fixed size.

    Some providers (Gemini, Voyage) embed documents and search queries differently, which works
    better for retrieval; for the others both sides use the same call.
    """

    def __init__(self, model: str, dimensions: int, texts_per_minute: int = 90) -> None:
        get_settings()  # loads .env so the provider SDK finds its API key
        self.model_name = model
        self.dimensions = dimensions
        self.texts_per_minute = texts_per_minute
        self._sent: deque[float] = deque()  # when each recent text was sent
        provider = model.partition(":")[0]

        self._document_kwargs: dict = {}
        self._query_kwargs: dict = {}
        init_kwargs: dict = {}
        if provider == "google_genai":
            self._document_kwargs = {"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": dimensions}
            self._query_kwargs = {"task_type": "RETRIEVAL_QUERY", "output_dimensionality": dimensions}
        elif provider == "openai":
            init_kwargs = {"dimensions": dimensions}
        self._client = init_embeddings(model, **init_kwargs)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts, self._document_kwargs)

    def embed_queries(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts, self._query_kwargs)

    def embed_query(self, text: str) -> list[float]:
        return self.embed_queries([text])[0]

    def _embed(self, texts: list[str], kwargs: dict) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self.texts_per_minute):
            batch = texts[start : start + self.texts_per_minute]
            self._wait_for_capacity(len(batch))
            vectors += self._checked(self._client.embed_documents(batch, **kwargs))
        return vectors

    def _wait_for_capacity(self, count: int) -> None:
        """Sliding one-minute window: wait until sending `count` more texts stays under the limit."""
        while True:
            now = time.monotonic()
            while self._sent and now - self._sent[0] >= 60:
                self._sent.popleft()
            if len(self._sent) + count <= self.texts_per_minute:
                self._sent.extend([now] * count)
                return
            wait = 60 - (now - self._sent[0]) + 0.5
            print(f"  (embedding rate limit: waiting {wait:.0f}s)", flush=True)
            time.sleep(wait)

    def _checked(self, vectors: list[list[float]]) -> list[list[float]]:
        for vector in vectors:
            if len(vector) != self.dimensions:
                raise ValueError(
                    f"{self.model_name} returned {len(vector)} dimensions, but the database expects {self.dimensions}."
                )
        return vectors


@lru_cache
def get_embedder() -> Embedder:
    settings = get_settings()
    return Embedder(settings.embedding_model, settings.embedding_dimensions, settings.embedding_texts_per_minute)
