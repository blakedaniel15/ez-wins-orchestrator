import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { createGroup, getGroup, listGroups, listOpenGroups, setGroupStatus } from '@/lib/groups';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  if (id) return NextResponse.json({ ok: true, group: await getGroup(id) });
  if (sp.get('status') === 'open') return NextResponse.json({ ok: true, groups: await listOpenGroups() });
  return NextResponse.json({ ok: true, groups: await listGroups() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      name?: string; billing_email?: string; locations_url?: string; contacts?: unknown[];
    };
    if (!b.name) return NextResponse.json({ ok: false, error: 'name is required.' }, { status: 400 });
    const group = await createGroup({
      name: b.name,
      billing_email: b.billing_email || null,
      locations_url: b.locations_url || null,
      contacts: Array.isArray(b.contacts) ? b.contacts : [],
    });
    return NextResponse.json({ ok: true, group });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as { id?: string; status?: string };
    if (!b.id || !b.status) return NextResponse.json({ ok: false, error: 'id and status required.' }, { status: 400 });
    return NextResponse.json({ ok: true, group: await setGroupStatus(b.id, b.status) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
