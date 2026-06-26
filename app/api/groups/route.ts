import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { createGroup, getGroup, listGroups } from '@/lib/groups';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const id = req.nextUrl.searchParams.get('id');
  if (id) return NextResponse.json({ ok: true, group: await getGroup(id) });
  return NextResponse.json({ ok: true, groups: await listGroups() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const body = (await req.json()) as { name?: string; billing_email?: string; portal_group_id?: string };
    if (!body.name) return NextResponse.json({ ok: false, error: 'name is required.' }, { status: 400 });
    const group = await createGroup({
      name: body.name,
      billing_email: body.billing_email || null,
      portal_group_id: body.portal_group_id || null,
    });
    return NextResponse.json({ ok: true, group });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
