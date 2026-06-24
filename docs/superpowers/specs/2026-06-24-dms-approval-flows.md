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

## Reynolds & Reynolds — flow mapped; confirmation = GAP

- **Conduit:** `reynolds_rci`. RCI = Reynolds Certified Interface (vendor must be RCI-certified;
  Reynolds audits/charges for access).
- **Outbound (known):** EZ Wins emails an RCI order to **`RCI_Deployment@reyrey.com`**, product
  **`17310 – RCI EZ Wins RO Pkg`**, with dealer name/address, End User Signatory, EULA date, and
  Blake as the RCI-1 signatory. (`MOC-Onboarding-Form/app/api/submit/route.ts:216-224`.)
- **Manual by design:** **Blake signs the RCI docs.** The dealer admin (with "Integration
  Authorization Role") approves the request in their **Reynolds Interface Dashboard** at
  `my.reyrey.com` (must be done within **30 days**). Feed provisions in ~2–3 business days.
- **Confirmation (UNVERIFIED):** the plan assumes an "approval ZIP"; no real sample confirms this.
  The official Reynolds Interface Dashboard guide (PDF in `MOC-Onboarding-Form/public/guides/`)
  shows the dealer-side identifiers: **Customer/Package #** (store rooftop number), **Interface/Part
  Description** (= the `17310 RCI EZ Wins RO Pkg` feed), EULA date, signatories; the Decision Log is
  Excel-downloadable.
- **Likely identifiers:** store = Reynolds Customer/Package #; feed = `17310` interface description.
- **Web (2026-06):** RCI confirmed as the certified-interface program; **no public partner
  webhook/API** for approval surfaced — so confirmation is likely email and/or the data simply
  starting to flow.
- **NEEDED FROM BLAKE:** a real Reynolds approval artifact — is it an email from `@reyrey.com`, a
  `my.reyrey.com` portal notification, or a downloaded file/ZIP? What identifies the store + feed?

---

## Tekion — flow mapped; likely API/webhook (better than email)

- **Conduit:** `tekion` (direct partner; no middleman).
- **Outbound (known, exact text in repo):** EZ Wins emails the dealer/IT contact the **Integration
  Hub** steps: App Grid → Apps → APC → Integration Hub → search "EZ Wins" → **Request Connection** →
  accept Data Permissions & T&C. The **dealer** initiates the connection request.
  (`MOC-Onboarding-Form/app/api/submit/route.ts:277-288`; `email_assistant_prompt.md:606-627`.)
- **Confirmation (NEW — web 2026-06):** Tekion **Automotive Partner Cloud (APC) 2.0** gives
  technology partners a **dashboard + real-time notifications when a dealer initiates onboarding**,
  and supports **APIs, FTP feeds, and webhooks**. So the approval + subscription ID are most likely
  available via the **partner dashboard/API/webhook** (`apc.tekioncloud.com`), NOT only an email.
  This reframes the plan's "pull the subscription-ID off the approval email" → **prefer the APC
  API/webhook**.
- **Likely identifiers:** store = Tekion dealer/tenant; feed = subscription/connection ID →
  `project.substate.tekion_subscription_id`.
- **Automation:** potentially the cleanest of all — a webhook/API poll on the APC partner account
  could detect approval + ID with no email parsing.
- **NEEDED FROM BLAKE:** (1) do you have an **APC partner account** at `apc.tekioncloud.com` with API
  credentials? (2) Failing that, forward a real Tekion approval email. Either nails the trigger.
- Repo bug: `tekion-approval-guide.pdf` is referenced but missing (guide silently never attaches).

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
