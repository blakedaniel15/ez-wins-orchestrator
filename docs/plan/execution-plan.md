# EZ Wins — Back-to-Front Automation Execution Plan

**Author:** Blake + Claude
**Status:** Approved for build, sequenced for Claude Code
**Scope of this plan:** automate **all** of EZ Wins' email-driven operations. The spine —
capture, universal ID, cadence, outbox — is **type-agnostic from day one** and serves
onboarding (`ONB`), support (`SUP`), warranty uplift (`WUP`), and investigation/followup
(`INV`) tasks. Type-specific automation deepens phase by phase, but every type rides the
same spine; nothing is bolted on later as a rebuild.

---

## The one idea everything hangs on

A new **Orchestrator** app is the brain. **Every project is born from an email thread.**
The orchestrator watches the inbox, decides whether a thread is new work, mints a
**universal project ID** at that moment, and then builds the infrastructure *around* that ID
(ClickUp task, portal dealer, cadence, attachments). The ID travels into every other system;
each of those systems is a **doer** that stores a copy of the ID so anything can be
cross-looked-up. Downstream events **add to** existing infrastructure instead of creating
duplicates.

The orchestrator holds the knowledge, the state, the AI decisioning, the follow-up cadence,
the action queue, and the RAG. ClickUp holds the coarse team stage. The portal holds dealer,
pipeline, and billing truth.

This solves the ClickUp reservation directly: **time-based follow-ups never live in ClickUp.**
The cadence engine lives in the orchestrator, keyed by project ID.

```
                         ┌──────────────────────────────┐
                         │        ORCHESTRATOR          │  (new app, own Neon DB)
                         │  project registry (the ID)   │
                         │  AI classify + extract        │
                         │  cadence engine (per-type)    │
                         │  OUTBOX / action queue        │
                         │  RAG + trust-ramp             │
                         └───┬────────┬────────┬─────────┘
            project_id ref   │        │        │   project_id ref
        ┌────────────────────┘        │        └────────────────────┐
        ▼                             ▼                             ▼
   ┌─────────┐                  ┌───────────┐                 ┌──────────┐
   │ Outlook │                  │  ClickUp  │                 │  Portal  │
   │ (Graph) │                  │ team flow │                 │ pipeline │
   │ thread  │◄── BIRTHPLACE    │ 4 lists   │                 │ + billing│
   │ tagged  │   of every proj  │ as stages │                 │ + MOC rep│
   └─────────┘                  └───────────┘                 └──────────┘
        ▲                             ▲                             ▲
   Setup form / Onboarding form / Warranty analyst push into this spine
   (carry project_id; reconciled to the thread that birthed the project)
```

---

## Identity & lifecycle (the keystone — read this first)

The hardest problem in the system is **knowing that an email thread, a ClickUp task, a form
submission, and a warranty analysis all belong to the same project.** The model:

1. **Primary key = the Outlook thread.** `outlook_conversation_id` is the **idempotency key**.
   On every inbox sweep: look up the thread's `conversationId`.
   - **Already mapped to a project** → this is an update; attach the event to that project, no
     new ID. (This is exactly how `ez-wins-email-assistant/lib/followups.js` already keys state.)
   - **Not mapped** → candidate new project. Classify the type. Propose minting in the OUTBOX.
2. **Onboarding secondary check (dedup):** dealer name + underlying `dms`. If a new thread
   looks like an existing dealer, the orchestrator proposes the match in the action queue and a
   **human confirms** before merge — until the RAG earns the trust to auto-link.
3. **Forms and the warranty analyst don't birth projects — they enrich them.** The setup form,
   onboarding form, and `AI-Warranty-Analyst` all carry the `project_id` (read from the ClickUp
   custom field; fall back to dealer name + reconcile) so their data lands on the project that
   the originating thread already created.

**Every type is born in an email** (confirmed): onboarding intro emails, support requests,
warranty-uplift requests, and investigation threads all originate in Blake's inbox. Warranty has
an analysis step in a separate app in the middle, but the project is still born from, and the
letter still returns to, the same thread.

**Groups: one thread → many dealerships (must-handle).** A dealer group can arrive as a SINGLE
email thread covering N dealerships (real case 2026-06-24: 13 dealers via Fortellis, one thread,
many separate Fortellis feeds/links). So `conversationId` alone can't be the whole key — a thread
can map to a **group** with N child dealership projects. Design implication: each dealership still
gets its own project ID (mirrors how `MOC-Onboarding-Form` creates one ClickUp task per store);
they share a `group_name` / group link and the originating thread; and per-dealership signals (a
Fortellis feed confirmation, a roster, a launch date) must be matched to the **specific** child
project, not just the thread. The dedup/identity layer must resolve thread → group → which child.

