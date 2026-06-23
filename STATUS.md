# EZ Wins Orchestrator — Status & Handoff

**Last updated:** 2026-06-22
**Current phase:** Phase 0 — **deployed and live**; acceptance test in progress (step 1 of 5 passing).

---

## Where we left off

Phase 0 is built, on GitHub `main`, and **deploying green on Vercel** with all env vars
provisioned. The acceptance test is mid-run:

| # | Acceptance step | Status |
|---|---|---|
| 1 | Mint a typed project ID | ✅ **PASS** — minted `ONB-2026-0001` (Steve Hahn Volkswagen, Mercedes, Kia); shows in registry |
| 2 | Write ID to a ClickUp task + read back | ⏳ not yet run — use task `868k1qgvn` |
| 3 | Tag an Outlook thread + store conversationId | ⏳ not yet run — use the subject search in the UI |
| 4 | Reverse-lookup project from conversationId | ⏳ not yet run |
| 5 | Write ID to a portal dealer + read back | ⏳ not yet run — use dealer `seed_0` (Toyota Walnut Creek) |

**Resume here:** sign in, Project ID `ONB-2026-0001` is pre-filled, run steps 2–5.
(Optional: mint once as Support to confirm `SUP-2026-0001` — the multi-type check.)

---

## What's live

- **Repo:** `github.com/blakedaniel15/ez-wins-orchestrator`, branch `main` (its own git repo).
- **Vercel:** project under Blake's personal account (NOT the EZ Wins team — so Claude can't read
  its build logs directly; paste errors or transfer to the team to enable monitoring).
- **Neon:** a **dedicated** DB (separate from the portal). Schema run: `project` + `project_counter`
  tables exist (`neon-schema.sql`).
- **Upstash Redis:** a **dedicated** instance (separate from other apps — avoids `admin_session:*`
  and future `followup:*` key collisions).

### Env vars provisioned (Vercel)
- Neon: `DATABASE_URL` (+ ~14 auto-added Neon extras, unused/harmless)
- Redis: `KV_REST_API_URL`, `KV_REST_API_TOKEN`
- `ADMIN_PASSWORD`
- ClickUp: `CLICKUP_API_TOKEN`, `CLICKUP_PROJECT_ID_FIELD_UUID=a902e02d-f4cf-4751-ae54-c1f101962ce9`
- MS Graph: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (new secret, saved in 1Password),
  `MS_USER_EMAIL`
- `PORTAL_BASE_URL=https://hub.ez-wins.com` (verified: 200, 237 dealers, `projectId` field live)
- The four `CLICKUP_LIST_*` are optional in Phase 0 (not used by any Phase-0 code path).

### Test handles
- ClickUp task: `868k1qgvn` ("DealerTrack feed approval: Steve Hahn VW, Mercedes, Kia")
- Portal dealer: `seed_0` (Toyota Walnut Creek), `projectId` currently empty

---

## Changes made this session

**Plan docs** (rewritten): reframed to an **email-thread spine, type-agnostic** (ONB/SUP/WUP/INV
all mint IDs, born from the Outlook thread = idempotency key); generalized cadence; net-new support
follow-up; warranty letter-guard (Phase 7); four ClickUp lists as stage buckets; manual
project-creation escape hatch.

**Phase 0 code** (TypeScript, Next 14 App Router): `lib/` (db, redis, security, ids, projects,
graph, clickup, portal), `app/api/` (login, session, projects, wire/{portal,clickup,outlook}),
and the internal page (login + manual New-Project tool + 5-step acceptance harness).

**Fixes during bring-up:** paste-safe schema comments; `.gitignore` keeps `.env.example`;
mint errors now surface (route try/catch + page error display); Graph `$search` for subject lookup.

**Infra/git:** gave the orchestrator its own git repo; removed a stray 2.2GB git repo at
`/Users/blakedaniel/.git` (was catching un-initialized folders — a secrets hazard).

**Portal (Blake did these):** added `project_id` column wired through all 4 places + an Edit-modal
input. ClickUp: created the `project_id` text field at the Space level.

---

## Open items / next actions

1. **Finish acceptance test** — steps 2–5 above.
2. **DMS field in portal** (Blake is doing the edit, not Claude). Decided it's **additive** — the
   portal already has a per-dealer `dms` field, and the orchestrator's `project` already carries
   `dms` + `conduit` (the DealerVault case is exactly why they're separate: `dms`=underlying,
   `conduit=dealervault`). **Awaiting Blake's answer:** is he (a) using the existing `dms` field
   (no schema change), or (b) adding a new column (then wire all 4 places + `alter table` first,
   like `project_id`)?
3. **Phase 1 — Comms arm** (next phase): port the email assistant's sweep→classify→draft into the
   orchestrator, generalize cadence to per-type tracks, build the OUTBOX/action queue, then
   **retire the email assistant fully** at cutover.

## Decisions locked
- TypeScript. · Blake owns all portal-repo edits. · Separate Neon DB + separate Redis. · Four
  ClickUp lists kept separate as stages (orchestrator moves tasks between them). · Warranty letters
  stay human-reviewed forever. · Work stays inside `~/Projects`; commit to `main`.
