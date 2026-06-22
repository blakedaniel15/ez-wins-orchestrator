import { NextResponse } from 'next/server';
import { isAuthed } from '@/lib/security';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ authed: await isAuthed() });
}