### Manual project creation (the escape hatch)

Not everything starts cleanly from auto-detection — sometimes Blake wants to start a project
proactively, or the detector missed one. The manual path **creates in the orchestrator** (never in
ClickUp first), so the ID is always minted by the single source of truth, then connects the thread
as a separate, reversible step. All connect methods converge on the same end state:
`conversationId` stored on the project **+** an `EZW-{projectId}` Graph category on the thread.

1. **Create** — a "New Project" form on the orchestrator's internal page: type (ONB/SUP/WUP/INV),
   dealer name, `dms`, `conduit`, MOC reps, optional notes. It runs a **dedup check first** (warns
   "a project for this dealer already exists — link instead?"), mints the ID, and optionally creates
   the ClickUp task on that type's list.
2. **Connect the thread** — any of three convergent entry points:
   - **Direct attach** — paste the thread's `conversationId` or an Outlook message link; the
     orchestrator stamps the category and stores the link. Deterministic, instant. *(Phase 0.)*
   - **Tag-in-Outlook** — Blake applies the `EZW-{id}` category to the thread himself; the next
     sweep reads it and binds. (Robust version of "paste the ID into the thread.") *(Phase 1.)*
   - **Propose-and-approve** — the orchestrator spots an unlinked thread matching the project
     (dealer/contact) and proposes the link in the OUTBOX for one-tap approval. *(Phase 1.)*

Sequencing: direct-attach ships in **Phase 0** (a small extension of the internal page, which
already mints + runs the three wirings). Propose-and-approve arrives in **Phase 1** with the OUTBOX.
Expected day-to-day: live in propose-and-approve, with direct-attach as the manual fallback.

---

## Task types (the universe the spine must cover)

Ported from the email assistant's classifier (`lib/email_assistant_prompt.md`), now each type
mints a project ID:

| Type | Prefix | Born from | Cadence today | Cadence target |
|---|---|---|---|---|
| Onboarding (DMS feed) | `ONB` | MOC rep intro email | 4 nudges → MOC rep → "call them" task | keep, re-key by project_id |
| Support request | `SUP` | dealer/client email asking for a platform action | **none** | **NET-NEW**: internal chase until resolved **+** notify requester on completion |
| Warranty uplift | `WUP` | dealer/MOC email | none | letter-deadline guard (see Phase 7) |
| Investigation/followup | `INV` | email needing diagnosis or a Blake decision | none | light: nudge Blake until the Planner task closes |
| Other / client_update | — | — | — | **no project** (no task today, none now) |

---

## ClickUp lists are coarse STAGE buckets (keep them separate)

There are **four** lists in play. They are **not duplicates** — they are stages, and the
orchestrator owns the moves between them so the "working" spaces never fill with "waiting" items:

| List ID | Meaning | Who writes it today |
|---|---|---|
| `901113435718` | **Feed Approval Pending** — onboarding waiting for integration approval (= portal "pipeline") | onboarding form + email assistant |
| `901105435045` | **Approved onboarding working space** — integration approved; dev downloads, onboarding team completes | setup form |
| `901106848667` | **Support Requests** | email assistant |
| `901111643961` | **Blake › Planner** — investigation/decision tasks | email assistant |

The orchestrator **moves a task `901113435718` → `901105435045`** automatically when integration
approval lands (Phase 5 trigger). Don't combine the lists — the split is a signal the system uses.

---

## Data model (orchestrator Neon DB)

### `project` (the registry — the keystone)

| Field | Notes |
|---|---|
| `id` | typed, sequential per year: `ONB-2026-0142`, `SUP-…`, `WUP-…`, `INV-…` |
| `type` | `onboarding` \| `support` \| `warranty_uplift` \| `investigation` |
| `status` | coarse, mirrors the ClickUp list/stage |
| `substate` | jsonb — fine-grained truth ClickUp can't hold (integration_approved, dev_done, roster_complete, incentives_in, launch_date, users_sent, warranty_ro_count, letter_sent, etc.) |
| `dms` | **underlying** DMS: CDK, Reynolds, Tekion, DealerTrack, Automate, PBS… |
| `conduit` | how it integrates: `direct` \| `fortellis` \| `dealervault` \| `tekion` \| `reynolds_rci` |
| `dealer_name`, `group_name` | |
| `moc_reps` | jsonb array — the people actually attached to this deal |
| `outlook_conversation_id` | **the idempotency key** — foreign key into Graph |
| `clickup_task_id` | foreign key into ClickUp |
| `portal_dealer_id` | foreign key into the portal |
| `warranty_project_id` | foreign key into AI-Warranty-Analyst's DynamoDB session (WUP only) |
| `created_at`, `updated_at` | |

