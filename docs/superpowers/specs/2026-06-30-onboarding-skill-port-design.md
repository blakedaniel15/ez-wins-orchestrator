# Onboarding-Skill Port — Design Spec

**Date:** 2026-06-30
**Status:** Draft for Blake's review
**Goal:** Make the orchestrator the brain that drives the full onboarding lifecycle end-to-end — minting the universal IDs, detecting region, creating/advancing the ClickUp tasks, collecting the dealership users, and sending the right emails at the right moments — by *integrating* the two existing form apps rather than rebuilding them.

---

## 1. Guiding principle: integrate, don't rebuild

Two production apps already do real work. The orchestrator wraps them; it does not duplicate them.

| App | Already does | ClickUp list |
|---|---|---|
| **`MOC-Onboarding-Form`** | DMS authorization ("step 0"): creates the pending task, sends DMS-specific approval emails (Fortellis/Reynolds/Tekion/DealerVault), generates the signed PDF | **Feed Approval Pending** `901113435718` |
| **`moc-setup-form`** | Setup ("step 1"): collects **users** (Excel-paste or typed rows), parts, techs, menus; builds `{Store}_Users.xlsx`; attaches to the task; comments + @mentions Blake & Nicolás; pre-loads the store list from Companies Inbound | **Companies Inbound** `901105435045` |

**The orchestrator's job is the connective tissue neither form provides:**
1. **Source of truth** — mint Dealer ID (`DLR-`) + project id (`ONB-…`) and stamp them onto the form-created tasks.
2. **Region** — detect it, set the plain-English MOC Region custom field (so it rides into Warranty Submissions), and push it to the portal dealer.
3. **Lifecycle transitions** — promote pending → inbound, go-live, and the emails neither form sends.
4. **Roster extractor** — ingest the users the setup form already attached; apply the role×DMS completeness matrix; run missing-email reach-back + dealer notification.
5. **Reconciliation** — match form-created tasks back to projects and stamp the IDs.

**Out of scope (later phases):** the comms arm (auto email sweep/classification) — so every lifecycle transition is **manual** for now (buttons in the orchestrator UI). Warranty RO-line classification stays in `AI-Warranty-Analyst`.

---

## 2. The three-stage lifecycle

```
Stage 1  MOC intro email ("bring this group / these stores on")
         → mint dealership(s)/group → portal (status: pipeline)
         → capture request participants (MOC + dealer), linked to the store
         → Feed Approval Pending task exists (created by MOC-Onboarding-Form or by us),
           stamped with Dealer ID + project id
         → DMS approval outreach (MOC-Onboarding-Form already sends these)

Stage 2  Integration approval email (DMS confirms the feed is live)
         → complete the Feed Approval Pending task
         → create the Companies Inbound onboarding task (full description + MOC Region
           field + Dealer ID/project id) — OR reconcile the one moc-setup-form created
         → EMAIL the MOC employees: "send us the data to finish onboarding" + setup-form link

Stage 3  Onboarding person marks the Companies Inbound task COMPLETE
         (all data — from email or the setup form — is in the account)
         → move portal dealership pipeline → live
         → EMAIL the original users on the request (go-live notice)

Later    Parts & users all onboarded (separate readiness flag)
         → EMAIL the dealership employees linked to the store
```

Every arrow that says "→ EMAIL" or moves a task/stage is, for now, a **button** in the orchestrator (no comms arm yet). When Phase 1 lands, the same transitions fire automatically off detected emails.

---

## 3. Data model (Neon)

