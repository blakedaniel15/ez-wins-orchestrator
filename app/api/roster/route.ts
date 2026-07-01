import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { sql } from '@/lib/db';
import { extractFromExcel, extractFromText, extractFromImage, applyCompleteness, type RosterRow } from '@/lib/roster';
import { enqueueAction } from '@/lib/actions';
import { logDecision } from '@/lib/decisions';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function saveRoster(projectId: string, rows: RosterRow[]): Promise<void> {
  for (const r of rows) {
    await sql`
      insert into roster_member (project_id, name, email, role, dms_id, source, confidence, missing, action)
      values (${projectId}, ${r.name}, ${r.email}, ${r.role}, ${r.dms_id}, ${r.source}, ${r.confidence},
              ${JSON.stringify(r.missing)}::jsonb, ${r.action})
    `;
  }
}

// GET /api/roster?projectId=ONB-... → the collected roster.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 });
  const rows = (await sql`select * from roster_member where project_id = ${projectId} order by id asc`) as unknown[];
  return NextResponse.json({ ok: true, roster: rows });
}

// POST — extract a roster and persist it against a project.
// JSON body:      { projectId, underlyingDms, source, text }         (pasted text)
// multipart form: projectId, underlyingDms, source, file(Excel/img)  (upload)
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    let projectId = '';
    let underlyingDms = '';
    let source = 'email_text';
    let rows: RosterRow[] = [];

    const ctype = req.headers.get('content-type') || '';
    if (ctype.includes('multipart/form-data')) {
      const form = await req.formData();
      projectId = String(form.get('projectId') || '');
      underlyingDms = String(form.get('underlyingDms') || '');
      source = String(form.get('source') || 'form_upload');
      const file = form.get('file') as File | null;
      if (!file) return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 });
      const buf = new Uint8Array(await file.arrayBuffer());
      if (/\.(xlsx?|csv)$/i.test(file.name) || file.type.includes('sheet') || file.type.includes('csv')) {
        rows = extractFromExcel(buf, source);
      } else if (file.type.startsWith('image/')) {
        const b64 = Buffer.from(buf).toString('base64');
        rows = await extractFromImage(b64, file.type, source);
      } else {
        return NextResponse.json({ ok: false, error: `unsupported file type: ${file.type || file.name}` }, { status: 400 });
      }
    } else {
      const b = (await req.json()) as { projectId?: string; underlyingDms?: string; source?: string; text?: string };
      projectId = b.projectId || '';
      underlyingDms = b.underlyingDms || '';
      source = b.source || 'email_text';
      rows = b.text ? await extractFromText(b.text, source) : [];
    }

    if (!projectId) return NextResponse.json({ ok: false, error: 'projectId required' }, { status: 400 });

    // Apply the role×DMS completeness matrix, then persist.
    const completed = rows.map((r) => applyCompleteness(r, underlyingDms));
    await saveRoster(projectId, completed);

    // One reach-back naming exactly who is missing an email (the only thing that goes to the sender).
    const needEmail = completed.filter((r) => r.action === 'reach_back').map((r) => r.name).filter(Boolean);
    let reachBackQueued = false;
    if (needEmail.length) {
      await enqueueAction({
        project_id: projectId, kind: 'reach_back',
        proposed_payload: { intent: 'missing_email', names: needEmail, note: `Missing email for: ${needEmail.join(', ')}` },
      });
      reachBackQueued = true;
    }

    await logDecision({ kind: 'roster', decision: 'extracted', detail: { projectId, count: completed.length, source, reachBackQueued } });
    return NextResponse.json({ ok: true, roster: completed, count: completed.length, reachBackQueued });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
