# Phase 0 — Orchestrator Skeleton + Project Registry (Claude Code brief)

Paste this into a Claude Code session launched from the `Projects/` parent folder so you
can read the sibling repos (`ez-wins-portal`, `ez-wins-email-assistant`, `moc-setup-form`,
`MOC-Onboarding-Form`). **Commit only to the new `ez-wins-orchestrator` repo.** Read the
others for their contracts; do not edit them in this phase.

## Goal

Build the spine of the EZ Wins automation system: a new app that mints a universal project
ID and links that ID across the portal, ClickUp, and Outlook. Nothing else.

## Acceptance test (this phase is done when all four pass)

1. I can mint a project ID (`ONB-2026-0001`, typed, sequential within the year).
2. That ID gets written to an existing **portal dealer** row and reads back.
3. That ID gets written to an existing **ClickUp task** custom field and reads back.
4. That ID gets stamped on an existing **Outlook thread** (Graph category) and the thread's
   `conversationId` is stored on the project row, so the link is bidirectional.

A tiny internal page that performs 1–4 against IDs/handles I paste in, and shows green/red
per step, is the deliverable. No automation, no AI yet.

## In scope
- New repo `ez-wins-orchestrator`, own Vercel project, own Neon DB.
- `project` table + atomic typed-ID minting.
- Three reference wirings (portal column, ClickUp field, Outlook category).
- Minimal password-gated internal page to run the acceptance test.

## Explicitly OUT of scope (do not build)
- AI classification, roster extraction, cadence/follow-up engine, the outbox/action queue,
  Playwright, welcome emails, dealer/task creation flows. Those are later phases. In this
  phase we link to **existing** dealers/tasks/threads, we don't create them.

## Stack & setup
- Next.js (App Router), JS or TS, matching the house style of the other repos.
- Neon Postgres via a lazy server-only client (mirror `ez-wins-portal/lib/db.ts`).
- Single-user auth: reuse the pattern in `moc-setup-form/lib/security.js`
  (`ADMIN_PASSWORD` + Redis-backed admin session token, cookie holds the token not the
  password). All internal routes guarded.
- Deploy: GitHub → Vercel auto-deploy. Provision Neon via the Vercel Storage tab so
  `DATABASE_URL` is injected. First run: paste the schema into the Neon SQL editor.

## Schema

```sql
create table if not exists project (
  id           text primary key,          -- ONB-2026-0001
  type         text not null,             -- onboarding | support | warranty_uplift
  status       text not null default 'new',
  substate     jsonb not null default '{}'::jsonb,
  dms          text,                      -- underlying: CDK, Reynolds, Tekion, DealerTrack, Automate, PBS...
  conduit      text,                      -- direct | fortellis | dealervault | tekion | reynolds_rci
  dealer_name  text,
  group_name   text,
  moc_reps     jsonb not null default '[]'::jsonb,
  outlook_conversation_id text,
  clickup_task_id         text,
  portal_dealer_id        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- atomic per-(type, year) counter for ID minting
create table if not exists project_counter (
  type_year text primary key,             -- e.g. ONB-2026
  n         integer not null default 0
);
```

`dms` and `conduit` are separate on purpose: a DealerTrack dealer riding in via DealerVault
is still `dms=DealerTrack, conduit=dealervault`.

## ID minting (must be atomic)

In one transaction: upsert `project_counter` for the `type_year`, increment `n`, return it,
zero-pad to 4 digits, format `ONB-2026-0001`. Type prefixes: `ONB` onboarding, `SUP` support,
`WUP` warranty_uplift. Never read-then-write outside a transaction (concurrent mints would
collide).

## Wiring 1 — Portal `project_id` column

The portal stores dealers as JSON behind `app/api/storage/route.ts`, which maps
camelCase↔snake_case and upserts the dealers table. **Footgun (read
`ez-wins-portal/CLAUDE.md` and `route.ts` first):** adding a dealer field that persists means
touching all four places — the GET snake→camel map, the POST camel→snake, the
`INSERT ... ON CONFLICT` upsert, **and** `neon-schema.sql` — and running
`alter table dealers add column if not exists project_id text;` in Neon **before** the deploy,
or every dealer save 500s.

For this phase the orchestrator only needs to **write** `projectId` onto one existing dealer
and read it back, via the portal's storage API (`POST /api/storage` for `ezw:dealers:v4` is a
full-collection replace — fetch the array, set the field on the target dealer, send the whole
array back). Confirm with me before you touch the portal repo; I may make the portal column
change myself.

## Wiring 2 — ClickUp `project_id` custom field

Create a **text** custom field named `project_id` on the Companies Inbound list. Note: the
setup form uses list `901105435045`, the onboarding form + email assistant use `901113435718`
— **ask me which is canonical before wiring.** ClickUp custom fields are addressed by UUID, not
name (see how `ez-wins-email-assistant` maps `CONFIG.FIELDS` UUIDs). Resolve the field UUID
once (via the ClickUp API `GET /list/{id}/field` or from the UI) and store it in an env var.
Orchestrator writes the project ID to that field on an existing task and reads it back.

## Wiring 3 — Outlook thread tag

Reuse the Graph category pattern already in `ez-wins-email-assistant` (it PATCHes message
categories like `EZ-Assistant-Processed`). Add a category `EZW-{projectId}` to the messages in
a thread, and store that thread's `conversationId` on the project row. Graph env vars match the
email assistant: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_USER_EMAIL`.
Remember the Graph quirk: `$filter` + `$orderby` together is rejected — filter server-side,
sort client-side.

## Env vars (this phase)
`DATABASE_URL`, `ADMIN_PASSWORD`, Redis (`KV_REST_API_URL`/`KV_REST_API_TOKEN`),
`CLICKUP_API_TOKEN`, `CLICKUP_PROJECT_ID_FIELD_UUID`, `CLICKUP_LIST_ID` (canonical inbound),
`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_USER_EMAIL`, portal storage API base URL.

## Build / commit / deploy rules
- Commit only to `ez-wins-orchestrator`. Read the other repos; don't edit them without asking.
- Ship Phase 0 on its own; don't scaffold later phases.

## Confirm before guessing (do not assume)
1. Which Companies Inbound list ID is canonical (`901105435045` vs `901113435718`).
2. Whether I make the portal `project_id` column change myself or you do it.
3. TS vs JS for the orchestrator (match what I tell you).
