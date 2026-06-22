# EZ Wins — Back-to-Front Automation Execution Plan

**Author:** Blake + Claude
**Status:** Approved for build, sequenced for Claude Code
**Scope of this plan:** the onboarding journey end to end. The architecture is built
type-agnostic so support claims (`SUP`) and warranty uplift (`WUP`) plug into the same
spine later without a rebuild, but only onboarding (`ONB`) is built here.

---

## The one idea everything hangs on

A new **Orchestrator** app is the brain. It mints and owns a **universal project ID**
that travels through every other system. Every other tool is a doer that stores a copy
of that ID so anything can be cross-looked-up: the Outlook thread, the ClickUp task, the
portal pipeline dealer, the matcher run, the attachments. The orchestrator holds the
knowledge, the state, the AI decisioning, the follow-up cadence, the action queue, and
the RAG. ClickUp holds the coarse team stage. The portal holds dealer, pipeline, and
billing truth.

This solves the ClickUp reservation directly: **time-based follow-ups never live in
ClickUp.** The cadence engine lives in the orchestrator, keyed by project ID.

```
                         ┌──────────────────────────────┐
                         │        ORCHESTRATOR          │  (new app, own Neon DB)
                         │  project registry (the ID)   │
                         │  AI classify + extract        │
                         │  cadence engine (Redis)       │
                         │  OUTBOX / action queue        │
                         │  RAG + trust-ramp             │
                         └───┬────────┬────────┬─────────┘
            project_id ref   │        │        │   project_id ref
        ┌────────────────────┘        │        └────────────────────┐
        ▼                             ▼                             ▼
   ┌─────────┐                  ┌───────────┐                 ┌──────────┐
   │ Outlook │                  │  ClickUp  │                 │  Portal  │
   │ (Graph) │                  │ team flow │                 │ pipeline │
   │ thread  │                  │ NEW→DEV→  │                 │ + billing│
   │ tagged  │                  │ ONB→DATA  │                 │ + MOC rep│
   └─────────┘                  └───────────┘                 └──────────┘
        ▲                             ▲                             ▲
   Setup form / Onboarding form push into this spine (project_id stamped, never pulled-from when structured)
```

---

## Data model (orchestrator Neon DB)

### `project` (the registry — the keystone)

| Field | Notes |
|---|---|
| `id` | typed, sequential: `ONB-2026-0142`, `SUP-…`, `WUP-…` |
| `type` | `onboarding` \| `support` \| `warranty_uplift` |
| `status` | coarse, mirrors ClickUp stage |
| `substate` | jsonb — the fine-grained truth ClickUp can't hold (integration_approved, dev_done, roster_complete, incentives_in, launch_date, users_sent, etc.) |
| `dms` | **underlying** DMS: CDK, Reynolds, Tekion, DealerTrack, Automate, PBS… |
| `conduit` | how it integrates: `direct` \| `fortellis` \| `dealervault` \| `tekion` \| `reynolds_rci` |
| `dealer_name`, `group_name` | |
| `moc_reps` | jsonb array — the people actually attached to this deal |
| `outlook_conversation_id` | foreign key into Graph |
| `clickup_task_id` | foreign key into ClickUp |
| `portal_dealer_id` | foreign key into the portal |
| `created_at`, `updated_at` | |