`dms` and `conduit` are **separate on purpose** (Blake's call): a DealerTrack dealer that rides
in through DealerVault is still known to be DealerTrack, which is what the ID-needed rule keys off.

### `roster_member`

`project_id`, `name`, `email`, `role` (manager/owner/gm/fod/advisor/technician), `dms_id`,
`source` (form_typed/form_upload/email_text/email_attachment/email_image), `confidence`,
`missing` (array), `action` (none/reach_back/internal_id_pull/clear_manually).

### `action_queue` (the OUTBOX — the human-in-the-loop surface)

`project_id`, `kind` (draft_reply/create_task/reach_back/send_welcome/login_prompt/
internal_pull/**draft_warranty_letter**/**support_followup**), `proposed_payload` jsonb,
`state` (pending/approved/edited/rejected/sent), `decision_log` (for RAG training), timestamps.

### `cadence` (the follow-up engine state — generalized)

`project_id`, **`type`**, `track` (customer/moc_rep/missing_email/integration_chase/
**support_internal**/**support_requester**/**warranty_letter**), `anchor_sent_at`, `next_due`,
`step`, `stopped_reason`. Business-day math (Central Time), anchored on when the email was
actually **sent**, stops the moment anyone replies or the project stage advances. **Generalize the
proven onboarding engine in `lib/followups.js` from onboarding-only to per-type tracks** — same
ladder math, more tracks. The current onboarding ladder (preserve it): nudge +2, +5, +8 business
days → last-ditch → MOC-rep email +3bd → "call them" Planner task +5bd.

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
  internal onboarding-team task to pull the ID from the raw data report. On any other DMS it is
  silently ignored.

ID-need keys off the **underlying `dms`**, not the conduit. Per-row, not per-file: confident rows
commit, only the doubtful ones queue, so one bad row never blocks a dealership.

Parsing realities the extractor must clear (from the three real samples):
- IDs buried inside the Name in parens AND in an underscore identifier with a row-index prefix.
- Role carried only by section-header rows (Service Advisor Staff / Service Tech Staff).
- One file with two different layouts (freeform `Name email` lines + an `ID | Name` table with blank separator rows).
- Alias junk (`Nicolas To | Nic To`), inconsistent email casing, near-duplicate names (`Mario Ramos` / `Mario Ramos III`).

---

## Build order

Each phase is independently shippable and ordered by dependency. Phases 0–1 are the backbone
and deliver value immediately. The spine is type-agnostic; type-specific depth phases in after.

### Phase 0 — Orchestrator skeleton + project registry
**New.** Next.js on Vercel, own Neon DB. Project registry schema + typed ID minting for **all
four types**. Single-user auth (reuse the setup form's `lib/security.js` pattern). Cross-system
reference plumbing: create the ClickUp `project_id` custom field; add the `project_id` column to
the portal dealers table; tag Outlook threads with the project ID and store `conversationId` (the
keystone wiring).
**Done when:** an ID of each type can be minted and the same ID is readable on a portal dealer, a
ClickUp task, and an Outlook thread, with the thread's `conversationId` stored on the project row.

### Phase 1 — Comms arm (absorb + retire the email assistant) + the OUTBOX
**Rebuild + extend.** Port the sweep → classify → decision-object pipeline into the orchestrator,
re-keyed by `conversationId` → project ID. Classification covers **all four types** (onboarding,
support, investigation, warranty-request). Generalize the cadence engine to per-type tracks. Build
the **action queue UI** — proposed actions land here for approve / edit / reject. **This replaces
the Outlook drafts folder.** Drafts-first for everything at this stage.
**Cutover:** the existing `ez-wins-email-assistant` is **retired fully** once the orchestrator owns
the sweep — no parallel running (avoids double tasks/drafts).
**Done when:** a new inbox thread is classified into a type, attached to (or mints) a project, and
a drafted action sits in the orchestrator outbox for one-tap approval; the old assistant is off.

### Phase 2 — Onboarding detection → pipeline creation
**Extend.** On a detected onboarding: create the portal pipeline dealer (with `dms` + `conduit`),
attach the MOC rep and contacts from the email, mint/attach the project ID, create the ClickUp task
on `901113435718` (Feed Approval Pending) stamped with the ID. Reconcile the onboarding form so
form-originated onboardings receive the same project ID. The attached MOC rep drives the region
connections and the later "it's ready" notice.
**Blueprint — absorb the existing onboarding skill** (`docs/reference/onboarding-skill/`): it already
encodes the full task-creation logic for all sources (Fortellis CSV, **Reynolds RCI-1 PDF**,
DealerVault paste, Tekion paste, Tekion APC browser scrape) — the exact **dev-team description format**
(Dealership/Brand/Owner/Address, API Platform, Door Rate `$225`, DMS, per-platform IDs like
`Reynolds PPSYSID` + `Reynolds Store Code` / `Fortellis Subscription ID` / `Tekion Dealer ID` /
`DealerVault ID`, `Fluids Provider: MOC Products`), the `task_type: "Branch"` auto-subtask trigger on
list `901105435045`, the MOC Region custom field + option IDs, brand/group/region detection, `seen_orgs`/
`seen_groups` dedup memory, and the MOC-Users + EZ-Wins-group comments. The orchestrator replaces the
manual "drop a PDF/CSV into the skill" step: detect → extract (Claude reads the PDF/CSV/paste) →
human-review in the OUTBOX → create the Branch task. Note the **EZ Wins group naming rule** (omit a
trailing "Group"; the platform appends it).
**Done when:** an onboarding email/PDF produces a tracked project, a portal pipeline dealer, and a
linked ClickUp Branch task (structured description, MOC Region, MOC-Users comment) with zero manual entry.

### Phase 3 — Support automation (NET-NEW follow-up)
**New.** On a detected support request: draft the confirmation reply (as today), create the ClickUp
task on `901106848667`, and — new — open **two cadence tracks**: (a) **internal chase** that nudges
Blake/team until the task closes, and (b) **requester completion notice** that emails the requester
when the task is marked done. If the request is missing info needed to act, the requester track also
chases for that info first.
**Done when:** a support email creates a tracked SUP project + task, an internal nudge fires if it
stalls, and the requester is auto-notified on completion.

### Phase 4 — Roster extractor
**New + extend.** Build the extraction service above. Extend the setup form's submit fan-out to
**POST to the orchestrator** carrying typed roster JSON + the raw uploaded file + the project ID
(read from the ClickUp custom field; fall back to task ID / dealer name and reconcile). Wire the
missing-email → reach-back action and the missing-ID → internal-pull task.
**Done when:** the three real sample formats and a typed form submission all normalize to the same
roster on the project record, with the correct reach-back vs internal-pull vs ignore action.

### Phase 5 — Integration approval automation (per DMS) + Playwright worker + list move
**New.** Inbound approval detection per DMS. On approval, **move the ClickUp task `901113435718` →
`901105435045` (status Development)**. **Per-DMS trigger details + open artifacts: see
`docs/specs/dms-approval-flows.md`.** Prefer a partner API/webhook where one
exists over email parsing.
- **Fortellis (CONFIRMED):** detect the `noreply@fortellis.io` / `EZ Wins Activation Details` email →
  match the `Organization` field to the dealership → save the `Subscription ID` on the project.
  One activation per store (a group sends many). EZ Wins always Cc'd.
- **Tekion:** APC 2.0 gives partners a dashboard + **webhooks/API** + real-time onboarding
  notifications — **prefer the APC API/webhook** to pull approval + subscription ID (cleaner than the
  email). *Pending: confirm Blake's APC partner-account/API access, else a real approval email.*
- **DealerVault:** sends a **"Feed Request Notification" email**; vendor verifies approval in the
  **portal (feed shows "Active" in Store Summary)**; a **vendor API** also exists. Data entry stays
  manual; the **read** of the approved dealer ID is automated (portal scrape on saved session, or
  API), same expired-session prompt as Fortellis. Plus the +3-business-day chase to the FOD whose
  admin hasn't approved. *Pending: a real notification email + whether the API is available.*
- **Reynolds:** Blake signs the RCI docs (permanent manual step); the dealer admin approves in the
  `my.reyrey.com` Interface Dashboard (within 30 days). Likely identifiers: Customer/Package # (store)
  + `17310 RCI EZ Wins RO Pkg` (feed). *Pending: the confirmation artifact is UNVERIFIED — need a real
  Reynolds approval email/file (the "ZIP" was a guess).*
**Done when:** an approval signal for each DMS lands the ID on the project + dev task and moves the
task to the working list automatically, or a single login prompt when a session is dead.

### Phase 6 — Delivery: "it's ready" → launch date → welcome emails
**New.** ClickUp task completion (the `DATA ANALYSIS` / done trigger) fires an orchestrator action.
The orchestrator identifies the right MOC rep(s) from the project record, drafts the "it's ready"
message, and asks for a launch date if one wasn't captured. On the confirmed launch date it
**auto-sends the welcome-email batch** — the same generic password-reset link for everyone, so no
temp passwords ever leave the system and no per-user step is needed. Then it notifies MOC that
users were sent.
**Done when:** completing the ClickUp task drives the ready-notice, captures the launch date, and
fires welcome emails on that date with no manual action.

### Phase 7 — Warranty uplift: letter-deadline guard
**New.** `AI-Warranty-Analyst` is a separate React + DynamoDB tool with **no event/webhook and no
letter capability** (verified). So the orchestrator owns the workflow, the analyst stays a pure
analysis tool:
- **Detect completion by polling** the analyst's `/api/db` (`list-sessions` / `accuracy-global`,
  team/admin token) for a project where `uniqueIncludedROs >= 100` and/or it's marked complete.
  Match it to the orchestrator project via a shared `project_id` (small add to the analyst: carry
  the orchestrator ID on the session; until then, match by dealer name + reconcile).
- **Draft the letter in the orchestrator OUTBOX** (the analyst never gets letter/email code).
- **Human reviews and sends the letter — forever, by design** (same class as "Blake signs Reynolds
  docs"). No auto-send of warranty letters.
- **Cadence guard:** if the letter hasn't gone out in the thread within a few business days of the
  100 signal, fire a reminder.
**Done when:** a warranty project crossing 100 ROs drops a drafted letter into the outbox for human
review, and a reminder fires if the letter isn't sent within the deadline.

### Phase 8 — RAG + trust-ramp
**New.** Capture every approve / edit / reject in the action queue as a training signal. Stand up the
RAG (designed to span onboarding, support, and warranty data types — proper vector store +
structured decision log, not a toy). Retrieve similar past situations to inform proposals ("this
happened before, here's what we did"). Graduate proven action types from drafts-first to
auto-send-with-monitoring, one kind at a time. **Warranty letters never graduate** (human-review by
design).
**Done when:** repeated identical situations propose the right action with rising confidence, and at
least one low-risk action type runs auto-send under monitoring.

---

## Cross-system wiring checklist (footguns to clear during build)

- **Four ClickUp lists, distinct stages — not duplicates.** `901113435718` (feed approval pending /
  pipeline), `901105435045` (approved working space), `901106848667` (support), `901111643961`
  (Planner/investigation). Wire each to its type; the orchestrator moves tasks between the first two
  on integration approval.
- **ClickUp `project_id` custom field** — create it, then hardcode/resolve its field UUID the same
  way the email assistant maps its other field UUIDs.
- **Portal dealer field add** — adding `project_id` (and any other column) must touch all four
  places: GET snake→camel map, POST camel→snake, the `INSERT … ON CONFLICT` upsert, and
  `neon-schema.sql`. Run `alter table … add column if not exists` in Neon **before** deploying or
  every dealer save 500s. (Portal write in early phases uses the full-collection replace — keep that
  test-only; production should write the column directly.)
- **Graph quirk** — `$filter` + `$orderby` together is rejected; filter server-side, sort client-side.
- **Resend domain** — onboarding form still sends from the `onboarding@resend.dev` sandbox; verify
  the domain before welcome emails go live.
- **Warranty analyst is DynamoDB + shared-password auth, not Neon** — integrate by polling its
  `/api/db`, not by sharing a database. Needs `EZ_AWS_*` creds or a team/admin token.

## Stays manual by design (not gaps)
- Blake signs Reynolds documents.
- Blake reviews and sends every warranty uplift letter (forever).
- DealerVault portal data entry.
- Periodic re-login for Fortellis / DealerVault when the saved session expires (one tap from the queue).
- Onboarding team clears flagged low-confidence roster rows and runs internal raw-data ID pulls.

## Build environment
Claude Code on the Mac terminal pushes to GitHub and Vercel auto-deploys. Claude Code owns deploys
end to end. Each phase ships on its own. **The orchestrator is its own git repo** (`git init`'d
2026-06-22) — commit work to a `preview` branch.
