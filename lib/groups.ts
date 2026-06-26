import { sql } from '@/lib/db';
import { mintGroupId } from '@/lib/ids';

export interface DealerGroup {
  id: string;
  name: string;
  billing_email: string | null;
  portal_group_id: string | null;
  outlook_conversation_id: string | null;
  substate: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function createGroup(input: {
  name: string;
  billing_email?: string | null;
  portal_group_id?: string | null;
  outlook_conversation_id?: string | null;
}): Promise<DealerGroup> {
  const id = await mintGroupId();
  const rows = (await sql`
    insert into dealer_group (id, name, billing_email, portal_group_id, outlook_conversation_id)
    values (${id}, ${input.name}, ${input.billing_email || null},
            ${input.portal_group_id || null}, ${input.outlook_conversation_id || null})
    returning *
  `) as DealerGroup[];
  return rows[0];
}

export async function getGroup(id: string): Promise<DealerGroup | null> {
  const rows = (await sql`select * from dealer_group where id = ${id}`) as DealerGroup[];
  return rows[0] || null;
}

export async function getGroupByConversation(conversationId: string): Promise<DealerGroup | null> {
  const rows = (await sql`
    select * from dealer_group where outlook_conversation_id = ${conversationId} limit 1
  `) as DealerGroup[];
  return rows[0] || null;
}

export async function setGroupRefs(
  id: string,
  refs: Partial<Pick<DealerGroup, 'portal_group_id' | 'outlook_conversation_id' | 'billing_email'>>
): Promise<DealerGroup | null> {
  const rows = (await sql`
    update dealer_group set
      portal_group_id = coalesce(${refs.portal_group_id ?? null}::text, portal_group_id),
      outlook_conversation_id = coalesce(${refs.outlook_conversation_id ?? null}::text, outlook_conversation_id),
      billing_email = coalesce(${refs.billing_email ?? null}::text, billing_email),
      updated_at = now()
    where id = ${id}
    returning *
  `) as DealerGroup[];
  return rows[0] || null;
}

export async function listGroups(limit = 100): Promise<DealerGroup[]> {
  return (await sql`select * from dealer_group order by created_at desc limit ${limit}`) as DealerGroup[];
}
