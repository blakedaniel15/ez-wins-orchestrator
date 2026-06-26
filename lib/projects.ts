import { sql } from '@/lib/db';
import { mintProjectId, type ProjectType } from '@/lib/ids';

export interface Project {
  id: string;
  type: ProjectType;
  dealership_id: string | null;
  status: string;
  substate: Record<string, unknown>;
  outlook_conversation_id: string | null;
  clickup_task_id: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export async function createProject(input: { type: ProjectType; dealership_id: string }): Promise<Project> {
  const id = await mintProjectId(input.type);
  const rows = (await sql`
    insert into project (id, type, dealership_id)
    values (${id}, ${input.type}, ${input.dealership_id})
    returning *
  `) as Project[];
  return rows[0];
}

export async function getProject(id: string): Promise<Project | null> {
  const rows = (await sql`select * from project where id = ${id}`) as Project[];
  return rows[0] || null;
}

export async function getProjectsByDealership(dealershipId: string): Promise<Project[]> {
  return (await sql`
    select * from project where dealership_id = ${dealershipId} order by created_at desc
  `) as Project[];
}

// Dedup: existing projects of a type for a dealership (warn before minting a duplicate engagement).
export async function findProjectsByDealership(dealershipId: string, type: ProjectType): Promise<Project[]> {
  return (await sql`
    select * from project where dealership_id = ${dealershipId} and type = ${type} order by created_at desc
  `) as Project[];
}

export async function getProjectByConversation(conversationId: string): Promise<Project | null> {
  const rows = (await sql`
    select * from project where outlook_conversation_id = ${conversationId} limit 1
  `) as Project[];
  return rows[0] || null;
}

export async function listProjects(limit = 100): Promise<Project[]> {
  return (await sql`select * from project order by created_at desc limit ${limit}`) as Project[];
}

export async function setProjectRefs(
  id: string,
  refs: Partial<Pick<Project, 'clickup_task_id' | 'outlook_conversation_id' | 'status'>>
): Promise<Project | null> {
  const rows = (await sql`
    update project set
      clickup_task_id = coalesce(${refs.clickup_task_id ?? null}::text, clickup_task_id),
      outlook_conversation_id = coalesce(${refs.outlook_conversation_id ?? null}::text, outlook_conversation_id),
      status = coalesce(${refs.status ?? null}::text, status),
      updated_at = now()
    where id = ${id}
    returning *
  `) as Project[];
  return rows[0] || null;
}
