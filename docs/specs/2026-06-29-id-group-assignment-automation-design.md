# ID & Group Assignment Automation — Design

**Date:** 2026-06-29
**Status:** Design approved by Blake (sections 1–4 + refinements). Next: writing-plans.
**Builds on:** the group → dealership → project entity model
(`docs/specs/group-dealership-entity-model.md`) and the DMS approval flows
(`docs/specs/dms-approval-flows.md`).

How a dealer gets its **Dealer ID** and (the hard part) its **Group ID** through the
orchestrator's automation — so the "Phil Long problem" (a dealer that doesn't carry the group
name not landing in its group) never happens again.

---

## 1. The orchestrator is the source of truth (inversion)

Today the portal *originates* dealers/groups; the orchestrator imports them. We flip it:

- **The orchestrator mints and owns the Dealer ID (`DLR-`) and Group ID (`GRP-`)** — born in its
  automation, never derived from the portal.
- **The portal and ClickUp are downstream projections.** When the orchestrator establishes a
  dealer/group, it **pushes** — creates/links the portal dealer + portal group + the ClickUp task,
  stamping the IDs. Grouping is decided once, at the source, and propagated.
- The one-time bulk import was the **migration** (portal → orchestrator, done). New dealers/groups
  now originate in the orchestrator. No more "the portal grouped it differently" drift.
- **Ships in two steps, same logic:** an operational version driven in the orchestrator UI now
  (create the group deal, confirm store assignments), and the auto-detection layer once the
  **comms arm (Phase 1)** can read the intro + activation emails.

---

## 2. Establishing a group deal

- **The group is born from the MOC intro email** ("this is the FOD for the Phil Long group, let's
  bring them on"). The orchestrator creates a `dealer_group` (name = "Phil Long Group"), **mints the
  `GRP-`**, marks it an **open deal** (`status: open` — still receiving stores), and records the
  intro thread + its contacts (names, emails, **domains** like `@phillong.com`).
- **Scenario 1 — stores listed in the email:** each listed store is registered as an **expected**
  dealership under the group (status `prospect`, no feed yet) — the roster/guideline.
- **Scenario 2 — "just bring the group on" (no list):** the group is open with no roster; stores get
  added as activations are matched in (§3).
- **Open deals stay open** until Blake marks them complete (or auto-close after N idle days) —
  because MOC may onboard only **part** of a group, there is no "all stores arrived" auto-signal.
- **Multiple open group deals coexist;** the §3 matcher scores a new activation against all of them.
- Optionally capture the **group's locations page** (their website) as reference for matching + the
  confirmation view.

---

## 3. The store-assignment matcher

When a DMS activation arrives (Organization name, activator email + domain, location, feed/
subscription id), it runs a ladder. **Matching is context-first, not heavy fuzzy NLP** — at
~30–70 stores/month across a few open deals, the candidate set is tiny and constrained by *which
deals are open, in what regions, landing when*, so most matches are unambiguous given context.

1. **Known dealership?** Match by feed id / portal dealer / name → it's that dealer (re-activation/
   update). Done.
2. **Expected (rostered) store?** Find the closest candidate among the open deal's roster. **Names
   never match exactly** ("Modesto Toyota" ↔ "Toyota of Modesto"; "Concord Chrysler Dodge Jeep Ram"
   ↔ "Concord CDJR"), so this is a *closest-candidate* match → **propose for Blake's confirm**
   (light one-tap when context makes it obvious).
