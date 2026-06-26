import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { isProjectType } from '@/lib/ids';
import {
  createProject, getProject, getProjectByConversation, findProjectsByDealership, listProjects,
} from '@/lib/projects';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const conversationId = sp.get('conversationId');
  if (id) return NextResponse.json({ ok: true, project: await getProject(id) });
  if (conversationId) return NextResponse.json({ ok: true, project: await getProjectByConversation(conversationId) });
  return NextResponse.json({ ok: true, projects: await listProjects() });
}

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = body.type;
  const dealership_id = body.dealership_id as string | undefined;
  if (!isProjectType(type)) {
    return NextResponse.json(
      { ok: false, error: 'type must be onboarding | support | warranty_uplift | investigation' },
      { status: 400 }
    );
  }
  if (!dealership_id) {
    return NextResponse.json({ ok: false, error: 'dealership_id is required.' }, { status: 400 });
  }
  const force = body.force === true;
  try {
    if (!force) {
      const dupes = await findProjectsByDealership(dealership_id, type);
      if (dupes.length > 0) return NextResponse.json({ ok: false, duplicate: dupes });
    }
    const project = await createProject({ type, dealership_id });
    return NextResponse.json({ ok: true, project });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
