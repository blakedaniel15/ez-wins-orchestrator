// Microsoft Graph (Outlook) — token, inbox fetch, thread fetch, draft creation,
// send, and category tagging.
// Ported from ez-wins-email-assistant/lib/graph.js and api/email-sweep.js.
// Graph quirk: $filter + $orderby together is rejected on /messages — filter
// server-side, sort client-side.

import fs from 'fs';
import path from 'path';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ---------------------------------------------------------------------------
// Signature — load once, best-effort. Read from the project root (bundled via
// next.config outputFileTracingIncludes). Missing signature → drafts without it.
// Avoid import.meta.url (unreliable inside Next's server bundle) — use cwd.
// ---------------------------------------------------------------------------
let SIGNATURE_HTML = '';
try {
  const sigRaw = fs.readFileSync(path.join(process.cwd(), 'lib/signature.html'), 'utf-8');
  const bodyMatch = sigRaw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  SIGNATURE_HTML = bodyMatch ? bodyMatch[1].trim() : sigRaw;
} catch {
  // signature.html not present / not traced in this environment.
  SIGNATURE_HTML = '';
}

// ---------------------------------------------------------------------------
// Plain-text → HTML helper (mirrors email-sweep.js createDraftReply/createOutboundDraft)
// ---------------------------------------------------------------------------
function plainTextToHtml(body: string): string {
  const html = body
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return SIGNATURE_HTML ? `${html}<br>${SIGNATURE_HTML}` : html;
}

function userEmail(): string {
  const e = process.env.MS_USER_EMAIL;
  if (!e) throw new Error('MS_USER_EMAIL is not set.');
  return e;
}

export function projectCategory(projectId: string): string {
  return `EZW-${projectId}`;
}

// ---------------------------------------------------------------------------
// Msg — the normalised shape consumed by the orchestrator pipeline.
// ---------------------------------------------------------------------------
export interface Msg {
  id: string;
  conversationId: string;
  subject: string;
  from: string;
  toRecipients: string[];
  receivedDateTime: string;
  bodyPreview: string;
  body: string;
  hasAttachments: boolean;
}

// Internal raw type returned by Graph before mapping.
interface RawGraphMsg {
  id: string;
  conversationId: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  receivedDateTime: string;
  bodyPreview?: string;
  body?: { content?: string };
  hasAttachments?: boolean;
  categories?: string[];
}

function mapMsg(raw: RawGraphMsg): Msg {
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    subject: raw.subject || '(no subject)',
    from: raw.from?.emailAddress?.address || '',
    toRecipients: (raw.toRecipients || []).map((r) => r.emailAddress?.address || '').filter(Boolean),
    receivedDateTime: raw.receivedDateTime,
    bodyPreview: raw.bodyPreview || '',
    body: raw.body?.content || '',
    hasAttachments: raw.hasAttachments || false,
  };
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/** Convenience alias matching the target interface (getToken). */
export async function getToken(): Promise<string> {
  return getGraphToken();
}

