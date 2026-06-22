// Single-user auth for the internal orchestrator page.
// Ported from moc-setup-form/lib/security.js: login mints a random opaque token
// stored server-side in Redis; the cookie holds the token, not the password, so
// a leaked cookie exposes a revocable session rather than the admin password.

import crypto from 'crypto';
import { cookies } from 'next/headers';
import { getRedisClient } from '@/lib/redis';

export const ADMIN_COOKIE = 'orch_session';
const ADMIN_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const adminSessionKey = (token: string) => `admin_session:${token}`;

// Constant-time secret comparison — avoids leaking the password via timing.
export function safeEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Returns a new session token, or null if Redis is unavailable.
export async function createAdminSession(): Promise<string | null> {
  const r = getRedisClient();
  if (!r) return null;
  const token = crypto.randomBytes(32).toString('hex');
  await r.set(adminSessionKey(token), '1', { ex: ADMIN_SESSION_TTL_SECONDS });
  return token;
}

export async function validateAdminSession(token: string | undefined): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const r = getRedisClient();
  if (!r) return false;
  const exists = await r.get(adminSessionKey(token));
  return exists != null;
}

export async function destroyAdminSession(token: string | undefined): Promise<void> {
  if (!token) return;
  const r = getRedisClient();
  if (!r) return;
  await r.del(adminSessionKey(token));
}

// Guard for internal API routes. Returns true if the request carries a valid
// admin session cookie. Use at the top of every guarded handler.
export async function isAuthed(): Promise<boolean> {
  const token = cookies().get(ADMIN_COOKIE)?.value;
  return validateAdminSession(token);
}

// Standard 401 short-circuit for guarded routes.
export function unauthorized(): Response {
  return Response.json({ ok: false, error: 'Not authenticated.' }, { status: 401 });
}
