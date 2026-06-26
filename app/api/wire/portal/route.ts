import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { writeProjectIdToDealer, readProjectIdFromDealer } from '@/lib/portal';

export const runtime = 'nodejs';

// POST { projectId, dealerId } → write projectId onto the portal dealer and read
// it back. Returns the readback so the acceptance page can show green/red.
// (In the Phase 0.5 model, the dealer↔portal link lives on the dealership
// — `dealership.portal_dealer_id` — not the project, so we don't stamp it here.)
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const { projectId, dealerId } = (await req.json()) as { projectId?: string; dealerId?: string };
    if (!projectId || !dealerId) {
      return NextResponse.json({ ok: false, error: 'projectId and dealerId are required.' }, { status: 400 });
    }
    await writeProjectIdToDealer(dealerId, projectId);
    const readback = await readProjectIdFromDealer(dealerId);
    return NextResponse.json({ ok: true, readback, match: readback === projectId });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
