# EZ Wins Orchestrator — Phase 0

The spine of the EZ Wins automation system: a Next.js + Neon app that mints a
**universal project ID** for every type (onboarding / support / warranty uplift /
investigation) and links that ID across the **portal**, **ClickUp**, and **Outlook**.

Phase 0 is the skeleton: ID minting, the project registry, the three cross-system
wirings, and a password-gated internal page that doubles as the manual "New Project"
tool and the acceptance-test harness. No AI, no automation yet — those are later phases.

See `docs/plan/phase-0-brief.md` for scope and `docs/plan/execution-plan.md` for the full
roadmap. `docs/` is organized as: `plan/` (roadmap), `specs/` (designs), `plans/` (implementation
plans), `reference/` (the onboarding skill + real DMS email samples).

## What it does (Phase 0)

- **Mint a typed, per-year, sequential ID** — `ONB-2026-0001`, `SUP-2026-0001`, etc.
  (atomic; concurrent mints can't collide).
- **Create a project** with a dealer-name **dedup check** (warns before minting a duplicate).
- **Wire the ID across systems and read it back:**
  - Portal — writes `projectId` onto an existing dealer via `/api/storage` (full-collection
    replace; test-only path).
  - ClickUp — writes the `project_id` custom field on an existing task.
  - Outlook — stamps an `EZW-{projectId}` category on every message in a thread and stores the
    thread's `conversationId` on the project (bidirectional link).
- **Reverse lookup** — find a project from a `conversationId` (the dedup key every later phase uses).

## Acceptance test (done when all five pass)

On the internal page, after signing in:

1. Mint a project ID for **two** types (e.g. `ONB-…` and `SUP-…`).
2. Write it to an existing **portal dealer** and read it back (green).
3. Write it to an existing **ClickUp task** custom field and read it back (green).
4. Tag an existing **Outlook thread** (search by subject → pick → tag) — stores `conversationId`.
5. Paste that `conversationId` into the reverse-lookup and get the project back (green).

## Provisioning checklist (what Blake sets up)

1. **GitHub repo + Vercel project** for `ez-wins-orchestrator`.
2. **Neon** — add via Vercel → Storage; it injects `DATABASE_URL`. Then paste `neon-schema.sql`
   into the Neon SQL editor once.
3. **Upstash Redis** (Vercel KV) — provides `KV_REST_API_URL` / `KV_REST_API_TOKEN` (admin sessions).
4. **`ADMIN_PASSWORD`** — pick one; it gates the internal page.
5. **ClickUp** — `CLICKUP_API_TOKEN`, and create a **text** custom field `project_id` on the lists;
   put its UUID in `CLICKUP_PROJECT_ID_FIELD_UUID`. (Get the UUID from `GET /list/{id}/field`.)
6. **Microsoft Graph** — reuse the email assistant's values: `MS_TENANT_ID`, `MS_CLIENT_ID`,
   `MS_CLIENT_SECRET`, `MS_USER_EMAIL`.
7. **`PORTAL_BASE_URL`** — the deployed portal's base URL (its `/api/storage` is called).

All env var names are in `.env.example`.

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000  (needs .env.local with the vars above)
npm run build # production build / typecheck
```

Deployment: GitHub → Vercel auto-deploy.