3. **Discovered store?** The **AI matcher** scores it against all open group deals using:
   - live email context (mid-thread with the group's contacts who said "approved/today"),
   - geographic + temporal clustering (stores from one region landing together),
   - the group's **locations page** (does this store match a published location?),
   - activator domain vs the deal's contacts.
   → a **confidence-scored proposal with its reasoning** → **OUTBOX** → Blake confirms/edits/rejects
   → **logged to the decision brain** (§5) → learns; high-confidence cases graduate toward
   auto-assign under monitoring (trust-ramp).
4. **Unexpected store** (no close candidate): OUTBOX — "this activated and we didn't expect it;
   assign to a group / new deal / what do you want?" **One activation can resolve to *multiple*
   stores** — a generic feed ("The Buick Company" → 3 stores) may itself be the missing roster
   stores. So the handler allows **one feed → many stores**.

**Reconciliation (both directions):**
- **Extras** → step 4.
- **Shortfall** → when a deal listed N stores but fewer arrived ("expected 12, accounted 7"), the
  orchestrator surfaces the gap: *"these 5 look missing: [list] — still pending, or bundled in a
  feed?"* so someone can chase. Multi-store/generic feeds (§4) feed this resolution.

Every assignment is a **proposal Blake confirms** (drafts-first); the AI raises confidence and only
truly ambiguous/unexpected cases need real deliberation.

---

## 4. Push-out (orchestrator → portal & ClickUp)

On a confirmed assignment, the orchestrator writes outward:

- **Mint** the `DLR-` (new store); the `GRP-` already exists (born at the intro). Create the
  `dealership` (status `onboarding`; group + dms/conduit from the feed) and the onboarding `project`.
- **Save the feed identity** on the project for future dedup/matching:
  - **Fortellis:** `Subscription ID`.
  - **Reynolds:** the dealer identifier = **PPSYSID + Store# + Branch#** concatenated, store first
    (e.g. PPSYSID `713042043142954` + store `02` + branch `01` = `7130420431429540201`). This is the
    ID shipped to ClickUp to identify the dealership (corrects the onboarding skill, which had
    PPSYSID and store-code as two separate fields).
  - **Tekion:** Dealer ID from the dashboard scrape. **DealerVault:** the `DVD` id from the portal.
- **Push to portal:** create-or-link the portal dealer (built) stamped with the Dealer ID, **and
  ensure the portal *group* exists + the dealer is assigned to it** — a group create-or-link
  mirroring the dealer one (the new piece).
- **Push to ClickUp:** the absorbed onboarding-skill logic creates the **Branch task** (structured
  dev description) on the working list, stamped with **Dealer ID + project id**.
- Portal and ClickUp are **projections of orchestrator truth** — no re-sync drift.

---

## 5. The decision brain (substrate the matcher writes to)

- **One** decision/knowledge store, **anchored on the Dealer ID**, with **`type` as a first-class
  metadata facet** (onboarding / support / investigation / warranty_uplift) — NOT four separate KBs.
- **Retrieval is type-scoped by default** — working a support task pulls support precedents (no
  onboarding noise; fast, focused, no mixed messages); the AI reads across arms only when it needs
  the bigger picture. Per-arm improvement is measured by slicing on `type`.
- Every confirm/edit/reject on a proposal is logged (the action-queue decision log) → the brain
  learns; the dealership accumulates "what happened" across all arms forever.
- **Warranty is a deliberate exception:** the AI-Warranty-Analyst already owns the *legal/RO-line
  classification* learning (a different level of thinking). The orchestrator brain models warranty
  as a **process step** — tracks the WUP engagement + letter decisions and *references* the
  analyst's classification brain rather than duplicating it.

---

## How this fixes the Phil Long problem

Daniels-Long Chevrolet (no "Phil Long" in its name) lands in the Phil Long group because grouping is
**structural and source-decided**, never name-based:
- **Scenario 1:** it was listed in the intro → registered as an expected store → its activation
  fuzzy-matches the roster → confirmed.
- **Scenario 2:** its activation is scored by the AI against the open Phil Long deal (region + timing
  + locations page + your live thread) → proposed → you confirm.
Either way the group is assigned once, in the orchestrator, and pushed to the portal/ClickUp.

## Phasing / dependencies

- **Operational (sooner):** orchestrator UI to create a group deal (open), register a roster,
  and confirm store→group assignments + reconciliation; push-out already partly built.
- **Automatic (needs Phase 1 comms arm):** auto-detect the intro email (→ open group deal) and DMS
  activations (→ matcher proposals in the OUTBOX).
- The **decision brain / trust-ramp** is the later RAG phase; the decision log starts capturing now.

## Out of scope (YAGNI now)

- Auto-assign without human confirm (graduates later via the trust-ramp).
- Scraping every group's locations page automatically (start with on-demand / Blake-provided).
- Replicating warranty's RO-line classification into the orchestrator brain.
