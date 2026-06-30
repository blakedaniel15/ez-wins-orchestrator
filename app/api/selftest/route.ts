import { NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import '@/lib/selftest.suites'; // side-effect: registers all suites
import { runSelfTests } from '@/lib/selftest';

export const runtime = 'nodejs';

// GET /api/selftest → runs the pure-logic self-test suites on Vercel.
// This is how we verify region/brand/description/roster/feed logic without a
// local test runner. Returns { passed, failed, suites:[{suite,cases}] }.
export async function GET() {
  if (!(await isAuthed())) return unauthorized();
  const result = runSelfTests();
  return NextResponse.json({ ok: result.failed === 0, ...result });
}