**`dealership`** gains:
- `address`, `city`, `state`, `zip`
- `region` (plain English, e.g. `MOC NorCal`; detected, human-correctable)
- `brand` (detected; `null`/flagged when unknown)
- `door_rate` (default `$225`)
- `platform_fields` jsonb — per-DMS identifiers:
  - Fortellis: `subscription_id`, `department_id`
  - Reynolds: `ppsysid`, `store_code` (Store#+Branch#), `historical_file_delivered`
  - DealerVault: `dealervault_id`, `underlying_dms`
  - Tekion: `tekion_dealer_id`
- `lifecycle_stage` — `pending | inbound | live`
- `parts_users_onboarded` boolean (gates the dealer-employee email)

**`contact`** (or extend the group's existing `contacts`) — request participants, linked to dealership and/or group:
- `dealership_id`/`group_id`, `name`, `email`, `kind` (`moc | dealer`), `source`

**`roster_member`** (the collected users) — per execution plan:
- `project_id`, `name`, `email`, `role` (manager/owner/gm/fod/advisor/technician),
  `dms_id`, `source` (form_typed/form_upload/email_text/email_attachment/email_image),
  `confidence`, `missing` (array), `action` (none/reach_back/internal_id_pull/clear_manually)

**`decision_log`** (exists) — every confirm/correct on region, group match, roster row.

---

## 4. Region & brand detection (ported)

Port `process_fortellis.py` into pure TS functions:
- `detectRegion(state, city)` → one of the 7 regions or `"ASK"`. `STATE_TO_REGION` map + CA NorCal/SoCal and NV Reno/Vegas city logic; `"ASK"` for ambiguous CA/NV cities and unmapped states.
- `detectBrand(name)` → brand string (CDJR→"Chrysler, Dodge, Jeep, Ram", VW→"Volkswagen", multi-brand comma-joined) or `null`/flag when not found.

`"ASK"` region and `null` brand do **not** guess — they route to the **review queue** for one-click resolution, which logs to `decision_log`.

The 7 regions (plain English, written verbatim to the MOC Region field and portal):
`MOC NorCal`, `MOC SoCal`, `MOC PNW`, `MOC Central`, `MOC Mid-Atlantic`, `MOC Canada`, `Other Distributors`.

---

## 5. ClickUp onboarding-task builder

New `createOnboardingTask` in `lib/clickup.ts` (reusing the existing token + resolve-field-by-name helpers):
- **List** `901105435045` (Companies Inbound), `task_type: "Branch"` (ClickUp auto-builds the subtask tree), name = title-cased dealership name.
- **Description** = the **exact** per-DMS format from the onboarding skill (Dealership Name, Brand, Owner [group or self], Address/City/State/Zip, API Platform, `Door Rate: $225`, DMS, per-platform IDs, `Fluids Provider: MOC Products`). This is a stable contract the dev team's AI parses — copy verbatim. DealerVault carries the **underlying DMS** (DealerTrack/PBS/Dealerbuilt) alongside the DealerVault ID.
- **MOC Region custom field** — a **plain-text** field named "MOC Region", resolved by *name* per list (so per-list field IDs don't matter), written in plain English. **Blake creates this text field on Companies Inbound and on Warranty Submissions** so it travels with the task.
- **Stamp** Dealer ID + project id via the existing resolve-by-name field writers.
- **MOC Users comment** — still posted on the task (the assignee list visible in ClickUp), in addition to the Stage-3 email.

---

## 6. Roster extractor (the user collection)

One extraction service, four inputs, one normalized roster — built once, reused everywhere.

| Input | Method |
|---|---|
| Setup-form **typed** fields | structured JSON, **no AI**, highest fidelity |
| Setup-form **Excel upload** | AI extraction |
| Email plain text / Excel / docx | AI extraction |
| PNG / screenshot | **Claude vision** |

**How the setup-form roster reaches the orchestrator:** extend `moc-setup-form`'s submit fan-out to **also POST the structured roster** to an orchestrator intake endpoint (keyed by the task's Dealer ID / project id). Fallback: the orchestrator reads the `{Store}_Users.xlsx` attachment off the ClickUp task. Always keep the original file attached to the task.

**Completeness — field-level, conditional on role × DMS** (locked matrix):

| Role | Email | DMS ID needed? | If email missing | If DMS ID missing |
|---|---|---|---|---|
| Manager / Owner / GM / FOD | required | no | **reach back to sender** | n/a |
| Advisor | required | only CDK / Fortellis / DealerTrack | **reach back to sender** | those DMS → internal pull; else ignore |
| Technician | not needed | only CDK / Fortellis / DealerTrack | n/a | those DMS → internal pull; else ignore |

**Two missing-data paths, never crossed:**
- **Missing email** → the only thing that ever goes back to the sender. Orchestrator drafts a reply naming exactly who's missing an email; chases on cadence.
- **Missing DMS ID** → never contacts the sender. CDK/Fortellis/DealerTrack → internal onboarding task to pull from raw data; any other DMS → silently ignored.

ID-need keys off the **underlying `dms`**, not the conduit. **Per-row, not per-file:** confident rows commit; only doubtful rows queue — one bad row never blocks a dealership.

Parsing realities to handle (from real samples): IDs in parens inside the name and as `prefix_id` underscore tokens; role carried only by section-header rows; one file mixing freeform `Name email` lines with an `ID | Name` table separated by blank rows; alias junk, inconsistent email casing, near-duplicate names.

---

## 7. Email sending (MS Graph, real send)

New `lib/email.ts` sends via **MS Graph** (client-credentials, MS env vars already in Vercel) from Blake's mailbox. Three events:

1. **Stage 2 — MOC data request.** To the MOC employees on the request. Body: "send us the data to finish onboarding," includes the **setup-form link** (per-dealership, pre-fillable).
2. **Stage 3 — go-live.** To the original users on the request. Announces the store/group is live.
3. **Dealer notification (separate gate).** To the dealership employees linked to the store, fired when `parts_users_onboarded` is set.

Plus the **missing-email reach-back** (roster) as a drafted reply to the sender.

**Recipients model:** contacts come from the **original request**, classified by **email domain** (EZ-Wins/MOC internal → `moc`; dealer's domain → `dealer`) with a manual override on review. The requesting MOC employee and any MOC employee are always on the MOC list. The old region→users docx is **optional** (mergeable later), not required.

**Dependencies to verify before relying on send:** the **sender mailbox** and that **Mail.Send** application permission is granted on the MS app registration. If Graph perms aren't ready, the existing apps' **Resend** path is the proven fallback.

---

## 8. Feed ingesters (the 5 sources)

**App-side (paste/upload in the orchestrator UI):**
- **Fortellis CSV** — upload → parse (port the script's parsing) → records (carry full address).
- **Reynolds** — RCI-1 fields entered/parsed → records (PPSYSID + Store#+Branch# → Store Code; address present).
- **DealerVault paste** — tab-separated lines → records (Dealer Name, DVD ID, underlying DMS; **no address**).
- **Tekion paste** — 8-line blocks → records (name, Tekion Dealer ID; **no address**).

**Agent-side (me, fed into the same intake — the app cannot do these):**
- **Tekion APC browser scrape** — Claude in Chrome pulls Pending-Onboarding rows + detail addresses.
- **Web-search address lookup** — for the address-less feeds (DealerVault/Tekion paste), I look up the address and fill it on the review screen before region detection.

All sources converge on the **review table** (name, brand, group, address, region, flags) → on confirm, run Stage 1 per record.

---

## 9. Reconciliation (forms ↔ orchestrator)

The forms are public and dealer/MOC-initiated, so a task can appear before the orchestrator knows about it. Reconcile both directions:
- **Orchestrator-first:** orchestrator mints + creates the pending task; the setup form (which pre-loads from Companies Inbound) reuses the existing `taskId`.
- **Form-first:** a form creates a task; the orchestrator matches it to a dealership by name (fuzzy, the existing matcher), mints/attaches IDs, and stamps the task. Unmatched tasks surface in the review queue.

---

## 10. Review queue

The single human-in-the-loop surface for everything flagged:
- region `ASK`, brand unknown, address missing, fuzzy/uncertain group match, unmatched form task, roster rows missing email/DMS ID.
- Each row → one-click confirm/correct → action runs, resolution logs to `decision_log` (the substrate the brain learns from).

---

## 11. UI surfaces (manual triggers, until Phase 1)

Buttons on the orchestrator page:
- **Stage 1:** open deal / create dealership (mostly exists) — now also captures address + contacts, auto-detects region.
- **Stage 2:** "Integration approved → promote" (complete pending, create/reconcile inbound task, send MOC data-request email).
- **Stage 3:** "Mark complete → go live" (portal → live, send go-live email).
- **"Parts & users onboarded → notify dealer."**
- **Feed intake:** paste/upload + review table.
- **Review queue.**

---

## 12. Verification model

No local Node/test runner. Verify via: Vercel build green; internal page actions; Neon row checks; ClickUp task inspection (task created on the right list, description format exact, MOC Region + IDs set); portal dealer reflects region + live status; a test send confirms MS Graph delivery.

---

## 13. Build phases (one plan, sequenced)

A. Data model + region/brand detection + portal region + ID stamping on existing tasks.
B. Task builder + 3-stage lifecycle + MS Graph emails + recipients model.
C. Roster extractor (form intake + manual upload/AI/vision) + completeness matrix + missing-data paths + dealer notification.
D. Feed ingesters (app-side parsers) + review table + agent-side scrape/address hooks + reconciliation.

Each phase ends at an independently testable deliverable.

---

## 14. Open items to confirm during build
- **MS Graph sender + Mail.Send permission** (else Resend fallback).
- **`moc-setup-form` fan-out extension** — POST roster to orchestrator vs read the `_Users.xlsx` attachment (default: extend the fan-out).
- Whether the dealer-notification recipients are the **request** dealer contacts or the **roster** users (default: the roster users actually provisioned).
