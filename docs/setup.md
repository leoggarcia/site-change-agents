# Setup: the manual steps

These are the parts of Phase 0 that need your accounts. Everything else is in the repo.

## 1. GitHub organization and test-site repos

1. Create a free GitHub organization (e.g. `yourname-sites`).
2. Create one repo per test site, **named exactly like the folder**. The repo name is the site ID used in the URLs:
   `luna-cafe`, `brightsmile-dental`, `northside-accounting`.
3. Push each folder from `test-sites/` to its repo (each folder is its own repo; `test-sites/` is ignored by this one).

## 2. VPS

1. Install Docker on the VPS and copy this repo there.
2. Create the folder the sites are copied into: `sudo mkdir -p /srv/sites && sudo chown deploy:deploy /srv/sites`.
3. Create a `deploy` user for GitHub Actions. It needs SSH access and `rsync`, and nothing else.
4. Copy `.env.example` to `.env` and set:
   - `APP_ADDRESS` / `SITES_ADDRESS`: hostnames pointing at the VPS. Without a domain, use sslip.io:
     `app.<VPS-IP>.sslip.io` and `sites.<VPS-IP>.sslip.io` (no `http://`, so Caddy gets HTTPS certificates).
   - `SITES_DIR=/srv/sites`
   - A strong `POSTGRES_PASSWORD`.
5. `docker compose up -d --build`

## 3. Secrets and variables for the deploy workflow

Set these at the organization level if your plan allows it, or else in each repo (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|---|---|---|
| Secret | `VPS_HOST` | VPS IP or hostname |
| Secret | `VPS_USER` | `deploy` |
| Secret | `VPS_SSH_KEY` | Private key of a new key pair made only for this (`ssh-keygen -t ed25519`); add the public key to `~deploy/.ssh/authorized_keys` |
| Secret | `VPS_KNOWN_HOSTS` | Output of `ssh-keyscan <VPS_HOST>` |
| Variable | `SITES_BASE_URL` | `https://sites.<VPS-IP>.sslip.io` |
| Variable | `VPS_SITES_DIR` | `/srv/sites` (optional, this is the default) |

`DEPLOY_WEBHOOK_URL` and `DEPLOY_WEBHOOK_SECRET` come in Phase 7.

## 4. GitHub token for the agents

Create a **fine-grained personal access token** with access to **only the three test-site repos**.
Permissions: Contents (read and write), Pull requests (read and write), Metadata (read).
Put it in `.env` as `GITHUB_TOKEN`, and the org name as `GITHUB_ORG`.

## 5. Gemini API key

Create a key in Google AI Studio and put it in `.env` as `GOOGLE_API_KEY`.
Check which Flash model IDs your key can use there, and update the `*_MODEL` lines if needed.

## Phase 0 is done when

You open a PR on one of the sites, the Action posts a preview URL (shown as "View deployment" on the PR), and merging the PR updates the production URL.
