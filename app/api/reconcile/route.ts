import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { reconcileTask } from '@/lib/reconcile';

export const runtime = 'nodejs';

// POST { taskId } → match a form/email-created ClickUp task to a dealership + stamp ids.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const { taskId } = (await req.json()) as { taskId?: string };
    if (!taskId) return NextResponse.json({ ok: false, error: 'taskId required' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await reconcileTask(taskId)) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
