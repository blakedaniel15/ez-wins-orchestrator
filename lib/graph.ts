// Microsoft Graph (Outlook) — token + thread tagging.
// Mirrors the proven patterns in ez-wins-email-assistant/lib/graph.js.
// Graph quirk: $filter + $orderby together is rejected on /messages — filter
// server-side, sort client-side.

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

function userEmail(): string {
  const e = process.env.MS_USER_EMAIL;
  if (!e) throw new Error('MS_USER_EMAIL is not set.');
  return e;
}

export function projectCategory(projectId: string): string {
  return `EZW-${projectId}`;
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
