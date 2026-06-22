# Phase 0 — Orchestrator Skeleton + Project Registry (Claude Code brief)

Paste this into a Claude Code session launched from the `Projects/` parent folder so you
can read the sibling repos (`ez-wins-portal`, `ez-wins-email-assistant`, `moc-setup-form`,
`MOC-Onboarding-Form`). **Commit only to the new `ez-wins-orchestrator` repo.** Read the
others for their contracts; do not edit them in this phase.

## Goal

Build the spine of the EZ Wins automation system: a new app that mints a universal project
ID and links that ID across the portal, ClickUp, and Outlook. Nothing else.

**The system is type-agnostic from day one** — every project (onboarding, support, warranty
uplift, investigation) rides this same spine, and every project is **born from an Outlook
email thread**. So the Outlook wiring below (storing the thread's `conversationId`) is the
**keystone**, not one wiring of three: `conversationId` is the idempotency key the whole
system dedupes on later.

## Acceptance test (this phase is done when all five pass)

1. I can mint a project ID, typed and sequential within the year — and prove it works for
   **more than one type** (e.g. `ONB-2026-0001` **and** `SUP-2026-0001`), since the spine
   serves all types.
2. That ID gets written to an existing **portal dealer** row and reads back.
3. That ID gets written to an existing **ClickUp task** custom field and reads back.
4. That ID gets stamped on an existing **Outlook thread** (Graph category) and the thread's
   `conversationId` is stored on the project row, so the link is bidirectional (the keystone).
5. Given a `conversationId` I paste in, the page finds the project it belongs to (proves the
   thread→project lookup that every later phase relies on).

A tiny internal page that performs 1–5 against IDs/handles I paste in, and shows green/red
per step, is the deliverable. No automation, no AI yet.

## In scope
- New repo `ez-wins-orchestrator`, own Vercel project, own Neon DB.
- `project` table + atomic typed-ID minting.
- Three reference wirings (portal column, ClickUp field, Outlook category).
- Minimal password-gated internal page that is **both** the acceptance-test harness **and** the
  manual "New Project" tool: a form to mint a project with real fields (type, dealer, `dms`,
  `conduit`, MOC reps), with a **dedup check** that warns if a project already exists for that
  dealer, then **direct-attach** to an existing thread by pasting its `conversationId` / message
  link (stamps `EZW-{id}` category + stores the link). This is the manual escape hatch; the
  propose-and-approve auto-link comes in Phase 1.

## Explicitly OUT of scope (do not build)
- AI classification, roster extraction, cadence/follow-up engine, the outbox/action queue,
  Playwright, welcome emails. Those are later phases.
- **Auto-creating** ClickUp tasks / portal dealers from a project. In this phase we **link to
  existing** dealers/tasks/threads (paste their handles); we don't create them. Minting the
  orchestrator's own `project` record manually IS in scope — that's the ID source of truth.

## Stack & setup
- Next.js (App Router), **TypeScript** (decided — long-lived "brain" with many cross-system
  contracts; matches the portal + onboarding-form house style).
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

There are **four** ClickUp lists, and they are **distinct stages, not duplicates** (resolved):
- `901113435718` — Feed Approval Pending (onboarding waiting for integration approval = pipeline)
- `901105435045` — approved onboarding working space (dev downloads, onboarding team completes)
- `901106848667` — Support Requests
- `901111643961` — Blake › Planner (investigation/decision tasks)

For Phase 0, create the **text** custom field `project_id` on **all four lists** (so any task
type can carry the ID), or at minimum on `901113435718` for the acceptance test. ClickUp custom
fields are addressed by UUID, not name (see how `ez-wins-email-assistant` maps `CONFIG.FIELDS`
UUIDs). Resolve the field UUID(s) via the ClickUp API `GET /list/{id}/field` or the UI and store
in env vars. Orchestrator writes the project ID to that field on an existing task and reads it back.

## Wiring 3 — Outlook thread tag

Reuse the Graph category pattern already in `ez-wins-email-assistant` (it PATCHes message
categories like `EZ-Assistant-Processed`). Add a category `EZW-{projectId}` to the messages in
a thread, and store that thread's `conversationId` on the project row. Graph env vars match the
email assistant: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_USER_EMAIL`.
Remember the Graph quirk: `$filter` + `$orderby` together is rejected — filter server-side,
sort client-side.

## Env vars (this phase)
`DATABASE_URL`, `ADMIN_PASSWORD`, Redis (`KV_REST_API_URL`/`KV_REST_API_TOKEN`),
`CLICKUP_API_TOKEN`, `CLICKUP_PROJECT_ID_FIELD_UUID` (per list if UUIDs differ), the four list
IDs (`CLICKUP_LIST_FEED_APPROVAL`/`_ONBOARDING_WORKING`/`_SUPPORT`/`_PLANNER`),
`MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_USER_EMAIL`, portal storage API base URL.

## Build / commit / deploy rules
- `ez-wins-orchestrator` is its **own git repo** (`git init`'d 2026-06-22; do not commit into the
  stray home-level repo). Commit work to a `preview` branch. Read the other repos; don't edit them
  without asking.
- Ship Phase 0 on its own; don't scaffold later phases.

## Confirm before guessing (do not assume) — all resolved
1. ~~Which Companies Inbound list ID is canonical.~~ **Resolved:** four lists, distinct stages
   (see Wiring 2). No single "canonical" list — wire each to its type.
2. ~~Whether I make the portal `project_id` column change.~~ **Resolved:** Blake makes the portal
   change himself (5 steps: Neon `alter table` first, then `neon-schema.sql`, then the GET map,
   POST insert columns+values, and ON CONFLICT in `app/api/storage/route.ts`). Orchestrator only
   **writes/reads** `projectId` on an existing dealer via the storage API — does not touch the portal repo.
3. ~~TS vs JS.~~ **Resolved: TypeScript.**
