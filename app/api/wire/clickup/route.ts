import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { writeProjectIdField, readProjectIdField } from '@/lib/clickup';
import { setProjectRefs } from '@/lib/projects';

export const runtime = 'nodejs';

// POST { projectId, taskId } → write projectId to the task's custom field, read
// it back, and record the task ref on the project.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const { projectId, taskId } = (await req.json()) as { projectId?: string; taskId?: string };
    if (!projectId || !taskId) {
      return NextResponse.json({ ok: false, error: 'projectId and taskId are required.' }, { status: 400 });
    }
    await writeProjectIdField(taskId, projectId);
    const readback = await readProjectIdField(taskId);
    await setProjectRefs(projectId, { clickup_task_id: taskId });
    return NextResponse.json({ ok: true, readback, match: readback === projectId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
