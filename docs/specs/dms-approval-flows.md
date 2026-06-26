# DMS Integration-Approval Flows (Phase 5 reference)

**Date:** 2026-06-24
**Purpose:** Per-DMS profile of how EZ Wins gets a dealer's data feed approved/activated, what the
approval confirmation looks like, and what identifies the store + feed. Feeds the Phase 5
integration-approval matcher. The entity model (group/dealership/project) is DMS-agnostic; only the
approval-detection differs per conduit.

**Status:** Fortellis = confirmed from a real email. Reynolds/Tekion/DealerVault = flows mapped from
the repos + web research; the **approval-confirmation artifact still needs a real sample from Blake**
for each. (Agents' web tools were blocked; the web findings below were gathered separately.)

`dms` = underlying system; `conduit` = how it integrates (`direct | fortellis | dealervault | tekion
| reynolds_rci`). Two classes: **direct** (CDK→Fortellis, Reynolds→RCI, Tekion→APC) and
**conduit-fronted** (DealerTrack/AutoMate/PBS/Other → DealerVault).

---

## Fortellis (CDK) — CONFIRMED ✅

- **Outbound:** dealer self-activates EZ Wins in the CDK/Fortellis Marketplace.
- **Confirmation:** email `From: noreply@fortellis.io`, `Subject: EZ Wins Activation Details`. EZ Wins
  always Cc'd (`blake@`, `info@ez-wins.com`).
- **Store identifier:** body `Organization` field (e.g. `PHIL LONG HYUNDAI OF CHAPEL HILLS`).
- **Feed identifier:** body `Subscription ID` (UUID, e.g. `7b6d5dfd-28bd-456c-9991-039eaf5a93d6`) →
  `project.substate.fortellis_subscription_id`.
- **Automation:** detect → match Organization to dealership → save Subscription ID → move ClickUp
  task `5718 → 5045/Development`. No-match → OUTBOX.
- Source: `EZ Wins Activation Details.eml` (in repo, gitignored).

---

## Reynolds & Reynolds — CONFIRMED from real emails ✅ (2 minor gaps)

- **Conduit:** `reynolds_rci`. RCI = Reynolds Certified Interface. **The whole chain is structured
  emails from `RCI_Deployment@reyrey.com` — NOT a ZIP** (the earlier "approval ZIP" assumption was
  wrong). Verified from 4 real `.eml` samples (gitignored, in `~/Projects`).
- **The email chain:**
  1. **Order (outbound):** `blake@ez-wins.com` → `rci_deployment@reyrey.com`, subject
     `New Order 17310 – RCI EZ Wins RO Pkg` (dealer details + item 17310).
  2. **Auto-ack:** Reynolds → you, subject `RCI Deployment E-Mail Confirmation` (autoresponder;
     "installation confirmation checklist within 10 business days"). Low value.
  3. **Docs ready to sign:** Reynolds → you, subject
     `{order#}_RCI REYSIGN EZ Wins RO Pkg_{customer#}_{Dealer}` (no suffix) **with an attachment**
     (the RCI-1; REYSIGN = Reynolds e-signature). → OUTBOX "sign the docs" action (Blake signs —
     permanent manual step).
  4. **COMPLETED:** Reynolds → you, subject `…_{Dealer} - COMPLETED`, body
     *"Part 17310 - preload file was sent on {date}"*. → **feed received; advance the project.**
- **Detection signature:** `From: RCI_Deployment@reyrey.com` + subject matching
  `*_RCI REYSIGN EZ Wins RO Pkg_*`; ` - COMPLETED` suffix = done, attachment-present/no-suffix =
  needs signing.
- **Identifiers (parsed from the subject):** **order #** (e.g. `101261760`), **Reynolds Customer #**
  (e.g. `7501973` = stable per-store key), **Dealership name** (e.g. `Vegas Auto Gallery Lotus Las
  Vegas`), item **17310** (feed/package). Body of #4 gives the **preload/historical-file date**.
  Store on the project: `substate.reynolds_customer_no`, `reynolds_order_no`, `reynolds_item=17310`,
  `preload_file_date`.
- **The docs-ready (#3) attachment is the onboarding goldmine — VERIFIED.** Pulled the PDF off the
  real `.eml` via Python's `email` module (Graph exposes the same via `/messages/{id}/attachments`,
  base64 — the email assistant already does this). The **RCI-1 Order Form** PDF contains, fully
  extractable by Claude: store DBA name (`Team Toyota`), legal name, **Reynolds Customer #**
  (`7636220`), full address, item (`17310`), **PPSYSID/Store/Branch** (`713042043142954`/`02`/`01`),
  EULA-signed date, End User Signatory, EZ Wins vendor # (`7510719`, constant). This is everything
  needed to create the dealership + ClickUp task. **Blake currently feeds this PDF to a Claude skill
  manually — automate it: detect #3 → pull PDF → extract → create/enrich dealership + task → OUTBOX
  "sign the RCI-1".**
- **Per-store keys:** Reynolds **Customer #** + **PPSYSID/Store/Branch** (exact; also the identifiers
  the termination flow requires — offboarding is pre-wired).
