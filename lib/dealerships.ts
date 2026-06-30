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
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  region: string | null;
  brand: string | null;
  door_rate: string;
  platform_fields: Record<string, unknown>;
  lifecycle_stage: string;
  parts_users_onboarded: boolean;
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
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  region?: string | null;
  brand?: string | null;
  platform_fields?: Record<string, unknown>;
  lifecycle_stage?: string;
}): Promise<Dealership> {
  const id = await mintDealershipId();
  const rows = (await sql`
    insert into dealership (
      id, group_id, name, dms, conduit, oems, portal_dealer_id, status,
      address, city, state, zip, region, brand, platform_fields, lifecycle_stage
    )
    values (
      ${id}, ${input.group_id || null}, ${input.name}, ${input.dms || null}, ${input.conduit || null},
      ${JSON.stringify(input.oems || [])}::jsonb, ${input.portal_dealer_id || null},
      ${input.status || 'prospect'},
      ${input.address || null}, ${input.city || null}, ${input.state || null}, ${input.zip || null},
      ${input.region || null}, ${input.brand || null},
      ${JSON.stringify(input.platform_fields || {})}::jsonb, ${input.lifecycle_stage || 'pending'}
    )
    returning *
  `) as Dealership[];
  return rows[0];
}

export async function setDealershipOnboarding(
  id: string,
  f: Partial<Pick<Dealership, 'address' | 'city' | 'state' | 'zip' | 'region' | 'brand' | 'lifecycle_stage' | 'parts_users_onboarded'>> & { platform_fields?: Record<string, unknown> }
): Promise<Dealership | null> {
  const rows = (await sql`
    update dealership set
      address = coalesce(${f.address ?? null}::text, address),
      city = coalesce(${f.city ?? null}::text, city),
      state = coalesce(${f.state ?? null}::text, state),
      zip = coalesce(${f.zip ?? null}::text, zip),
      region = coalesce(${f.region ?? null}::text, region),
      brand = coalesce(${f.brand ?? null}::text, brand),
      lifecycle_stage = coalesce(${f.lifecycle_stage ?? null}::text, lifecycle_stage),
      parts_users_onboarded = coalesce(${f.parts_users_onboarded ?? null}::boolean, parts_users_onboarded),
      platform_fields = coalesce(${f.platform_fields ? JSON.stringify(f.platform_fields) : null}::jsonb, platform_fields),
      updated_at = now()
    where id = ${id}
    returning *
  `) as Dealership[];
  return rows[0] || null;
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
