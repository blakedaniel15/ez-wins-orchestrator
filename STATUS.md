# EZ Wins Orchestrator — Status & Handoff

**Last updated:** 2026-06-26
**Where we are:** Phase 0 ✅ done & deployed. Entity-model design (Phase 0.5) ✅ specced + planned,
ready to build. DMS deep-dives in progress (Fortellis + Reynolds ✅ confirmed; Tekion + DealerVault
next). **Next build = Phase 0.5.**

Docs are organized under `docs/` — start with `docs/README.md`, then `docs/plan/execution-plan.md`.

---

## Phase 0 — DONE ✅

Deployed green on Vercel, all env vars provisioned, acceptance test **5/5 passing** end-to-end against
real systems: mint typed ID → write/read on a ClickUp task (`868k1qgvn`) + portal dealer
(`d_1780607333618_egnvk`, Steve Hahn) → tag an Outlook thread (10 msgs) → reverse-lookup thread→project.
Test row: `ONB-2026-0001`.

### Live infra
- **Repo:** `github.com/blakedaniel15/ez-wins-orchestrator`, branch `main`.
- **Vercel:** under Blake's **personal** account (not the EZ Wins team) — Claude can't read its build
  logs; paste errors or transfer to the team to enable monitoring.
- **Neon:** dedicated DB (separate from portal). **Schema is still the Phase-0 `project` +
  `project_counter` only — the Phase 0.5 migration has NOT been run yet.**
- **Upstash Redis:** dedicated instance.
- **Env vars (Vercel):** `DATABASE_URL`, `KV_REST_API_URL/TOKEN`, `ADMIN_PASSWORD`, `CLICKUP_API_TOKEN`,
  `CLICKUP_PROJECT_ID_FIELD_UUID=a902e02d-f4cf-4751-ae54-c1f101962ce9`, MS Graph (`MS_*`),
  `PORTAL_BASE_URL=https://hub.ez-wins.com`.

---

## Designed & planned (not yet built)

- **Phase 0.5 — group → dealership → project entity model.** Spec: `docs/specs/group-dealership-
  entity-model.md`. Implementation plan (7 tasks): `docs/plans/phase-0.5-entity-model.md`. This is the
  next build — it migrates the flat Phase-0 `project` table into the 3-tier persistent model
  (dealership = first-class memory anchor; projects are time-bound engagements that end).

## DMS approval flows — `docs/specs/dms-approval-flows.md`

- **Fortellis ✅ CONFIRMED** (real email): `noreply@fortellis.io` / "EZ Wins Activation Details" →
  `Organization` (store) + `Subscription ID` (feed).
- **Reynolds ✅ CONFIRMED** (real emails): all from `RCI_Deployment@reyrey.com`, structured subjects
  keyed on **Customer #** / **PPSYSID**. Full lifecycle mapped: onboarding (order → ack →
  docs-ready+**RCI-1 PDF** → `- COMPLETED` = approved+data-delivered) AND offboarding
  (`- CANCELLED` decline, termination, BUY/SELL). **Proved we can pull the RCI-1 PDF off the email and
  extract every field** (Customer #, PPSYSID/Store/Branch, address, EULA date, signatory).
- **Tekion — next.** APC 2.0 likely offers a partner **API/webhook** (cleaner than email). Open: does
  Blake have an `apc.tekioncloud.com` partner account w/ API access?
- **DealerVault — after Tekion.** "Feed Request Notification" email + portal "Active" status + vendor
  API. Open: real notification email + API availability.

## Onboarding skill absorbed → Phase 2 blueprint

`docs/reference/onboarding-skill/` (the real EZ-Wins skill). Encodes task-creation for all sources
(Fortellis CSV, Reynolds RCI-1 PDF, DealerVault paste, Tekion paste, **Tekion APC browser scrape**):
the dev-team **description format**, `task_type:"Branch"` auto-subtask on list `901105435045`, MOC
Region field IDs, brand/group/region detection, `seen_orgs`/`seen_groups` dedup, MOC-Users + group
comments, EZ-Wins group-naming rule. The orchestrator absorbs this as Phase 2.

---

## Open items / next actions

1. **Tekion deep-dive** — confirm APC partner API access, else get a real approval email. Then DealerVault.
2. **Build Phase 0.5** — run `docs/plans/phase-0.5-entity-model.md` (Blake runs the migration SQL in Neon).
3. **Minor, deferred:** Reynolds package-conversion / billing / re-cert rounds; reverse-lookup UI
   auto-fill; the `tekion-approval-guide.pdf` missing-file bug in MOC-Onboarding-Form.

## Decisions locked
- TypeScript · Blake owns all portal edits · separate Neon DB + Redis · four ClickUp lists as stages ·
  warranty letters human-reviewed forever · dealership = first-class persistent entity; projects end ·
  OEM = `oems[]` attribute · prefer partner API/webhook over email parsing where available ·
  work stays inside `~/Projects`, commit to `main`.
