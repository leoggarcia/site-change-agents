# Site Change Agents

The full project plan is in `proyecto-agente-cambios-web.md` (written in Spanish). Follow its phases in order. Its "Plan changes" block at the top replaces the original stack choices:

- Everything runs in Docker on the developer's own VPS: the system and the test sites (served by Caddy, with one preview per PR). No Netlify, Vercel or GitHub Pages.
- LLM and embedding providers are swappable through config. Gemini's free tier is the default for development. Never hard-code a provider SDK in agent logic. Every model comes from a `provider:model` setting.

## Language: everything in English

Everything we build is in English, even though the plan is in Spanish:

- Code, identifiers, comments, commit messages, PR titles and descriptions
- Panel UI text and every message the client sees (agent questions, ticket summaries, notifications)
- Agent system prompts, tool descriptions and structured outputs (tickets, reviews)
- Test sites' content, brand guides, plans, golden datasets and eval files
- README and other documentation

## Working agreement: stop and explain after every phase

The main goal of this project is for the developer to **learn how the AI technologies work** (LLM agents, tool use, structured outputs, LangGraph, interrupts and checkpointing, RAG, embeddings, pgvector, hybrid search, evals, tracing). They already know NestJS, TypeScript, React, Redis/BullMQ and Postgres well. They are not trying to learn to write the code themselves, only to understand what each technology does and why we use it.

At the end of **every phase** (and every sub-phase, such as 2.5):

1. Stop. Don't start the next phase until the developer says to.
2. Summarize what was built and where it lives (key files).
3. Explain how the AI concepts used in that phase work: what problem each one solves, how it works under the hood in plain terms, and how it shows up in our code. Use small examples from this project. Skip the parts they already know (NestJS, React, BullMQ, SQL).
4. Show how to see it working (a command to run, a URL to open, what to look for).
5. List anything the developer has to do by hand (accounts, API keys, GitHub settings).
