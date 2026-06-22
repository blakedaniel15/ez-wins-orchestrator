import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  safeEqual,
  createAdminSession,
  destroyAdminSession,
} from '@/lib/security';

export const runtime = 'nodejs';

const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export async function POST(req: NextRequest) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'ADMIN_PASSWORD is not configured.' }, { status: 500 });
  }
  if (!safeEqual(password, expected)) {
    return NextResponse.json({ ok: false, error: 'Wrong password.' }, { status: 401 });
  }
  const token = await createAdminSession();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Session storage (Redis) is unavailable.' },
      { status: 500 }
    );
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  await destroyAdminSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
