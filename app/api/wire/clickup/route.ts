import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { writeProjectIdField, readProjectIdField, writeDealerIdField } from '@/lib/clickup';
import { setProjectRefs, getProject } from '@/lib/projects';

export const runtime = 'nodejs';

// POST { projectId, taskId } → stamp the task with BOTH the project id (custom
// field) and the Dealer ID (the project's dealership — the universal id), read
// the project id back, and record the task ref on the project. The dealer-id
// stamp is best-effort so it works before that ClickUp field is configured.
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

    // also stamp the Dealer ID (best-effort)
    let dealerStamp: string | null = null;
    let dealerError: string | null = null;
    try {
      const project = await getProject(projectId);
      if (project?.dealership_id) {
        await writeDealerIdField(taskId, project.dealership_id);
        dealerStamp = project.dealership_id;
      } else {
        dealerError = 'project has no dealership_id';
      }
    } catch (e) {
      dealerError = (e as Error).message;
    }

    return NextResponse.json({ ok: true, readback, match: readback === projectId, dealerStamp, dealerError });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
