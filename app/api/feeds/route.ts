import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { parseDealerVault, parseTekion, parseFortellisCsv, parseReynoldsFields, type FeedRecord } from '@/lib/feeds';
import { detectBrand } from '@/lib/brands';
import { detectRegion } from '@/lib/regions';
import { suggestGroups } from '@/lib/match';
import { createDealership, setDealershipRefs } from '@/lib/dealerships';
import { createOrLinkPortalDealer, setPortalDealerRegion } from '@/lib/portal';
import { logDecision } from '@/lib/decisions';

export const runtime = 'nodejs';

interface Enriched extends FeedRecord {
  brand: string | null;
  region: string | null;
  groupSuggestion: { id: string; name: string; score: number } | null;
  flags: string[];
}

async function enrich(rec: FeedRecord): Promise<Enriched> {
  const brand = detectBrand(rec.name);
  const region = rec.state ? detectRegion(rec.state, rec.city || '') : null;
  const suggestions = await suggestGroups(rec.name);
  const top = suggestions[0];
  const groupSuggestion = top && top.score > 0 ? { id: top.group.id, name: top.group.name, score: top.score } : null;
  const flags: string[] = [];
  if (!rec.address) flags.push('no_address');
  if (!region || region === 'ASK') flags.push('region_ask');
  if (!brand) flags.push('no_brand');
  if (!groupSuggestion) flags.push('no_group_match');
  return { ...rec, brand, region: region === 'ASK' ? null : region, groupSuggestion, flags };
}

function parse(source: string, text: string, reynolds?: Record<string, string>): FeedRecord[] {
  switch (source) {
    case 'dealervault': return parseDealerVault(text);
    case 'tekion': return parseTekion(text);
    case 'fortellis': return parseFortellisCsv(text);
    case 'reynolds':
      return reynolds ? [parseReynoldsFields(reynolds as any)] : [];
    default: return [];
  }
}

// POST { action:'parse', source, text?, reynolds? }  → enriched review set
// POST { action:'confirm', record }                  → create dealership + portal dealer (pipeline) + region
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = await req.json() as {
      action: 'parse' | 'confirm'; source?: string; text?: string;
      reynolds?: Record<string, string>; record?: Enriched; groupId?: string;
    };

    if (b.action === 'parse') {
      const records = parse(b.source || '', b.text || '', b.reynolds);
      const enriched = await Promise.all(records.map(enrich));
      return NextResponse.json({ ok: true, records: enriched, count: enriched.length });
    }

    if (b.action === 'confirm' && b.record) {
      const r = b.record;
      const dealership = await createDealership({
        name: r.name, dms: r.dms || null, conduit: r.conduit || null,
        group_id: b.groupId || null, platform_fields: r.platform_fields || {},
        address: r.address || null, city: r.city || null, state: r.state || null, zip: r.zip || null,
        region: r.region || null, brand: r.brand || null, lifecycle_stage: 'pending',
      });
      let portalError: string | null = null;
      try {
        const pd = await createOrLinkPortalDealer({ dealershipId: dealership.id, name: dealership.name, dms: dealership.dms });
        await setDealershipRefs(dealership.id, { portal_dealer_id: pd.portalDealerId });
        dealership.portal_dealer_id = pd.portalDealerId;
        if (r.region) await setPortalDealerRegion(pd.portalDealerId, r.region);
      } catch (e) {
        portalError = (e as Error).message;
      }
      await logDecision({ kind: 'feed_confirm', dealership_id: dealership.id, group_id: b.groupId || null, decision: 'created', detail: { source: r.source, portalError } });
      return NextResponse.json({ ok: true, dealership, portalError });
    }

    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
