import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { suggestGroups } from '@/lib/match';
import { getDealership, createDealership, setDealershipRefs } from '@/lib/dealerships';
import { getGroup } from '@/lib/groups';
import { createOrLinkPortalDealer, createOrLinkPortalGroup, setPortalDealerGroup } from '@/lib/portal';
import { logDecision } from '@/lib/decisions';

export const runtime = 'nodejs';

// GET /api/assign?store=<name> → ranked open-deal group suggestions for the store.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const store = req.nextUrl.searchParams.get('store')?.trim();
  if (!store) return NextResponse.json({ ok: false, error: 'store name required.' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, suggestions: await suggestGroups(store) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// POST { groupId, dealershipId?, name?, dms?, proposal?, decision? }
// Assign a store to an open group deal: set its group, push the portal group + dealer, log.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      groupId?: string; dealershipId?: string; name?: string; dms?: string;
      proposal?: unknown; decision?: string;
    };
    if (!b.groupId) return NextResponse.json({ ok: false, error: 'groupId is required.' }, { status: 400 });
    const group = await getGroup(b.groupId);
    if (!group) return NextResponse.json({ ok: false, error: 'group not found.' }, { status: 404 });

    // resolve or create the dealership
    let dealership = b.dealershipId ? await getDealership(b.dealershipId) : null;
    if (!dealership) {
      if (!b.name) return NextResponse.json({ ok: false, error: 'dealershipId or name required.' }, { status: 400 });
      dealership = await createDealership({ name: b.name, group_id: b.groupId, dms: b.dms || null, status: 'onboarding' });
    } else {
      dealership = await setDealershipRefs(dealership.id, { group_id: b.groupId, status: 'onboarding' });
    }
    if (!dealership) return NextResponse.json({ ok: false, error: 'failed to resolve dealership.' }, { status: 500 });

    // push portal: ensure portal group, ensure/link portal dealer, set its group
    let portalError: string | null = null;
    try {
      const pg = await createOrLinkPortalGroup({ groupId: group.id, name: group.name });
      let portalDealerId = dealership.portal_dealer_id;
      if (!portalDealerId) {
        const pd = await createOrLinkPortalDealer({ dealershipId: dealership.id, name: dealership.name, dms: dealership.dms });
        portalDealerId = pd.portalDealerId;
        await setDealershipRefs(dealership.id, { portal_dealer_id: portalDealerId });
      }
      await setPortalDealerGroup(portalDealerId, pg.portalGroupId);
    } catch (e) {
      portalError = (e as Error).message;
    }

    await logDecision({
      kind: 'group_assignment', type: 'onboarding',
      dealership_id: dealership.id, group_id: b.groupId,
      proposal: b.proposal ?? null, decision: b.decision || 'confirmed',
      detail: { portalError },
    });

    return NextResponse.json({ ok: true, dealership, portalError });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
