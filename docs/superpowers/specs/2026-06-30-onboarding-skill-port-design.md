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

**Reality check — email is the primary channel, not the forms.** The two forms are used **~1% of the time, if that.** The overwhelming majority of customer communication — the integration approvals, the user lists, the parts data that has to be added to the accounts — arrives by **email** (body text, Excel/PDF attachments, screenshots). So the true heart of this build is **orchestrating the flow of data from email → into the accounts/ClickUp**, with the forms as a rare high-fidelity shortcut. Even when a dealer *does* come in through a form, we still watch the email thread for the rest of the data. The roster extractor (§6) is therefore an **email-first** component.

**The orchestrator's job is the connective tissue neither form provides:**
1. **Source of truth** — mint Dealer ID (`DLR-`) + project id (`ONB-…`) and stamp them onto the form-created tasks.
2. **Region** — detect it, set the plain-English MOC Region custom field (so it rides into Warranty Submissions), and push it to the portal dealer.
3. **Lifecycle transitions** — promote pending → inbound, go-live, and the emails neither form sends.
4. **Roster extractor** — ingest the users the setup form already attached; apply the role×DMS completeness matrix; run missing-email reach-back + dealer notification.
5. **Reconciliation** — match form-created tasks back to projects and stamp the IDs.

**In scope (Blake's call to pull forward):** the **comms arm** — the email sweep + classification (§2.5) — is now part of this plan, absorbing and retiring `ez-wins-email-assistant`. So lifecycle transitions become **email-driven** (auto), with the manual buttons kept as a fallback/override.

**Out of scope (later plans):** deep support/investigation/warranty handling (the comms arm classifies all four types and keeps support/warranty at the assistant's *current* behavior so it can retire, but only **onboarding** is wired deeply here). Warranty RO-line classification stays in `AI-Warranty-Analyst`.

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

Each arrow is **email-driven** once the comms arm (§2.5) is live: a detected MOC intro fires Stage 1, a detected integration-approval email fires Stage 2, and a ClickUp task-complete fires Stage 3. Phases A/B build these as **manual buttons** first (so they're testable before the sweep); C/D make them automatic, with the buttons kept as overrides.

---

## 2.5 The comms arm — the front door (absorbed from `ez-wins-email-assistant`)

Email is the real channel, so the orchestrator grows an **email sweep** that becomes the automatic trigger for the whole lifecycle. We **absorb and retire** the existing `ez-wins-email-assistant` — no parallel running (or double tasks/drafts).

**What ports cleanly (reuse):**
- **MS Graph client** (`lib/graph.js`) — client-credentials auth (`MS_TENANT_ID/CLIENT_ID/CLIENT_SECRET/MS_USER_EMAIL`), thread fetch, draft creation, signature append.
- **Cadence engine** (`lib/followups.js`) — the onboarding follow-up ladder (nudge +2/+3/+3 bd → last-ditch → MOC-rep +3bd → "call them" Planner +5bd), business-day math in CT, anchored on send, stops on any reply or stage advance. **Generalize to per-type tracks** (execution-plan §cadence).
- **Classification prompt** (`lib/email_assistant_prompt.md`, ~986 lines) — port the rules as the classifier; it already recognizes onboarding intros (RULE 6D), support requests, noise, and "already replied."

**What we rebuild / add:**
- **Sweep loop** — Vercel cron (port the existing schedule), 1.5 h lookback, dedup via Outlook **category tags** (`EZ-Assistant-Processed` + outcome tags). Re-key every email by **`conversationId` → project** (the keystone): an email either attaches to an existing project or mints one.
- **Classification covers all four types** (onboarding/support/investigation/warranty-request) → so the assistant retires without regression. **This plan wires onboarding deeply; support/warranty stay at the assistant's current behavior** (classify → task → draft → cadence) and deepen in later plans.
- **Concrete DMS-approval triggers** — the assistant recognizes onboarding *intent* via the prompt but does **not** hard-match the integration-approval emails. We add explicit detectors for the **Stage 2** trigger, built from the real samples in `docs/reference/dms-samples/` (Fortellis "Activation Details", Reynolds RCI deployment confirmation, Tekion "Integration Confirmed", DealerVault "Feed Activated"). Detecting one of these auto-advances the project pending → inbound.
- **The OUTBOX (action queue)** — replaces drafts-in-the-Outlook-folder. Proposed actions (draft reply, create/advance task, reach-back, send-welcome, internal-pull) land in a Neon `action_queue` with a UI for **approve / edit / reject**, and the decision logs to `decision_log` (RAG substrate). Drafts-first for everything at this stage.
- **Structured extraction** — the assistant does **no** content parsing of attachments; the roster extractor (§6) is net-new and the sweep feeds it (email body + Excel/PDF/PNG → roster).
- **Real send (MS Graph)** — the assistant never sends; §7 adds `sendMail`. Verify **Mail.Send** first.

**Storage shift:** the assistant kept only Redis (follow-up state + activity log) and no DB. In the orchestrator, projects/roster/queue live in **Neon**; Redis stays for cadence state + admin sessions.

**Cutover:** ship the comms arm, confirm parity on a live sweep, then switch the old assistant **off** (disable its crons) before relying on the orchestrator — never both.

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

**`action_queue`** (the OUTBOX) — `project_id`, `kind` (draft_reply/create_task/reach_back/send_welcome/login_prompt/internal_pull), `proposed_payload` jsonb, `state` (pending/approved/edited/rejected/sent), `decision_log`, timestamps.

**`cadence`** (follow-up engine state, generalized from `lib/followups.js`) — `project_id`, `type`, `track` (customer/moc_rep/missing_email/integration_chase), `anchor_sent_at`, `next_due`, `step`, `stopped_reason`. (Redis may back the live counters as today; Neon holds the durable record.)

**`decision_log`** (exists) — every confirm/correct on region, group match, roster row, or OUTBOX action.

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

One extraction service, four inputs, one normalized roster — built once, reused everywhere. **Email is the primary input** (~99% of real volume); the form path is the rare shortcut.

| Input | Share | Method |
|---|---|---|
| **Email plain text** (users typed in the body) | primary | AI extraction |
| **Email attachment** — Excel / CSV / docx | primary | AI extraction |
| **Email screenshot / PNG** | primary | **Claude vision** |
| Setup-form **typed** fields | ~1% | structured JSON, **no AI**, highest fidelity |
| Setup-form **Excel upload** | ~1% | AI extraction |

**Email intake surface (the near-term bridge).** The full auto email-sweep is the comms arm (Phase 1, not built yet). Until then, the orchestrator gives the onboarding person an **email intake**: paste the email body and/or upload its attachments (Excel/PDF/PNG) against a dealership/project → the extractor runs → roster commits and the **original file is attached to the ClickUp task**. When the comms arm lands, it feeds the *same* extractor automatically — the manual intake is the interim front door, not throwaway work.

**The rare form path.** When the setup form *is* used, extend `moc-setup-form`'s submit fan-out to **also POST the structured roster** to the orchestrator intake (keyed by Dealer ID / project id); fallback is reading the `{Store}_Users.xlsx` attachment off the task. Lower priority than the email intake given the ~1% usage. Always keep the original file attached to the task regardless of source.

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

New `lib/email.ts` sends via **MS Graph** (client-credentials, reusing the ported `lib/graph.js` auth) from Blake's mailbox. **This is net-new — the email assistant only ever drafted, never sent** — so Mail.Send is the one new permission to confirm. Outbound still routes through the OUTBOX (drafts-first); "send" is the approved action. Three events:

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

The **OUTBOX (action queue)** is the primary surface once the comms arm is live — swept emails produce proposed actions (draft replies, task create/advance, reach-backs, sends) that you approve / edit / reject. The buttons below remain as manual overrides for when you want to drive a transition by hand:
- **Stage 1:** open deal / create dealership (mostly exists) — now also captures address + contacts, auto-detects region.
- **Stage 2:** "Integration approved → promote" (complete pending, create/reconcile inbound task, send MOC data-request email).
- **Stage 3:** "Mark complete → go live" (portal → live, send go-live email).
- **"Parts & users onboarded → notify dealer."**
- **Email intake (primary):** paste email body and/or upload attachments (Excel/PDF/PNG) against a dealership/project → roster extractor → commit + attach original to the task. This is the main day-to-day surface.
- **Feed intake:** paste/upload + review table (the 5 DMS sources).
- **Review queue.**

Even for a form-originated dealer, the email intake stays active — we keep pulling the rest of the data from the thread.

---

## 12. Verification model

No local Node/test runner. Verify via: Vercel build green; internal page actions; Neon row checks; ClickUp task inspection (task created on the right list, description format exact, MOC Region + IDs set); portal dealer reflects region + live status; a test send confirms MS Graph delivery.

---

## 13. Build phases (one plan, sequenced)

A. **Data model** + region/brand detection + portal region + ID stamping on existing tasks.
B. **Task builder** + 3-stage lifecycle + recipients model (manual-button driven first, so it's testable before the sweep).
C. **Comms arm** — port `lib/graph.js` + the classification prompt; sweep loop (cron, conversationId→project keying); the **OUTBOX/action_queue** UI (approve/edit/reject); concrete DMS-approval detectors (Stage 2 auto-advance); generalize the cadence engine. Classify all four types; wire onboarding deeply, keep support/warranty at parity. **Cutover: retire the email assistant.**
D. **MS Graph real send** — `lib/email.ts` (Mail.Send), wired to the three lifecycle emails + roster reach-back, routed through the OUTBOX.
E. **Roster extractor** — email-first: the sweep feeds it (body + Excel/PDF/PNG via AI/vision); manual email intake as fallback; form fan-out as the ~1% path; completeness matrix + missing-data paths + dealer notification.
F. **Feed ingesters** (app-side parsers) + review table + agent-side scrape/address hooks + reconciliation.

Each phase ends at an independently testable deliverable. A/B ship value before the comms arm exists; C/D retire the assistant and make it email-driven; E/F complete the data flow.

---

## 14. Open items to confirm during build
- **MS Graph sender + Mail.Send permission** (else Resend fallback) — the new send capability.
- **Email-assistant cutover** — confirm parity on a live sweep, then disable the assistant's crons before the orchestrator goes live. Never run both.
- **Classification prompt reuse** — port `email_assistant_prompt.md` as-is vs. trim to the four-type classifier (default: port as-is, extend for investigation/warranty).
- **`moc-setup-form` fan-out extension** — POST roster to orchestrator vs read the `_Users.xlsx` attachment (default: extend the fan-out).
- Whether the dealer-notification recipients are the **request** dealer contacts or the **roster** users (default: the roster users actually provisioned).