- **Automation:** detect #3 → pull+extract RCI-1 PDF → create/enrich dealership+task + OUTBOX sign.
  Detect #4 (`- COMPLETED`) → save IDs + preload date → move ClickUp task to Companies
  Inbound/Development. Signing stays manual.
- **Resolved:** the `- COMPLETED` email **is** the dealer-approved signal (dealer approves → data
  delivered same day → that email carries the delivery date). The auto-ack's "installation
  confirmation checklist" is boilerplate, not a distinct artifact.
### Reynolds offboarding / change rounds — CONFIRMED from real emails ✅

All from `RCI_Deployment@reyrey.com`, keyed on **Customer #** / **PPSYSID** (captured at onboarding
from the RCI-1 PDF → every event auto-matches the dealership).

- **Decline (dealer rejected the order):** subject `{order#}_RCI REYSIGN EZ Wins RO Pkg_{customer#}_
  {Dealer} - CANCELLED`; body: *"This order has been cancelled by {Dealer}. Decline Reason Given:
  {reason}. Product: 17310 …"* (e.g. reason "Gord is unaware of this request"). → reopen/flag the
  project; OUTBOX **"follow up — order declined: {reason}"** (re-educate the dealer + resubmit).
- **Termination (EZ Wins-initiated churn):** Blake emails `RCI_Deployment` "Termination Request -
  {dealers}" listing each store's **PPSYS/Store/Branch** number (e.g. Seattle Jeep
  `5567913535144260201`) + "cancel by end of month." A human RCI Coordinator replies confirming
  **Billing Termination Date + Data Termination Date** (+ a screenshot). → OUTBOX draft the
  termination email (pre-filled from stored PPSYSID/Store/Branch); on the confirm reply, record the
  dates and mark the dealership inactive/churned.
- **Buy/Sell (auto-termination + re-enroll lead):** subject `BUY/SELL - {oldCustomer#}, {Dealer}`;
  body: *"A billing and data termination has been submitted for {Dealer} (Customer # {old}, PPSYS
  {old}, Store/Branch)… If you would like to enroll the buying dealership (Customer # {new}, PPSYS
  {new}…), submit an enrollment request with an updated EULA date."* → mark old dealership churned
  (auto-terminated by Reynolds); OUTBOX **"buyer {newCustomer#} available — re-enroll?"** → if yes,
  submit a new 17310 order for the new Customer #. (A churn AND a fresh onboarding lead in one.)

**Detection (all rounds):** `From: RCI_Deployment@reyrey.com`; route by subject — `- COMPLETED` /
`- CANCELLED` suffix, `BUY/SELL -` prefix, or a "Termination Request" reply thread. Match by
Customer #/PPSYSID. Secondary/minor rounds not yet sampled: package conversion, Reynolds billing
invoices, re-certification/audit.

---

## Tekion — CONFIRMED: email trigger + browser scrape (no API) ✅

- **Conduit:** `tekion` (direct partner). **No partner API available to EZ Wins — browser scrape only.**
- **Outbound (known, exact text in repo):** EZ Wins emails the dealer/IT contact the **Integration
  Hub** steps: App Grid → Apps → APC → Integration Hub → search "EZ Wins" → **Request Connection** →
  accept Data Permissions & T&C. The **dealer** initiates. (`MOC-Onboarding-Form/.../route.ts:277-288`.)
- **Trigger email (CONFIRMED from real `.eml`):** `From: noreply-apc@tekioncloud.com`, subject
  `New Connection Request from {Dealer} for EZ Wins`. Body fields: **Dealer Name** (`Toyota
  Sunnyvale`), **Dealer Address**, Integration Requested (`EZ Wins`), Submission Date. "Next Steps:
  this request has been logged in the dealer dashboard and is awaiting your action."
- **CONFIRMED behavior (Blake):** when this email arrives the **connection is already live** — no
  approval click by EZ Wins; it just signals "go use it." The email carries Dealer Name + Address but
  **NOT the Tekion Dealer ID** (`companyname_1234_0`); the ID lives only in the APC dashboard, and the
  **devs** fetch it from the Tekion app themselves (if they even need it) and mark it onboarded.