export async function getGraphToken(): Promise<string> {
  const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET } = process.env;
  if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET) {
    throw new Error('Microsoft Graph env vars (MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET) are not set.');
  }
  const url = `https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    client_secret: MS_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Graph auth failed: ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export interface GraphMessage {
  id: string;
  subject: string;
  conversationId: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime: string;
  categories?: string[];
  webLink?: string;
}

// All messages in a thread, oldest first.
export async function fetchThreadMessages(token: string, conversationId: string): Promise<GraphMessage[]> {
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/messages` +
    `?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'` +
    `&$select=id,subject,conversationId,from,receivedDateTime,categories,webLink` +
    `&$top=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Thread fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { value?: GraphMessage[] };
  const messages = data.value || [];
  messages.sort((a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime());
  return messages;
}

// Subject + Outlook web link for a thread (the latest message's webLink opens
// the conversation in OWA). Returns null if the thread has no messages.
export async function fetchThreadInfo(
  conversationId: string
): Promise<{ conversationId: string; subject: string; webLink: string | null; count: number } | null> {
  const token = await getGraphToken();
  const messages = await fetchThreadMessages(token, conversationId);
  if (messages.length === 0) return null;
  const latest = messages[messages.length - 1];
  return {
    conversationId,
    subject: latest.subject || '(no subject)',
    webLink: latest.webLink || null,
    count: messages.length,
  };
}

// Search recent messages by subject — a convenience so a thread can be located
// for tagging without hand-copying a conversationId. Uses Graph $search (KQL);
// $search can't combine with $orderby, so we sort client-side.
export async function searchMessagesBySubject(token: string, q: string): Promise<GraphMessage[]> {
  const search = `"subject:${q.replace(/"/g, '')}"`;
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/messages` +
    `?$search=${encodeURIComponent(search)}` +
    `&$select=id,subject,conversationId,from,receivedDateTime,categories` +
    `&$top=25`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: 'eventual' },
  });
  if (!res.ok) throw new Error(`Subject search failed: ${await res.text()}`);
  const data = (await res.json()) as { value?: GraphMessage[] };
  return (data.value || []).sort(
    (a, b) => new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime()
  );
}

async function patchCategories(token: string, messageId: string, categories: string[]): Promise<void> {
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/messages/${messageId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories }),
  });
  if (!res.ok) throw new Error(`Category PATCH failed (${res.status}): ${await res.text()}`);
}

// Stamp every message in a thread with the EZW-{projectId} category, preserving
// any existing categories. Returns the count of messages tagged.
export async function tagThread(conversationId: string, projectId: string): Promise<{ tagged: number; conversationId: string }> {
  const token = await getGraphToken();
  const cat = projectCategory(projectId);
  const messages = await fetchThreadMessages(token, conversationId);
  if (messages.length === 0) {
    throw new Error(`No messages found for conversationId ${conversationId}.`);
  }
  let tagged = 0;
  for (const m of messages) {
    const existing = m.categories || [];
    if (existing.includes(cat)) {
      tagged++;
      continue;
    }
    await patchCategories(token, m.id, [...existing, cat]);
    tagged++;
  }
  return { tagged, conversationId };
}

// ---------------------------------------------------------------------------
// Email-assistant-compatible API (ported from email-sweep.js / lib/graph.js)
// ---------------------------------------------------------------------------

const PROCESSED_CATEGORY = 'EZ-Assistant-Processed';

/**
 * Fetch inbox messages received within the last `lookbackHours` hours,
 * excluding any already tagged with EZ-Assistant-Processed.
 * Mirrors email-sweep.js fetchRecentInboxEmails exactly:
 *   - mailFolders/inbox/messages with $filter on receivedDateTime + categories
 *   - $orderby=receivedDateTime desc (Graph allows $filter + $orderby on mailFolders)
 *   - $select includes id, conversationId, subject, from, toRecipients, receivedDateTime,
 *     bodyPreview, hasAttachments
 */
export async function fetchRecentInbox(lookbackHours: number): Promise<Msg[]> {
  const token = await getGraphToken();
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const filter =
    `receivedDateTime ge ${since}` +
    ` and not(categories/any(c: c eq '${PROCESSED_CATEGORY}'))`;
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent(filter)}` +
    `&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,categories` +
    `&$orderby=receivedDateTime desc&$top=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Inbox fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { value?: RawGraphMsg[] };
  return (data.value || []).map(mapMsg);
}

/**
 * Fetch all messages in a conversation, sorted ascending (oldest first).
 * Includes body content. Mirrors the Graph quirk workaround in email-sweep.js:
 * $filter only (no $orderby), sort client-side.
 */
export async function fetchThread(conversationId: string): Promise<Msg[]> {
  const token = await getGraphToken();
  const url =
    `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/messages` +
    `?$filter=conversationId eq '${conversationId.replace(/'/g, "''")}'` +
    `&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,body,hasAttachments` +
    `&$top=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Thread fetch failed: ${await res.text()}`);
  const data = (await res.json()) as { value?: RawGraphMsg[] };
  const messages = data.value || [];
  messages.sort((a, b) => new Date(a.receivedDateTime).getTime() - new Date(b.receivedDateTime).getTime());
  return messages.map(mapMsg);
}

/**
 * Create a reply draft (in Drafts folder) to an existing message.
 * Step 1: POST .../messages/{id}/createReply → get draft id.
 * Step 2: PATCH the draft with HTML body (plain-text → HTML + signature).
 * Never sends. Mirrors createDraftReply in email-sweep.js exactly.
 */
export async function createDraftReply(messageId: string, bodyText: string): Promise<void> {
  const token = await getGraphToken();
  const base = `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}`;

  const createRes = await fetch(`${base}/messages/${messageId}/createReply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!createRes.ok) throw new Error(`Create reply failed: ${await createRes.text()}`);
  const draft = (await createRes.json()) as { id: string };

  const updateRes = await fetch(`${base}/messages/${draft.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: { contentType: 'HTML', content: plainTextToHtml(bodyText) } }),
  });
  if (!updateRes.ok) throw new Error(`Update draft failed: ${await updateRes.text()}`);
}

/**
 * Create a new outbound draft (not a reply) in the Drafts folder.
 * Mirrors createOutboundDraft in email-sweep.js.
 * `to` is an array of email address strings.
 */
export async function createOutboundDraft(to: string[], subject: string, bodyText: string): Promise<void> {
  const token = await getGraphToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/messages`;
  const payload = {
    subject,
    body: { contentType: 'HTML', content: plainTextToHtml(bodyText) },
    toRecipients: to.map((address) => ({ emailAddress: { address } })),
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Create outbound draft failed: ${await res.text()}`);
}

/**
 * Send an email immediately (not a draft).
 * NET-NEW — the email assistant never sent; this is for the orchestrator's
 * automated outbound flows where Blake has pre-approved sending.
 * POST .../sendMail with saveToSentItems:true.
 */
export async function sendMail(input: {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const token = await getGraphToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/sendMail`;
  const payload = {
    message: {
      subject: input.subject,
      body: { contentType: 'HTML', content: input.html },
      toRecipients: input.to.map((address) => ({ emailAddress: { address } })),
      ccRecipients: (input.cc || []).map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: true,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // sendMail returns 202 No Content on success
  if (!res.ok) throw new Error(`sendMail failed (${res.status}): ${await res.text()}`);
}

/**
 * PATCH categories on a single message.
 * Replaces (not merges) the categories array — caller is responsible for
 * preserving existing categories if needed.
 * Mirrors markProcessed in email-sweep.js.
 */
export async function tagProcessed(messageId: string, categories: string[]): Promise<void> {
  const token = await getGraphToken();
  const url = `${GRAPH_BASE}/users/${encodeURIComponent(userEmail())}/messages/${messageId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories }),
  });
  if (!res.ok) throw new Error(`tagProcessed failed (${res.status}): ${await res.text()}`);
}
