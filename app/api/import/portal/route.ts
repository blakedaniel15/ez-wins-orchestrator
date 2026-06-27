import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { importFromPortal } from '@/lib/import';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST → idempotent bulk import of portal dealers + groups into the orchestrator.
// Safe to re-run (skips already-imported by portal id). If it times out partway,
// re-run to continue.
export async function POST() {
  if (!(await isAuthed())) return unauthorized();
  try {
    const summary = await importFromPortal();
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
