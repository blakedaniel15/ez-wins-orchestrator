// The project registry — the keystone table. Create/read/update project rows
// and resolve a project from its Outlook conversation id (the dedup key).

import { sql } from '@/lib/db';
import { mintProjectId, type ProjectType } from '@/lib/ids';

export interface Project {
  id: string;
  type: ProjectType;
  status: string;
  substate: Record<string, unknown>;
  dms: string | null;
  conduit: string | null;
  dealer_name: string | null;
  group_name: string | null;
  moc_reps: unknown[];
  outlook_conversation_id: string | null;
  clickup_task_id: string | null;
  portal_dealer_id: string | null;
  warranty_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectInput {
  type: ProjectType;
  dealer_name?: string | null;
  group_name?: string | null;
  dms?: string | null;
  conduit?: string | null;
  moc_reps?: unknown[];
}

// Mint an ID and insert the registry row. Returns the new project.
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const id = await mintProjectId(input.type);
  const rows = (await sql`
    insert into project (id, type, dealer_name, group_name, dms, conduit, moc_reps)
    values (
      ${id}, ${input.type}, ${input.dealer_name || null}, ${input.group_name || null},
      ${input.dms || null}, ${input.conduit || null}, ${JSON.stringify(input.moc_reps || [])}::jsonb
    )
    returning *
  `) as Project[];
  return rows[0];
}

export async function getProject(id: string): Promise<Project | null> {
  const rows = (await sql`select * from project where id = ${id}`) as Project[];
  return rows[0] || null;
}

// Resolve a project from an Outlook thread — the idempotency key every later
// phase relies on.
export async function getProjectByConversation(conversationId: string): Promise<Project | null> {
  const rows = (await sql`
    select * from project where outlook_conversation_id = ${conversationId} limit 1
  `) as Project[];
  return rows[0] || null;
}

// Dedup helper: existing projects for the same dealer name (case-insensitive),
// optionally scoped to a type. Used to warn before minting a duplicate.
export async function findProjectsByDealer(dealerName: string, type?: ProjectType): Promise<Project[]> {
  if (type) {
    return (await sql`
      select * from project
      where lower(dealer_name) = lower(${dealerName}) and type = ${type}
      order by created_at desc
    `) as Project[];
  }
  return (await sql`
    select * from project
    where lower(dealer_name) = lower(${dealerName})
    order by created_at desc
  `) as Project[];
}

export async function listProjects(limit = 100): Promise<Project[]> {
  return (await sql`
    select * from project order by created_at desc limit ${limit}
  `) as Project[];
}

// Patch the cross-system reference columns (and conversation id) on a project.
export async function setProjectRefs(
  id: string,
  refs: Partial<Pick<Project,
    'clickup_task_id' | 'portal_dealer_id' | 'outlook_conversation_id' | 'warranty_project_id' | 'status'>>
): Promise<Project | null> {
  const rows = (await sql`
    update project set
      clickup_task_id = coalesce(${refs.clickup_task_id ?? null}::text, clickup_task_id),
      portal_dealer_id = coalesce(${refs.portal_dealer_id ?? null}::text, portal_dealer_id),
      outlook_conversation_id = coalesce(${refs.outlook_conversation_id ?? null}::text, outlook_conversation_id),
      warranty_project_id = coalesce(${refs.warranty_project_id ?? null}::text, warranty_project_id),
      status = coalesce(${refs.status ?? null}::text, status),
      updated_at = now()
    where id = ${id}
    returning *
  `) as Project[];
  return rows[0] || null;
}
