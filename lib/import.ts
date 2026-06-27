// One-shot, idempotent bulk import of the portal's dealers + groups into the
// orchestrator as dealer_group / dealership records (linked + Dealer-ID-stamped).
// Safe to re-run: skips anything already imported (matched by portal id).

import { sql } from '@/lib/db';
import { getPortalDealers, getPortalGroups, savePortalDealers } from '@/lib/portal';
import { mintEntityIdBlock, padEntityId } from '@/lib/ids';

// Common OEM brands to detect from a dealer name. Order matters a little
// (multi-word/compound first). Returns the matched brand display names.
const OEM_BRANDS: [RegExp, string][] = [
  [/\bcdjr\b/i, 'Chrysler'], [/\bchrysler\b/i, 'Chrysler'], [/\bdodge\b/i, 'Dodge'],
  [/\bjeep\b/i, 'Jeep'], [/\bram\b/i, 'Ram'], [/\bvw\b|\bvolkswagen\b/i, 'Volkswagen'],
  [/\bchevrolet\b|\bchevy\b/i, 'Chevrolet'], [/\bgmc\b/i, 'GMC'], [/\bbuick\b/i, 'Buick'],
  [/\bcadillac\b/i, 'Cadillac'], [/\bford\b/i, 'Ford'], [/\blincoln\b/i, 'Lincoln'],
  [/\btoyota\b/i, 'Toyota'], [/\blexus\b/i, 'Lexus'], [/\bhonda\b/i, 'Honda'],
  [/\bacura\b/i, 'Acura'], [/\bnissan\b/i, 'Nissan'], [/\binfiniti\b/i, 'Infiniti'],
  [/\bhyundai\b/i, 'Hyundai'], [/\bkia\b/i, 'Kia'], [/\bgenesis\b/i, 'Genesis'],
  [/\bsubaru\b/i, 'Subaru'], [/\bmazda\b/i, 'Mazda'], [/\bmitsubishi\b/i, 'Mitsubishi'],
  [/\bbmw\b/i, 'BMW'], [/\bmercedes\b|\bmercedes-benz\b/i, 'Mercedes-Benz'], [/\baudi\b/i, 'Audi'],
  [/\bporsche\b/i, 'Porsche'], [/\bvolvo\b/i, 'Volvo'], [/\bjaguar\b/i, 'Jaguar'],
  [/\bland rover\b|\brange rover\b/i, 'Land Rover'], [/\bmini\b/i, 'Mini'],
  [/\bfiat\b/i, 'Fiat'], [/\balfa romeo\b/i, 'Alfa Romeo'], [/\bmaserati\b/i, 'Maserati'],
  [/\blotus\b/i, 'Lotus'], [/\bbentley\b/i, 'Bentley'], [/\bcadillac\b/i, 'Cadillac'],
];

function extractOems(name: string): string[] {
  const out: string[] = [];
  for (const [re, brand] of OEM_BRANDS) {
    if (re.test(name) && !out.includes(brand)) out.push(brand);
  }
  return out;
}

function mapStatus(portalStatus: unknown): string {
  const s = String(portalStatus || '').toLowerCase();
  if (s === 'inactive') return 'inactive';
  if (s === 'pipeline' || s === '') return 'prospect';
  return 'live';
}

export interface ImportSummary {
  totalPortalDealers: number;
  totalPortalGroups: number;
  groupsCreated: number;
  dealershipsCreated: number;
  dealershipsSkipped: number;
  portalDealersStamped: number;
}

export async function importFromPortal(): Promise<ImportSummary> {
  // existing links (idempotency)
  const existingDlr = (await sql`
    select portal_dealer_id from dealership where portal_dealer_id is not null
  `) as { portal_dealer_id: string }[];
  const seenPortalDealerIds = new Set(existingDlr.map((r) => r.portal_dealer_id));

  const existingGrp = (await sql`
    select id, portal_group_id from dealer_group where portal_group_id is not null
  `) as { id: string; portal_group_id: string }[];
  const grpMap = new Map<string, string>(existingGrp.map((r) => [r.portal_group_id, r.id]));

  // ── groups ──
  const portalGroups = await getPortalGroups();
  const newGroups = portalGroups.filter((g) => !grpMap.has(g.id));
  if (newGroups.length) {
    const start = await mintEntityIdBlock('GRP', newGroups.length);
    for (let i = 0; i < newGroups.length; i++) {
      const id = padEntityId('GRP', start + i);
      const g = newGroups[i];
      await sql`
        insert into dealer_group (id, name, billing_email, portal_group_id)
        values (${id}, ${g.name || 'Unnamed group'}, ${g.billingEmail || null}, ${g.id})
      `;
      grpMap.set(g.id, id);
    }
  }

  // ── dealers ──
  const portalDealers = await getPortalDealers();
  const toImport = portalDealers.filter((d) => !seenPortalDealerIds.has(d.id));
  const stamps = new Map<string, string>(); // portalDealerId -> DLR id

  if (toImport.length) {
    const start = await mintEntityIdBlock('DLR', toImport.length);
    for (let i = 0; i < toImport.length; i++) {
      const d = toImport[i] as { id: string; name?: string; projectId?: string | null; groupId?: string; dms?: string; status?: string };
      const id = padEntityId('DLR', start + i);
      const groupId = d.groupId ? grpMap.get(d.groupId) || null : null;
      const oems = extractOems(String(d.name || ''));
      await sql`
        insert into dealership (id, group_id, name, dms, oems, portal_dealer_id, status)
        values (${id}, ${groupId}, ${String(d.name || '')}, ${d.dms || null},
                ${JSON.stringify(oems)}::jsonb, ${d.id}, ${mapStatus(d.status)})
      `;
      stamps.set(d.id, id);
    }
  }

  // ── stamp Dealer IDs back onto the portal dealers (one write) ──
  let stamped = 0;
  for (const d of portalDealers) {
    const dlr = stamps.get(d.id);
    if (dlr && d.projectId !== dlr) {
      d.projectId = dlr;
      stamped++;
    }
  }
  if (stamped) await savePortalDealers(portalDealers);

  return {
    totalPortalDealers: portalDealers.length,
    totalPortalGroups: portalGroups.length,
    groupsCreated: newGroups.length,
    dealershipsCreated: toImport.length,
    dealershipsSkipped: portalDealers.length - toImport.length,
    portalDealersStamped: stamped,
  };
}
