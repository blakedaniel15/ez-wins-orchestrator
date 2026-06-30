import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import {
  createDealership, getDealership, listDealerships, listDealershipsByGroup, setDealershipRefs,
} from '@/lib/dealerships';
import { createOrLinkPortalDealer, setPortalDealerRegion } from '@/lib/portal';
import { detectRegion } from '@/lib/regions';
import { detectBrand } from '@/lib/brands';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const groupId = sp.get('groupId');
  if (id) return NextResponse.json({ ok: true, dealership: await getDealership(id) });
  if (groupId) return NextResponse.json({ ok: true, dealerships: await listDealershipsByGroup(groupId) });
  return NextResponse.json({ ok: true, dealerships: await listDealerships() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      name?: string; group_id?: string; dms?: string; conduit?: string;
      oems?: string[]; portal_dealer_id?: string;
      address?: string; city?: string; state?: string; zip?: string;
      platform_fields?: Record<string, unknown>;
    };
    if (!b.name) return NextResponse.json({ ok: false, error: 'name is required.' }, { status: 400 });
    // Auto-detect region from state/city (stores 'ASK' as-is for the review queue)
    // and brand from the name. Region only computed when a state is provided.
    const region = b.state ? detectRegion(b.state, b.city || '') : null;
    const brand = detectBrand(b.name);
    const dealership = await createDealership({
      name: b.name,
      group_id: b.group_id || null,
      dms: b.dms || null,
      conduit: b.conduit || null,
      oems: Array.isArray(b.oems) ? b.oems : [],
      portal_dealer_id: b.portal_dealer_id || null,
      address: b.address || null,
      city: b.city || null,
      state: b.state || null,
      zip: b.zip || null,
      region,
      brand,
      platform_fields: b.platform_fields || {},
    });

    // Orchestrator owns portal infrastructure: create-or-link the portal dealer
    // immediately (pipeline), stamping the Dealer ID. Resilient — a portal hiccup
    // doesn't fail the dealership create.
    let portal: { portalDealerId: string; action: 'linked' | 'created' } | null = null;
    let portalError: string | null = null;
    if (!dealership.portal_dealer_id) {
      try {
        portal = await createOrLinkPortalDealer({
          dealershipId: dealership.id,
          name: dealership.name,
          dms: dealership.dms,
        });
        await setDealershipRefs(dealership.id, { portal_dealer_id: portal.portalDealerId });
        dealership.portal_dealer_id = portal.portalDealerId;
      } catch (e) {
        portalError = (e as Error).message;
      }
    }
    // Push the detected region onto the portal dealer (best-effort). Skip 'ASK'
    // (unresolved) — it stays blank in the portal until the review queue sets it.
    if (dealership.portal_dealer_id && region && region !== 'ASK') {
      try {
        await setPortalDealerRegion(dealership.portal_dealer_id, region);
      } catch (e) {
        portalError = portalError || (e as Error).message;
      }
    }
    return NextResponse.json({ ok: true, dealership, portal, portalError });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// PATCH { id, portal_dealer_id?, group_id?, dms?, conduit?, status?, connectPortal? }
// Relink/repair an existing dealership. connectPortal=true runs create-or-link
// against the portal (match by name → link, else create) and saves the result.
export async function PATCH(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      id?: string; portal_dealer_id?: string; group_id?: string;
      dms?: string; conduit?: string; status?: string; connectPortal?: boolean;
    };
    if (!b.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

    let portal: { portalDealerId: string; action: 'linked' | 'created' } | null = null;
    if (b.connectPortal) {
      const d = await getDealership(b.id);
      if (!d) return NextResponse.json({ ok: false, error: 'dealership not found.' }, { status: 404 });
      portal = await createOrLinkPortalDealer({ dealershipId: d.id, name: d.name, dms: d.dms });
    }

    const dealership = await setDealershipRefs(b.id, {
      portal_dealer_id: portal?.portalDealerId ?? b.portal_dealer_id ?? undefined,
      group_id: b.group_id ?? undefined,
      dms: b.dms ?? undefined,
      conduit: b.conduit ?? undefined,
      status: b.status ?? undefined,
    });
    return NextResponse.json({ ok: true, dealership, portal });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
