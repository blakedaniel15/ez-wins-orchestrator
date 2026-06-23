import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { isProjectType } from '@/lib/ids';
import {
  createProject,
  getProject,
  getProjectByConversation,
  findProjectsByDealer,
  listProjects,
} from '@/lib/projects';

export const runtime = 'nodejs';

// GET /api/projects                  → list recent
// GET /api/projects?id=ONB-2026-0001 → one project
// GET /api/projects?conversationId=… → resolve by Outlook thread (acceptance #5)
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id');
  const conversationId = sp.get('conversationId');
  if (id) {
    const project = await getProject(id);
    return NextResponse.json({ ok: true, project });
  }
  if (conversationId) {
    const project = await getProjectByConversation(conversationId);
    return NextResponse.json({ ok: true, project });
  }
  return NextResponse.json({ ok: true, projects: await listProjects() });
}

// POST /api/projects → mint + create a project.
// Body: { type, dealer_name?, group_name?, dms?, conduit?, moc_reps?, force? }
// Runs a dealer-name dedup check first; returns { duplicate } unless force=true.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = body.type;
  if (!isProjectType(type)) {
    return NextResponse.json(
      { ok: false, error: 'type must be one of onboarding | support | warranty_uplift | investigation' },
      { status: 400 }
    );
  }
  const dealer_name = (body.dealer_name as string) || null;
  const force = body.force === true;

  try {
    if (dealer_name && !force) {
      const dupes = await findProjectsByDealer(dealer_name, type);
      if (dupes.length > 0) {
        return NextResponse.json({ ok: false, duplicate: dupes });
      }
    }

    const project = await createProject({
      type,
      dealer_name,
      group_name: (body.group_name as string) || null,
      dms: (body.dms as string) || null,
      conduit: (body.conduit as string) || null,
      moc_reps: Array.isArray(body.moc_reps) ? (body.moc_reps as unknown[]) : [],
    });
    return NextResponse.json({ ok: true, project });
  } catch (e) {
    // Surface DB/schema errors (e.g. a missing table) instead of a blank 500.
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
