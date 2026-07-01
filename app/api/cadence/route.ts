import { NextRequest, NextResponse } from 'next/server';
import { tickCadence } from '@/lib/cadence';

export const runtime = 'nodejs';

// Cron: advance due follow-up cadences (proposes nudges to the OUTBOX).
// Protected by CRON_SECRET (Vercel cron sends it as a Bearer token).
function cronAuthed(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization') || req.headers.get('x-cron-secret') || '';
  return auth === `Bearer ${secret}` || auth === secret;
}

export async function GET(req: NextRequest) {
  if (!cronAuthed(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const result = await tickCadence(new Date());
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
