# EZ Wins Orchestrator — Status & Handoff

**Last updated:** 2026-06-26
**Where we are:** Phase 0 ✅ & Phase 0.5 ✅ both built, deployed green, and verified (group →
dealership → project working end-to-end; migration run; `GRP-000001`/`DLR-000002`/`ONB-2026-0002`
minted on the live page). All 4 DMS approval flows ✅ mapped. **Next build = Phase 1 (comms arm).**

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

## Built so far

- **Phase 0** — spine: typed ID minting + project↔portal/ClickUp/Outlook wiring + acceptance page.
- **Phase 0.5 ✅** — group → dealership → project entity model (dealership = first-class memory
  anchor; projects end). Spec: `docs/specs/group-dealership-entity-model.md`; plan:
  `docs/plans/phase-0.5-entity-model.md`. Live & verified.

## DMS approval flows — `docs/specs/dms-approval-flows.md`

- **Fortellis ✅ CONFIRMED** (real email): `noreply@fortellis.io` / "EZ Wins Activation Details" →
  `Organization` (store) + `Subscription ID` (feed).
- **Reynolds ✅ CONFIRMED** (real emails): all from `RCI_Deployment@reyrey.com`, structured subjects
  keyed on **Customer #** / **PPSYSID**. Full lifecycle mapped: onboarding (order → ack →
  docs-ready+**RCI-1 PDF** → `- COMPLETED` = approved+data-delivered) AND offboarding
  (`- CANCELLED` decline, termination, BUY/SELL). **Proved we can pull the RCI-1 PDF off the email and
  extract every field** (Customer #, PPSYSID/Store/Branch, address, EULA date, signatory).
- **Tekion ✅ CONFIRMED.** Two emails from `noreply-apc@tekioncloud.com`: "New Connection Request"
  (connection already live → create Branch task from name+address → Dev; Dealer ID via dashboard
  scrape, devs fetch it) and "withdrawn" (ignore). No API, no approval step.
- **DealerVault ✅ CONFIRMED.** Authenticom 3-email flow: Feed Approval Request Confirmation (lists
  the dealer's approver contacts — auto-draft a loop-in email, Blake's idea), Client Action Needed
  (unresponsive → chase trigger), Feed Activated (→ scrape DVD ID + DMS, create Branch task → Dev).
  Portal submit stays manual.

**All 4 DMS deep-dives complete** — see `docs/specs/dms-approval-flows.md`.

## Onboarding skill absorbed → Phase 2 blueprint

`docs/reference/onboarding-skill/` (the real EZ-Wins skill). Encodes task-creation for all sources
(Fortellis CSV, Reynolds RCI-1 PDF, DealerVault paste, Tekion paste, **Tekion APC browser scrape**):
the dev-team **description format**, `task_type:"Branch"` auto-subtask on list `901105435045`, MOC
Region field IDs, brand/group/region detection, `seen_orgs`/`seen_groups` dedup, MOC-Users + group
comments, EZ-Wins group-naming rule. The orchestrator absorbs this as Phase 2.

---

## Open items / next actions

1. **Build Phase 0.5** — the next build. Run `docs/plans/phase-0.5-entity-model.md` (Blake runs the
   migration SQL in Neon when prompted). DMS mapping is done; nothing blocks the build.
2. **Minor, deferred:** Reynolds package-conversion / billing / re-cert rounds; reverse-lookup UI
   auto-fill; the `tekion-approval-guide.pdf` missing-file bug in MOC-Onboarding-Form.

## Decisions locked
- TypeScript · Blake owns all portal edits · separate Neon DB + Redis · four ClickUp lists as stages ·
  warranty letters human-reviewed forever · dealership = first-class persistent entity; projects end ·
  OEM = `oems[]` attribute · prefer partner API/webhook over email parsing where available ·
  work stays inside `~/Projects`, commit to `main`.
