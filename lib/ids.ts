// Typed, per-year, atomic project-ID minting.
// Format: <PREFIX>-<YEAR>-<NNNN>, e.g. ONB-2026-0001.

import { sql } from '@/lib/db';

export const TYPE_PREFIX = {
  onboarding: 'ONB',
  support: 'SUP',
  warranty_uplift: 'WUP',
  investigation: 'INV',
} as const;

export type ProjectType = keyof typeof TYPE_PREFIX;

export const PROJECT_TYPES = Object.keys(TYPE_PREFIX) as ProjectType[];

export function isProjectType(v: unknown): v is ProjectType {
  return typeof v === 'string' && v in TYPE_PREFIX;
}

// Mint the next ID for a type within the current year.
// Atomic: a single upsert-increment statement, so concurrent mints can't collide.
export async function mintProjectId(type: ProjectType): Promise<string> {
  const prefix = TYPE_PREFIX[type];
  const year = new Date().getFullYear();
  const typeYear = `${prefix}-${year}`;
  const rows = (await sql`
    insert into project_counter (type_year, n)
    values (${typeYear}, 1)
    on conflict (type_year) do update set n = project_counter.n + 1
    returning n
  `) as { n: number }[];
  const n = rows[0].n;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
