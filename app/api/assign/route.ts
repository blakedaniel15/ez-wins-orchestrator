import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { suggestGroups } from '@/lib/match';

export const runtime = 'nodejs';

// GET /api/assign?store=<name> → ranked open-deal group suggestions for the store.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const store = req.nextUrl.searchParams.get('store')?.trim();
  if (!store) return NextResponse.json({ ok: false, error: 'store name required.' }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, suggestions: await suggestGroups(store) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
