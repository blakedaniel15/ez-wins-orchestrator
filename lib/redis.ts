import { Redis } from '@upstash/redis';

// Lazy Redis client. Returns null if Redis isn't configured (mirrors the
// fail-open posture in moc-setup-form). Accepts either the Vercel KV_* names
// or the Upstash UPSTASH_* names.
let _redis: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}
