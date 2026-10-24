# Client knowledge

What the agency knows about each client, used by the agents through RAG (`search_client_knowledge`).
One folder per site, named by site id:

- `brand-guide.md`: colors, fonts, tone of voice and rules
- `plan.md`: the plan the client pays for and what it includes
- `past-tickets.md`: earlier requests and how they were resolved (one `##` section per ticket)

All content is fictional. Index it with `uv run rag-index <site-id> --knowledge` (from `agents/`).
