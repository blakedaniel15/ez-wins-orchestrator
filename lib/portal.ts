// Portal client — write/read `projectId` on a dealer via ez-wins-portal's
// /api/storage. NOTE: the dealers POST is a FULL-COLLECTION REPLACE (it deletes
// any dealer id not in the array, then upserts). So we must fetch the whole
// array, mutate one dealer, and send it all back. This is a Phase-0 test-only
// path; production should write the column directly to avoid clobbering a
// concurrent portal edit.

const DEALERS_KEY = 'ezw:dealers:v4';

interface Dealer {
  id: string;
  name?: string;
  projectId?: string | null;
  [k: string]: unknown;
}

function base(): string {
  const b = process.env.PORTAL_BASE_URL;
  if (!b) throw new Error('PORTAL_BASE_URL is not set.');
  return b.replace(/\/$/, '');
}

async function getDealers(): Promise<Dealer[]> {
  const res = await fetch(`${base()}/api/storage?key=${encodeURIComponent(DEALERS_KEY)}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Portal dealers fetch failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { value: string | null };
  if (!json.value) return [];
  return JSON.parse(json.value) as Dealer[];
}

async function putDealers(dealers: Dealer[]): Promise<void> {
  const res = await fetch(`${base()}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: DEALERS_KEY, value: JSON.stringify(dealers) }),
  });
  if (!res.ok) throw new Error(`Portal dealers save failed (${res.status}): ${await res.text()}`);
}

// Exposed for the bulk import. Portal GET returns camelCase fields
// (id, name, dms, groupId, status, projectId, ...).
export async function getPortalDealers(): Promise<Dealer[]> {
  return getDealers();
}

export async function savePortalDealers(dealers: Dealer[]): Promise<void> {
  return putDealers(dealers);
}

export interface PortalGroup {
  id: string;
  name?: string;
  billingEmail?: string | null;
  [k: string]: unknown;
}

export async function getPortalGroups(): Promise<PortalGroup[]> {
  const res = await fetch(`${base()}/api/storage?key=${encodeURIComponent('ezw:groups:v1')}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Portal groups fetch failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { value: string | null };
  if (!json.value) return [];
  return JSON.parse(json.value) as PortalGroup[];
}

async function putPortalGroups(rows: PortalGroup[]): Promise<void> {
  const res = await fetch(`${base()}/api/storage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'ezw:groups:v1', value: JSON.stringify(rows) }),
  });
  if (!res.ok) throw new Error(`Portal groups save failed (${res.status}): ${await res.text()}`);
}

// Ensure a portal group exists for this orchestrator group; match by name → link, else create.
export async function createOrLinkPortalGroup(input: {
  groupId: string;
  name: string;
}): Promise<{ portalGroupId: string; action: 'linked' | 'created' }> {
  const rows = await getPortalGroups();
  const existing = rows.find(
    (g) => String(g.name || '').trim().toLowerCase() === input.name.trim().toLowerCase()
  );
  if (existing) return { portalGroupId: String(existing.id), action: 'linked' };
  const id = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  rows.push({ id, name: input.name });
  await putPortalGroups(rows);
  return { portalGroupId: id, action: 'created' };
}

// Set a portal dealer's groupId (assign it to its portal group). Full-collection replace.
export async function setPortalDealerGroup(portalDealerId: string, portalGroupId: string): Promise<void> {
  const dealers = await getDealers();
  const target = dealers.find((d) => d.id === portalDealerId);
  if (!target) throw new Error(`Dealer ${portalDealerId} not found in the portal.`);
  (target as Dealer & { groupId?: string }).groupId = portalGroupId;
  await putDealers(dealers);
}

export async function writeProjectIdToDealer(dealerId: string, projectId: string): Promise<void> {
  const dealers = await getDealers();
  const target = dealers.find((d) => d.id === dealerId);
  if (!target) throw new Error(`Dealer ${dealerId} not found in the portal.`);
  target.projectId = projectId;
  await putDealers(dealers);
}

export async function readProjectIdFromDealer(dealerId: string): Promise<string | null> {
  const dealers = await getDealers();
  const target = dealers.find((d) => d.id === dealerId);
  if (!target) throw new Error(`Dealer ${dealerId} not found in the portal.`);
  const v = target.projectId;
  return v == null || v === '' ? null : String(v);
}

// Create-or-link a portal dealer for a dealership (Blake's call: match existing
// by name → link & stamp the Dealer ID; else create a fresh pipeline dealer).
// The portal dealer carries the persistent **Dealer ID** (`DLR-`) in its
// `projectId` field — the one universal id that travels through every system.
export async function createOrLinkPortalDealer(input: {
  dealershipId: string;
  name: string;
  dms?: string | null;
}): Promise<{ portalDealerId: string; action: 'linked' | 'created' }> {
  const dealers = await getDealers();
  const existing = dealers.find(
    (d) => String(d.name || '').trim().toLowerCase() === input.name.trim().toLowerCase()
  );
  if (existing) {
    existing.projectId = input.dealershipId;
    await putDealers(dealers);
    return { portalDealerId: String(existing.id), action: 'linked' };
  }
  const id = `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  dealers.push({
    id,
    name: input.name,
    dms: input.dms || '',
    status: 'pipeline',
    projectId: input.dealershipId,
    lastUpdated: new Date().toISOString(),
  });
  await putDealers(dealers);
  return { portalDealerId: id, action: 'created' };
}
