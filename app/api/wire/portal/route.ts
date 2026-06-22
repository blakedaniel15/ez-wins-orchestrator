import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { writeProjectIdToDealer, readProjectIdFromDealer } from '@/lib/portal';
import { setProjectRefs } from '@/lib/projects';

export const runtime = 'nodejs';

// POST { projectId, dealerId } → write projectId onto the portal dealer, read it
// back, and record the dealer ref on the project. Returns the readback so the
// acceptance page can show green/red.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const { projectId, dealerId } = (await req.json()) as { projectId?: string; dealerId?: string };
    if (!projectId || !dealerId) {
      return NextResponse.json({ ok: false, error: 'projectId and dealerId are required.' }, { status: 400 });
    }
    await writeProjectIdToDealer(dealerId, projectId);
    const readback = await readProjectIdFromDealer(dealerId);
    await setProjectRefs(projectId, { portal_dealer_id: dealerId });
    return NextResponse.json({ ok: true, readback, match: readback === projectId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
