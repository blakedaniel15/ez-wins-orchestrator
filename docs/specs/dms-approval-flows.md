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
- **Crucial:** the email is a **trigger, NOT a data source** — it carries Dealer Name + Address but
  **NOT the Tekion Dealer ID** (`companyname_1234_0`). That ID lives only in the APC dashboard.
- **Automation = email-triggered browser scrape** (the onboarding skill's Path E, on the saved Tekion
  session): email fires → match/create the dealership by name+address → drive `apc.tekioncloud.com`
  dealer-dashboard (filter "Pending Onboarding") → scrape the **Tekion Dealer ID** + full address →
  create the ClickUp Branch task. Session expired → one-tap "log in" prompt (same as Fortellis/
  DealerVault). Store `substate.tekion_dealer_id`.
- **Open (confirming with Blake):** (1) is there a *second* "integration established/active" email
  after Blake acts, or is this Connection-Request email the only one? (2) On this email, does Blake
  **approve/accept** in the dashboard, or just scrape the pending entry (no approval click)?
  (3) confirmed the Dealer ID only comes from the dashboard, never the email.
- Repo bug: `tekion-approval-guide.pdf` referenced but missing in MOC-Onboarding-Form.

---

## DealerVault (Authenticom) — flow mapped; portal/API read

- **Conduit:** `dealervault`. Fronts DealerTrack, AutoMate, PBS, and "Other"/unknown DMS. The
  underlying `dms` is still tracked separately (the ID-need rule keys off the underlying DMS).
- **Outbound (known):** EZ Wins **manually submits** a data-integration request in the DealerVault
  vendor portal ("no bot in their portal" — stays manual). Then emails the dealer a heads-up that
  DealerVault will notify their **admin on file** to approve (Blake fills in the admin name/email
  after submitting). (`email_assistant_prompt.md:432-451, 631-653`.)
- **Confirmation (NEW — web 2026-06):** DealerVault **sends a "Feed Request Notification" email** to
  the admin; vendors **verify approval in the DealerVault portal** — feeds show **"Active" in the
  Store Summary**. DealerVault also has a **vendor API**. So "read the approved dealer ID" = portal
  Store Summary (or API), matching the plan.
- **Likely identifiers:** store = dealership name + a DealerVault store/account number; feed = the
  active Sales/Service feed per store.
- **Automation:** read the "Active" status + dealer ID from the portal (Playwright on the saved
  session, same expired-session prompt as Fortellis) or the vendor API; the **+3-business-day FOD
  chase** when the admin hasn't approved (generic cadence). Data entry stays manual.
- **NEEDED FROM BLAKE:** (1) forward a real DealerVault "Feed Request Notification" / approval email;
  (2) is there a DealerVault **vendor API** you have access to? (3) where do you read the approved
  dealer ID — the portal Store Summary, or the email?

---

## Consolidated: what to get from Blake

| DMS | Forward this | Plus answer |
|---|---|---|
| Reynolds | a real approval artifact (email from `@reyrey.com`? portal notice? ZIP file?) | what identifies store + feed; is EZ Wins notified or only the dealer admin? |
| Tekion | APC partner-account/API access **or** a real approval email | do you have `apc.tekioncloud.com` partner API creds? |
| DealerVault | a real "Feed Request Notification" / approval email | do you have a DealerVault vendor API? where do you read the approved dealer ID? |

## Design implication

Where a **partner API/webhook exists (Tekion APC, possibly DealerVault), prefer it over email
parsing** — it's more reliable and gives the IDs directly. Email parsing (Fortellis) and
portal-scrape-on-saved-session (DealerVault read, possibly Reynolds) are the fallbacks. All paths
converge on the same Phase 5 outcome: match to the dealership → save the feed ID on the project →
move the ClickUp task to Companies Inbound/Development → no-match routes to the OUTBOX.

## Sources (web, 2026-06)
- Tekion APC: https://tekion.com/products/apc · https://apc.tekioncloud.com/user/home · https://tekion.com/blog/a-new-era-of-dealer-controlled-tech-automotive-partner-cloud-2-grows-40x-since-launch
- Reynolds RCI: https://www.reyrey.com/partners/reynolds-certified-interface
- DealerVault: https://www.authenticom.com/product/dealer-vault/for-vendors · DealerVault vendor API (Authenticom announcement)