`dms` and `conduit` are **separate on purpose** (Blake's call): a DealerTrack dealer that
rides in through DealerVault is still known to be DealerTrack, which is what the ID-needed
rule keys off.

### `roster_member`

`project_id`, `name`, `email`, `role` (manager/owner/gm/fod/advisor/technician),
`dms_id`, `source` (form_typed/form_upload/email_text/email_attachment/email_image),
`confidence`, `missing` (array), `action` (none/reach_back/internal_id_pull/clear_manually).

### `action_queue` (the OUTBOX — the human-in-the-loop surface)

`project_id`, `kind` (draft_reply/create_task/reach_back/send_welcome/login_prompt/internal_pull),
`proposed_payload` jsonb, `state` (pending/approved/edited/rejected/sent), `decision_log`
(for RAG training), timestamps.

### `cadence` (the follow-up engine state — Redis or table)

`project_id`, `track` (customer/moc_rep/missing_email/integration_chase), `anchor_sent_at`,
`next_due`, `step`, `stopped_reason`. Business-day math, anchored on when the email was
actually **sent**, stops the moment anyone replies or the project stage advances. Reuse the
proven pattern already in the email assistant's `lib/followups.js`.

---

## The roster extractor (central component, used everywhere)

One extraction service, fed by four inputs, producing one normalized roster. Build it once;
the setup-form upload and the inbox both call it.

| Input | Path |
|---|---|
| Setup form typed fields | structured JSON, **no AI**, highest fidelity |
| Setup form upload (arbitrary Excel) | AI extraction |
| Email plain text / Excel / docx attachment | AI extraction |
| PNG / screenshot (in email or form) | **Claude vision** extraction |

**Always attach the original file/PNG to the ClickUp task**, even after parsing.

Completeness is **field-level and conditional on role × DMS**, not a flat row check.
The required-fields matrix (locked):

| Role | Email | DMS ID needed? | If email missing | If DMS ID missing |
|---|---|---|---|---|
| Manager / Owner / GM / FOD | required | no | **reach back to sender** | n/a |
| Advisor | required | only CDK / Fortellis / DealerTrack | **reach back to sender** | those DMS → internal pull from raw data; else ignore |
| Technician | not needed | only CDK / Fortellis / DealerTrack | n/a | those DMS → internal pull from raw data; else ignore |

Two missing-data paths, **never crossed**:
- **Missing email** on a platform user → the only thing that ever goes back to the sender.
  Orchestrator drafts a reply naming exactly who is missing an email and chases on cadence.
- **Missing DMS ID** → never contacts the sender. On CDK/Fortellis/DealerTrack it becomes an
  internal onboarding-team task to pull the ID from the raw data report. On any other DMS it
  is silently ignored.

ID-need keys off the **underlying `dms`**, not the conduit. Per-row, not per-file: confident
rows commit, only the doubtful ones queue, so one bad row never blocks a dealership.

Parsing realities the extractor must clear (from the three real samples):
- IDs buried inside the Name in parens AND in an underscore identifier with a row-index prefix.
- Role carried only by section-header rows (Service Advisor Staff / Service Tech Staff).
- One file with two different layouts (freeform `Name email` lines + an `ID | Name` table with blank separator rows).
- Alias junk (`Nicolas To | Nic To`), inconsistent email casing, near-duplicate names (`Mario Ramos` / `Mario Ramos III`).

---

## Build order

Each phase is independently shippable and ordered by dependency. Phases 0–1 are the backbone
and deliver value immediately.

### Phase 0 — Orchestrator skeleton + project registry
**New.** Next.js on Vercel, own Neon DB. Project registry schema + typed ID minting.
Single-user auth (reuse the setup form's `lib/security.js` pattern). Cross-system reference
plumbing: create the ClickUp `project_id` custom field; add the `project_id` column to the
portal dealers table; tag Outlook threads with the project ID.
**Done when:** an ID can be minted and the same ID is readable on a portal dealer, a ClickUp
task, and an Outlook thread.

### Phase 1 — Comms arm (absorb the email assistant) + the OUTBOX
**Rebuild + extend.** Port the sweep → classify → decision-object pipeline and the cadence
engine into the orchestrator, re-keyed by project ID. Build the **action queue UI** — proposed
actions land here for approve / edit / reject. **This replaces the Outlook drafts folder** as
where Blake reviews outgoing work. Drafts-first for everything at this stage.
**Done when:** a new inbox thread is classified, attached to a project, and a drafted reply
sits in the orchestrator outbox (not Outlook) for one-tap approval.

### Phase 2 — Onboarding detection → pipeline creation
**Extend.** On a detected onboarding: create the portal pipeline dealer (with `dms` +
`conduit`), attach the MOC rep and contacts from the email, mint the project ID, create the
ClickUp task at `NEW` stamped with the ID. Reconcile the onboarding form so form-originated
onboardings also receive a project ID and orchestrator tracking. The attached MOC rep is what
drives the region connections and decides who gets the "it's ready" notice later.
**Done when:** an onboarding email produces a tracked project, a portal pipeline dealer, and a
linked ClickUp task with the MOC rep attached, with zero manual entry.

### Phase 3 — Roster extractor
**New + extend.** Build the extraction service above. Extend the setup form's submit fan-out to
**POST to the orchestrator** carrying typed roster JSON + the raw uploaded file + the project ID
(read from the ClickUp custom field; fall back to task ID / dealer name and reconcile). Wire the
missing-email → reach-back action and the missing-ID → internal-pull task.
**Done when:** the three real sample formats and a typed form submission all normalize to the
same roster on the project record, with the correct reach-back vs internal-pull vs ignore action.

### Phase 4 — Integration approval automation (per DMS) + Playwright worker
**New.** Inbound approval detection per DMS, plus a Playwright worker that reuses saved
authenticated sessions.
- **Reynolds:** parse the inbound approval ZIP for the ID → dev task. Surface "sign the docs"
  as an action when Blake's signature is needed (stays a human step by design).
- **Tekion:** session stays live a while → near-autonomous subscription-ID pull triggered off
  the approval email.
- **Fortellis:** session expires in hours → pull the Excel and diff new feeds; if the session
  is dead, drop a one-tap **"log in so I can grab the ID"** item into the queue, then pull.
- **DealerVault:** **data entry stays fully manual** (no bot in their portal). Only the **read**
  of the approved dealer ID is automated, same expired-session prompt as Fortellis. Plus the
  +3-business-day chase to the FOD whose admin hasn't approved yet.
**Done when:** an approval email for each DMS results in the ID landing on the project + dev
task automatically, or a single login prompt when a session is dead.

### Phase 5 — Delivery: "it's ready" → launch date → welcome emails
**New.** ClickUp task completion (the `DATA ANALYSIS` / done trigger) fires an orchestrator
action. The orchestrator identifies the right MOC rep(s) from the project record, drafts the
"it's ready" message, and asks for a launch date if one wasn't captured. On the confirmed launch
date it **auto-sends the welcome-email batch** — the same generic password-reset link for
everyone, so no temp passwords ever leave the system and no per-user step is needed. Then it
notifies MOC that users were sent.
**Done when:** completing the ClickUp task drives the ready-notice, captures the launch date,
and fires welcome emails on that date with no manual action.

### Phase 6 — RAG + trust-ramp
**New.** Capture every approve / edit / reject in the action queue as a training signal. Stand up
the RAG (designed to span sales, support, and warranty data types — proper vector store +
structured decision log, not a toy). Retrieve similar past situations to inform proposals
("this happened before, here's what we did"). Graduate proven action types from drafts-first to
auto-send-with-monitoring, one kind at a time.
**Done when:** repeated identical situations propose the right action with rising confidence, and
at least one low-risk action type runs auto-send under monitoring.

---

## Cross-system wiring checklist (footguns to clear during build)

- **Two "Companies Inbound" list IDs disagree** — setup form uses `901105435045`, the onboarding
  form + email assistant use `901113435718`. Canonicalize before wiring intake.
- **ClickUp `project_id` custom field** — create it, then hardcode/resolve its field UUID the same
  way the email assistant maps its other field UUIDs.
- **Portal dealer field add** — adding `project_id` (and any other column) must touch all four
  places: GET snake→camel map, POST camel→snake, the `INSERT … ON CONFLICT` upsert, and
  `neon-schema.sql`. Run `alter table … add column if not exists` in Neon **before** deploying or
  every dealer save 500s.
- **Graph quirk** — `$filter` + `$orderby` together is rejected; filter server-side, sort client-side.
- **Resend domain** — onboarding form still sends from the `onboarding@resend.dev` sandbox; verify
  the domain before welcome emails go live.

## Stays manual by design (not gaps)
- Blake signs Reynolds documents.
- DealerVault portal data entry.
- Periodic re-login for Fortellis / DealerVault when the saved session expires (one tap from the queue).
- Onboarding team clears flagged low-confidence roster rows and runs internal raw-data ID pulls.

## Build environment
Claude Code on the Mac terminal pushes to GitHub and Vercel auto-deploys (no Node/terminal
constraint anymore). Claude Code owns deploys end to end. Each phase ships on its own.
