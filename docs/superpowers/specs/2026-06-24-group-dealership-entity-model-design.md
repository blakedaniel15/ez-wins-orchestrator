# Group / Dealership / Project Entity Model + Fortellis Activation Flow

**Date:** 2026-06-24
**Status:** Design approved by Blake (sections 1–4 + OEM decision). Pending: spec review, then writing-plans.
**Supersedes:** the flat `project` table from Phase 0 (which carried dealer fields directly).

---

## 1. The big idea

The dealership is the center of gravity for the whole business — onboarding, support, warranty,
and how EZ Wins communicates all revolve around it. So the data model is three persistent tiers
plus time-bound engagements hung off them:

```
DEALER_GROUP        persistent. The dealer group. Knowledge rolls up here.
  └─ DEALERSHIP     persistent, FIRST-CLASS. One per real store (rooftop), keyed 1:1 to its
       │            portal dealer. Accumulates "what happened" forever — the memory the RAG reads.
       ├─ PROJECT   ONB-2026-0142  (onboarding — ends)
       ├─ PROJECT   SUP-2026-0310  (support — ends)
       └─ PROJECT   WUP-2026-0044  (warranty uplift — ends)
```

**Projects end; dealerships and groups never do.** Every engagement is its own time-bound project
with its own ID, permanently hung off a persistent dealership, which optionally rolls up to a
group. Over time the dealership becomes the accumulated memory of everything that happened with
that store. This is the substrate the future RAG/knowledge layer sits on — anchored to the
dealership, not scattered across dead projects.

A dealer group arriving as one email thread with N stores (real case 2026-06-24: 13 dealers via
Fortellis, one thread) becomes: **1 `dealer_group` → 13 `dealership` rows → 13 `ONB-2026-xxxx`
projects**, all sharing the group's thread.

---

## 2. Entity model (schema)

```sql
-- dealer_group — persistent. ("group" is a reserved SQL word.)
create table dealer_group (
  id text primary key,                 -- GRP-000007 (stable, no year)
  name text not null,
  billing_email text,
  portal_group_id text,                -- 1:1 -> portal groups.id
  outlook_conversation_id text,        -- the shared deal thread (for group deals)
  substate jsonb not null default '{}'::jsonb,   -- accumulated group-level knowledge
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- dealership — persistent, FIRST-CLASS. The guiding light.
create table dealership (
  id text primary key,                 -- DLR-000142 (stable, no year)
  group_id text references dealer_group(id),     -- nullable (single-store deals have no group)
  name text not null,
  dms text,                            -- per-store (handles the 1% mixed-DMS group)
  conduit text,                        -- direct | fortellis | dealervault | tekion | reynolds_rci
  oems jsonb not null default '[]'::jsonb,        -- OEM brands, e.g. ["Hyundai"] or ["VW","Mercedes","Kia"]
  portal_dealer_id text,               -- 1:1 -> portal dealers.id
  status text not null default 'prospect',        -- prospect | onboarding | live | inactive
  substate jsonb not null default '{}'::jsonb,    -- accumulated "what happened" — the memory
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- project — time-bound engagement, ALWAYS tied to a dealership. Ends.
create table project (
  id text primary key,                 -- ONB-2026-0001 (year = when the engagement happened)
  type text not null,                  -- onboarding | support | warranty_uplift | investigation
  dealership_id text references dealership(id),   -- the spine: always connected
  status text not null default 'new',
  substate jsonb not null default '{}'::jsonb,
  outlook_conversation_id text,        -- this engagement's thread (= group thread for group onboarding)
  clickup_task_id text,                -- 1 task per project
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz                 -- set when the engagement closes
);

create index if not exists idx_dealership_group   on dealership(group_id);
create index if not exists idx_dealership_portal   on dealership(portal_dealer_id);
create index if not exists idx_dealership_name     on dealership(lower(name));
create index if not exists idx_project_dealership  on project(dealership_id);
create index if not exists idx_project_type        on project(type);
create index if not exists idx_project_conv        on project(outlook_conversation_id);
create index if not exists idx_group_conv          on dealer_group(outlook_conversation_id);
```

Relationships: **`dealer_group` 1—N `dealership` 1—N `project`.** A project hangs off exactly one
dealership; a dealership optionally hangs off one group.

**OEM brand** is a simple `oems` array on the dealership (decided — not in the ID, not its own
entity yet). IDs stay opaque; a rooftop can carry multiple brands (e.g. Steve Hahn VW/Mercedes/Kia).
Can graduate to a first-class `oem` entity later if warranty needs OEM-level knowledge.

---

## 3. ID schemes & minting

- **Persistent entities carry no year** (they never end): `GRP-000007`, `DLR-000142`.
- **Projects keep the year** (engagements are time-bound): `ONB-2026-0001`, `SUP-2026-0310`, etc.
- Minting stays atomic via the existing `project_counter` table, keyed: `DLR`, `GRP`, and
  `ONB-2026` / `SUP-2026` / `WUP-2026` / `INV-2026`. Same single-statement upsert-increment as today.

---

## 4. Mappings to portal / ClickUp / Outlook

- **Dealership ↔ portal dealer (1:1)** via `portal_dealer_id`. The portal stays the source of truth
  for billing/pipeline/status; the orchestrator dealership holds the memory + links. On confirming a
  store, the orchestrator ensures a portal dealer exists (create or link) and stamps the project ID.
