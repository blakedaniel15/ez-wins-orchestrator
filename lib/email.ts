import type { Dealership } from '@/lib/dealerships';
import type { Contact } from '@/lib/contacts';

// Lifecycle email builders. These produce the payload the OUTBOX dispatches via
// MS Graph sendMail on approval (drafts-first). Recipients come from the request
// contacts (§ recipients model); the setup-form link is per-dealership.

export interface EmailPayload {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
}

function setupFormUrl(dealership: Dealership): string {
  const base = (process.env.SETUP_FORM_URL || '').replace(/\/$/, '');
  if (!base) return '(setup form link — set SETUP_FORM_URL)';
  return dealership.portal_dealer_id ? `${base}?dealer=${encodeURIComponent(dealership.portal_dealer_id)}` : base;
}

function emails(contacts: Contact[]): string[] {
  return [...new Set(contacts.map((c) => (c.email || '').trim()).filter(Boolean))];
}

// Stage 2 — ask the MOC people for the data needed to finish onboarding + the form link.
export function buildStage2Email(dealership: Dealership, mocContacts: Contact[]): EmailPayload {
  const name = dealership.name;
  return {
    to: emails(mocContacts),
    subject: `Onboarding started — ${name}: we need the account setup info`,
    html:
      `<p>Hi team,</p>` +
      `<p>The integration for <b>${name}</b> is approved and onboarding has started. To finish setup, please send us the account info — the users to add (name, email, role) and parts details.</p>` +
      `<p>Fastest path is the setup form: <a href="${setupFormUrl(dealership)}">${setupFormUrl(dealership)}</a> — or just reply with the user list (or an attached spreadsheet).</p>` +
      `<p>Thanks!</p>`,
  };
}

// Stage 3 — go-live notice to the original request participants.
export function buildStage3Email(dealership: Dealership, contacts: Contact[]): EmailPayload {
  const name = dealership.name;
  return {
    to: emails(contacts),
    subject: `${name} is live on EZ Wins`,
    html:
      `<p>Good news —</p>` +
      `<p><b>${name}</b> is now live on EZ Wins. The account is set up and active.</p>` +
      `<p>Reach out any time with questions.</p>`,
  };
}

// Dealer notification — fired once parts & users are onboarded; to the users we added.
export function buildDealerEmail(dealership: Dealership, rosterEmails: string[]): EmailPayload {
  const name = dealership.name;
  return {
    to: [...new Set(rosterEmails.filter(Boolean))],
    subject: `Your EZ Wins access — ${name}`,
    html:
      `<p>Hello,</p>` +
      `<p>Your team at <b>${name}</b> has been set up on EZ Wins and your access is ready.</p>` +
      `<p>If you have any trouble getting in, just reply here.</p>`,
  };
}
