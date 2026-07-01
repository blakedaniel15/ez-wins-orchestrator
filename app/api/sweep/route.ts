import { NextRequest, NextResponse } from 'next/server';
import { isAuthed } from '@/lib/security';
import { runSweep } from '@/lib/sweep';

export const runtime = 'nodejs';
export const maxDuration = 300; // sweeps can be slow (per-email classify)

// Cron (CRON_SECRET) OR a logged-in admin (for manual runs) may trigger the sweep.
function cronAuthed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization') || req.headers.get('x-cron-secret') || '';
  return auth === `Bearer ${secret}` || auth === secret;
}

async function handle(req: NextRequest) {
  if (!cronAuthed(req) && !(await isAuthed())) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const lb = Number(req.nextUrl.searchParams.get('lookbackHours')) || 1.5;
    const result = await runSweep(lb);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
