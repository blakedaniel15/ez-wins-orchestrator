import { sql } from '@/lib/db';
import { mintDealershipId } from '@/lib/ids';

export interface Dealership {
  id: string;
  group_id: string | null;
  name: string;
  dms: string | null;
  conduit: string | null;
  oems: string[];
  portal_dealer_id: string | null;
  status: string;
  substate: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function createDealership(input: {
  name: string;
  group_id?: string | null;
  dms?: string | null;
  conduit?: string | null;
  oems?: string[];
  portal_dealer_id?: string | null;
  status?: string;
}): Promise<Dealership> {
  const id = await mintDealershipId();
  const rows = (await sql`
    insert into dealership (id, group_id, name, dms, conduit, oems, portal_dealer_id, status)
    values (
      ${id}, ${input.group_id || null}, ${input.name}, ${input.dms || null}, ${input.conduit || null},
      ${JSON.stringify(input.oems || [])}::jsonb, ${input.portal_dealer_id || null},
      ${input.status || 'prospect'}
    )
    returning *
  `) as Dealership[];
  return rows[0];
}

export async function getDealership(id: string): Promise<Dealership | null> {
  const rows = (await sql`select * from dealership where id = ${id}`) as Dealership[];
  return rows[0] || null;
}

export async function findDealershipsByName(name: string): Promise<Dealership[]> {
  return (await sql`
    select * from dealership where lower(name) = lower(${name}) order by created_at desc
  `) as Dealership[];
}

export async function listDealershipsByGroup(groupId: string): Promise<Dealership[]> {
  return (await sql`select * from dealership where group_id = ${groupId} order by created_at asc`) as Dealership[];
}

export async function listDealerships(limit = 100): Promise<Dealership[]> {
  return (await sql`select * from dealership order by created_at desc limit ${limit}`) as Dealership[];
}

export async function setDealershipRefs(
  id: string,
  refs: Partial<Pick<Dealership, 'portal_dealer_id' | 'group_id' | 'dms' | 'conduit' | 'status'>>
): Promise<Dealership | null> {
  const rows = (await sql`
    update dealership set
      portal_dealer_id = coalesce(${refs.portal_dealer_id ?? null}::text, portal_dealer_id),
      group_id = coalesce(${refs.group_id ?? null}::text, group_id),
      dms = coalesce(${refs.dms ?? null}::text, dms),
      conduit = coalesce(${refs.conduit ?? null}::text, conduit),
      status = coalesce(${refs.status ?? null}::text, status),
      updated_at = now()
    where id = ${id}
    returning *
  `) as Dealership[];
  return rows[0] || null;
}