- **Group ↔ portal group (1:1)** via `portal_group_id` (the portal `groups` table). Stores get
  `group_id` on their portal dealer rows.
- **Project ↔ ClickUp task (1:1)** via `clickup_task_id`. On feed approval, the orchestrator moves
  the task **Feed Approval Pending (901113435718) → Companies Inbound (901105435045), status =
  Development** — per store, independently.
- **Outlook thread → the entity that owns it.** A group deal thread is tagged `EZW-GRP-000007` and
  stored on the group; a single-store/support thread is tagged with that project's ID. Reverse
  lookup resolves the chain: conversationId → group (or project) → dealerships → projects.

---

## 5. Onboarding lifecycle

Two entry modes converge on the same per-store flow:

- **Known-upfront (~60%):** group thread arrives with a store list in the body. The comms arm
  (Phase 1) AI-extracts it → proposes in the OUTBOX: create the group + N dealerships (status
  `prospect`) + N onboarding projects (status `awaiting_feed`) → **Blake approves** → created,
  one ClickUp task per store on Feed Approval Pending.
- **Discovered (~40% / this Fortellis case):** thread arrives without a full list. Group is created;
  stores get added as their activations arrive.

**Per-store approval (both modes):** a Fortellis activation email → matched to a dealership → its
project flips to `feed_approved`, the Subscription ID is saved, the ClickUp task moves to Companies
Inbound/Development, cadence advances. Each store then proceeds independently (dev → data analysis →
go-live → welcome emails — later phases). The group is "done" when all its stores are live.

---

## 6. Fortellis activation flow (confirmed from a real email)

Sample: `EZ Wins Activation Details.eml` (Phil Long Hyundai of Chapel Hills, 2026-06-23).

- **Detect:** `From: noreply@fortellis.io` + `Subject: EZ Wins Activation Details`. Reliable.
  - Note: the current email assistant tags these `EZ-Noise` and ignores them. The orchestrator's
    sweep must claim Fortellis activations instead.
- **Which store:** the body **`Organization`** field (e.g. `PHIL LONG HYUNDAI OF CHAPEL HILLS`) →
  match to a dealership by name (within the group). The org name also encodes group · OEM · location
  (`PHIL LONG` · `HYUNDAI` · `OF CHAPEL HILLS`), useful for extraction.
- **The feed ID:** the body **`Subscription ID`** (e.g. `7b6d5dfd-28bd-456c-9991-039eaf5a93d6`) →
  saved on the onboarding project (`substate.fortellis_subscription_id`). This is "the ID" we pull.
- **Bonus signals:** EZ Wins is always **Cc'd** (`blake@` + `info@ez-wins.com`); the activator is in
  the body (`Craig Schutz`) and `To:` (`cschutz@phillong.com` — the domain hints the group).

---

## 7. No-match handling

If an activation can't be matched to a known dealership, **never silently auto-create.** Drop an
OUTBOX action for Blake to resolve ("Fortellis activation for `<Organization>` — couldn't match a
known store; link it to a dealership / create one?"). This covers the "discovered" case too — an
unlisted store's activation surfaces for one-tap confirmation rather than auto-materializing.

---

## 8. Migration from Phase 0

Cheap — only test data exists (`ONB-2026-0001`, Steve Hahn).
- Add `dealer_group` and `dealership` tables; add `DLR`/`GRP` minting.
- Add `dealership_id` to `project`; move per-dealer fields (`dealer_name`, `dms`, `conduit`,
  `portal_dealer_id`) off `project` onto `dealership`.
- Migrate the test row: create `DLR-000001` (Steve Hahn, linked to portal dealer
  `d_1780607333618_egnvk`, oems `["Volkswagen","Mercedes","Kia"]`) + its group, point
  `ONB-2026-0001.dealership_id` at it. (Or re-seed — it's a test record.)
- Internal page gains group/dealership views alongside the project view.

---

## 9. Build-order impact

The only *new* phase is **0.5**; everything else stays, re-expressed in group/dealership/project terms.

- **Phase 0.5 — Entity model (next):** the migration above + minting + page views.
- **Phase 1 — Comms arm:** classify *and* resolve to a dealership (create group/dealership/project
  via the OUTBOX). Retire the email assistant at cutover.
- **Phase 2 — Onboarding detection:** create group + N dealerships + N onboarding projects
  (known-upfront via AI-extract, or discovered).
- **Phase 5 — Integration approval:** per-DMS matching. Fortellis is fully specced here; **Reynolds,
  Tekion, DealerVault each need their own real-world deep-dive** (exact emails/files + identifiers)
  against this same entity model.

---

## 10. Open items / pending

- **Per-DMS deep-dives** (Reynolds, Tekion, DealerVault): gather real emails + exact flows before
  building their Phase 5 matchers. Fortellis is done. *(Blake's explicit request: pause and map each.)*
- The store-name → dealership match is fuzzy (org-name vs portal/dealership name); the OUTBOX
  no-match path is the safety net until matching confidence is proven.

## 11. Out of scope (YAGNI for now)

- A first-class `oem` entity (start with the `oems` array).
- Auto-creating dealerships/projects without human confirmation (everything routes through the OUTBOX
  first; auto-send graduates later via the trust-ramp).
- Group-level billing logic (the portal already owns billing per dealer + group billing_email).
