import { neon } from '@neondatabase/serverless';

// Lazy initialization — don't crash the build if DATABASE_URL isn't set yet.
// The error is deferred to the first actual database call at runtime.
// (Mirrors ez-wins-portal/lib/db.ts.)
let _sql: ReturnType<typeof neon> | null = null;

function getSql() {
  if (_sql) return _sql;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Add the Neon integration in Vercel → Storage tab.');
  }
  _sql = neon(databaseUrl);
  return _sql;
}

// Tagged-template proxy that calls getSql() lazily on each invocation.
// Usage: `await sql\`select * from project\``
export const sql: ReturnType<typeof neon> = ((strings: TemplateStringsArray, ...values: any[]) => {
  return (getSql() as any)(strings, ...values);
}) as any;
