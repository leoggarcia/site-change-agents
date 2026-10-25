# Setup: running it on a server

Locally, `docker compose up -d --build` is enough (see the README). This guide covers what needs your own
accounts: GitHub for pull requests and previews, a server, and optionally Cloudflare and Langfuse.

## 1. GitHub: the site repositories

1. Create a GitHub organization (the free plan is enough), e.g. `leo-sites`.
2. Create one **public** repository per site, named like its folder: `luna-cafe`, `brightsmile-dental`,
   `northside-accounting`. Public, because on the free plan GitHub environments (which show the preview
   link on each pull request) only work in public repositories.
3. Push each site. Each has `.github/workflows/deploy.yml`, which builds every pull request and every
   push to `main` and uploads the result as the `site` artifact. Nothing reaches into your server.
4. In each repository (or the organization), set the Actions **variable** `SITES_BASE_URL` to where the
   sites are served, e.g. `https://sites.example.com`.

## 2. GitHub: the token for the agents

Create a **fine-grained personal access token** for the organization with access to **only the site
repositories**, and these permissions:

| Permission | Access | Why |
|---|---|---|
| Contents | Read and write | Clone the sites, push `agent/ticket-N` branches, merge |
| Pull requests | Read and write | Open and update pull requests |
| Actions | Read | Wait for the deploy workflow and download its build |
| Metadata | Read | Required by GitHub |

In `.env`: `GITHUB_ORG=<organization>` and `GITHUB_TOKEN=<token>`.

## 3. The server

Any machine with Docker works, also one behind NAT: deploys are pulled, not pushed.

1. Copy the repository (or `git clone` it) and create `.env` from `.env.example` with your keys, a strong
   `POSTGRES_PASSWORD`, `SITES_BASE_URL`, and `PUBLIC_APP_URL` (the panel's public URL, for links in
   pull requests).
2. **If the server has free ports 80 and 443**, set `APP_ADDRESS` and `SITES_ADDRESS` to your two
   hostnames (no `http://`) and run `docker compose up -d --build`. Caddy gets HTTPS certificates.
3. **If ports 80/443 are taken or you use a tunnel**, set `APP_ADDRESS=http://:80` and
   `SITES_ADDRESS=http://:8081`, and run:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
   ```
   Caddy then listens on `127.0.0.1:3020` (panel and API) and `127.0.0.1:3021` (sites), and Postgres and
   Redis are not published on the host.
4. Seed, index and put the sites online once:
   ```bash
   docker compose exec api node dist/database/seed.js
   docker compose exec agents-worker index-site luna-cafe        # and the other sites
   docker compose exec agents-worker rag-index
   docker compose exec agents-worker rag-index --knowledge
   docker compose exec agents-worker publish-site luna-cafe brightsmile-dental northside-accounting
   ```

To update the server later: copy the code again and rebuild (`docker compose build` and `up -d`).

## 4. Cloudflare Tunnel and Access (when the server is behind a tunnel)

1. In **Zero Trust → Networks → Tunnels →** your tunnel **→ Public hostnames**, add:
   - `agents.example.com` → `HTTP` · `localhost:3020`
   - `sites.example.com` → `HTTP` · `localhost:3021`
2. In **Zero Trust → Access → Applications**, add a **self-hosted** application for `agents.example.com`
   with a policy that allows only your email. The demo sign-in has no passwords, so the panel must not be
   public. Leave `sites.example.com` open: clients open their previews there.

## 5. Model keys and limits

`GOOGLE_API_KEY` from Google AI Studio. On the free tier each model has its own daily quota (Flash Lite:
500 requests per day, 15 per minute), so the defaults put the reviewer on a different model than the coder.
Any model can be changed with the `*_MODEL` settings (`provider:model`).

## 6. Langfuse (optional)

Create a project at [cloud.langfuse.com](https://cloud.langfuse.com) (the Hobby plan needs no card), and
set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_HOST` (`https://us.cloud.langfuse.com` for
the US region). On the server, also set `LANGFUSE_TRACING_ENVIRONMENT=production`. Without keys nothing is
traced.

## 7. Bull Board (optional)

Set `BULL_BOARD_PASSWORD` to see the queues at `/api/queues` (user `agency`).
