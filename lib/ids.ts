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

// Persistent-entity IDs: no year, zero-padded to 6. Reuses the atomic counter.
async function mintEntityId(prefix: 'GRP' | 'DLR'): Promise<string> {
  const rows = (await sql`
    insert into project_counter (type_year, n)
    values (${prefix}, 1)
    on conflict (type_year) do update set n = project_counter.n + 1
    returning n
  `) as { n: number }[];
  return `${prefix}-${String(rows[0].n).padStart(6, '0')}`;
}

export const mintGroupId = () => mintEntityId('GRP');
export const mintDealershipId = () => mintEntityId('DLR');

// Reserve a contiguous block of `count` ids in one statement (for bulk import).
// Returns the FIRST number in the block; ids are `${prefix}-${pad6(start..start+count-1)}`.
export async function mintEntityIdBlock(prefix: 'GRP' | 'DLR', count: number): Promise<number> {
  const rows = (await sql`
    insert into project_counter (type_year, n)
    values (${prefix}, ${count})
    on conflict (type_year) do update set n = project_counter.n + ${count}
    returning n
  `) as { n: number }[];
  return rows[0].n - count + 1;
}

export function padEntityId(prefix: 'GRP' | 'DLR', n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}
