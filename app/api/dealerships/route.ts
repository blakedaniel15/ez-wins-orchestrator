import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { createDealership, getDealership, listDealerships, listDealershipsByGroup } from '@/lib/dealerships';

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
    };
    if (!b.name) return NextResponse.json({ ok: false, error: 'name is required.' }, { status: 400 });
    const dealership = await createDealership({
      name: b.name,
      group_id: b.group_id || null,
      dms: b.dms || null,
      conduit: b.conduit || null,
      oems: Array.isArray(b.oems) ? b.oems : [],
      portal_dealer_id: b.portal_dealer_id || null,
    });
    return NextResponse.json({ ok: true, dealership });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