- **Automation:** detect the email → match/create the dealership by name+address → **create the
  ClickUp Branch task from the email** (name+address is enough) → **send to Dev**. The orchestrator
  does NOT need to scrape the Dealer ID for this path (devs handle the Tekion-app side). The browser
  scrape (onboarding skill's Path E on the saved session) remains the **proactive** way to pull
  dealers from the APC dashboard when there's no email; optional Dealer-ID enrichment.
- **Withdrawal email (CONFIRMED, real `.eml`):** `From: noreply-apc@tekioncloud.com`, subject
  `{Dealer} has withdrawn connection request for EZ Wins`, body "No further action is required."
  → **do nothing** (if a task/project was already created for that dealer, close it as withdrawn).
  Covers the "accidental access then immediate cancel" case.
- **Two Tekion emails total**, both `noreply-apc@tekioncloud.com`: New Connection Request (onboard) /
  Withdrawn (ignore). No subscription-ID-in-email; no API; no approval step.
- Repo bug: `tekion-approval-guide.pdf` referenced but missing in MOC-Onboarding-Form.

---

## DealerVault (Authenticom) — CONFIRMED from real emails ✅

- **Conduit:** `dealervault`. Fronts DealerTrack, AutoMate, PBS, Dealerbuilt, "Other". Underlying
  `dms` tracked separately. DVD-prefixed ID (e.g. `DVD39749`) is the per-feed key.
- **Outbound (manual, stays manual):** EZ Wins submits the feed request in the DealerVault portal
  (no bot). Blake submits it **before** replying to the MOC intro so he gets the dealer's approver
  contacts (see below). **Three emails follow, all from Authenticom:**
- **1. Feed Approval Request Confirmation** (`notify@authenticom.com` → Blake): "a notification has
  been sent to {Dealer} requesting they approve Service/Sales data to Ez-Wins" + **a table of the
  dealer's approver contacts (Name / Email / Phone)** — the "admins on file." → **automation
  opportunity (Blake's idea):** extract the contacts and auto-draft a reply on the onboarding thread
  that **loops those approvers in** so they know what to approve (drafts-first).
- **2. Client Action Needed – {Dealer} Unresponsive** (`alerts@authenticom.com` → Blake): dealer
  hasn't approved; "reach out to this dealer." **Re-lists the approver contacts.** → this email IS
  the chase trigger (DealerVault tells you when to intervene — no blind +3-day timer); OUTBOX "chase
  {dealer} — DV approval pending" with the contacts.
- **3. Feed Activated - {Dealer}** (`notify@authenticom.com` → e.g. gary@, Cc blake@ + the dev):
  feed approved/active; body has **Store Details: Group Name, Store Name, Location (full address)**.
  → feed-approved signal: **browser-scrape the DV portal for the `DVD` ID + underlying DMS** (saved
  session; Path C of the onboarding skill), create/advance the ClickUp Branch task (name+address from
  the email), **send to Dev**. The DVD ID is **NOT in any email** — scrape only (confirmed by Blake).
- **Senders:** `notify@authenticom.com` (confirmation + activated), `alerts@authenticom.com` (action
  needed). Subjects carry the dealer name.
- **No EZ-Wins vendor API** in practice — email triggers + saved-session portal scrape.

---

## Status of the 4 DMS deep-dives

| DMS | Status | Trigger / mechanism |
|---|---|---|
| **Fortellis** | ✅ confirmed | activation email (`Organization` + `Subscription ID`) |
| **Reynolds** | ✅ confirmed | `RCI_Deployment@reyrey.com` structured subjects + RCI-1 PDF; full on/offboarding |
| **Tekion** | ✅ confirmed | `noreply-apc@tekioncloud.com` connection-request email (live; create task → Dev) / withdrawal = ignore; Dealer ID from dashboard scrape |
| **DealerVault** | ✅ confirmed | Authenticom 3-email flow (request-confirmation w/ approver contacts → unresponsive-alert → Feed Activated); DVD ID from portal scrape |

**All 4 DMS deep-dives complete.** Cross-cutting pattern: a feed-approved/activated email (or a live
connection) → create/advance the ClickUp **Branch** task → **send to Dev**; the platform ID comes
from the email (Fortellis/Reynolds) or a saved-session portal scrape (Tekion/DealerVault). Chase
triggers are vendor-sent where available (DealerVault "Client Action Needed") else cadence-timed.

## Design implication

Each DMS converges on the same Phase-5 outcome: **match to the dealership → save the platform ID on
the project → create/advance the ClickUp Branch task → send to Dev**; no-match or expired-session
routes to the OUTBOX. Mechanisms differ: email-carries-ID (Fortellis, Reynolds), email-triggers-scrape
(Tekion — ID from dashboard), email+portal-read (DealerVault). No EZ-Wins-facing partner API exists for
any of them (Tekion APC has one but EZ Wins isn't granted it) — so it's email + saved-session browser
automation throughout.

## Sources (web, 2026-06)
- Tekion APC: https://tekion.com/products/apc · https://apc.tekioncloud.com/user/home · https://tekion.com/blog/a-new-era-of-dealer-controlled-tech-automotive-partner-cloud-2-grows-40x-since-launch
- Reynolds RCI: https://www.reyrey.com/partners/reynolds-certified-interface
- DealerVault: https://www.authenticom.com/product/dealer-vault/for-vendors · DealerVault vendor API (Authenticom announcement)
