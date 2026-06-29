import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getGroup } from '@/lib/groups';
import { getDealership } from '@/lib/dealerships';
import { getProject, getProjectsByDealership } from '@/lib/projects';
import { fetchThreadInfo } from '@/lib/graph';

export const runtime = 'nodejs';

interface ThreadRef { conversationId: string; source: string }

// GET /api/lookup?id=DLR-000142  (or GRP- / ONB- / SUP- / WUP- / INV-)
// Resolves the ID → its entity → the email thread(s) tied to it, each with a
// subject + an Outlook web link (Graph webLink) to open the conversation.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

  try {
    const refs: ThreadRef[] = [];
    let kind = 'unknown';
    let entity: unknown = null;

    if (id.startsWith('GRP-')) {
      kind = 'group';
      const group = await getGroup(id);
      entity = group;
      if (group?.outlook_conversation_id) refs.push({ conversationId: group.outlook_conversation_id, source: `group ${group.id}` });
    } else if (id.startsWith('DLR-')) {
      kind = 'dealership';
      const dealership = await getDealership(id);
      entity = dealership;
      if (dealership?.group_id) {
        const group = await getGroup(dealership.group_id);
        if (group?.outlook_conversation_id) refs.push({ conversationId: group.outlook_conversation_id, source: `group ${group.id}` });
      }
      if (dealership) {
        for (const p of await getProjectsByDealership(dealership.id)) {
          if (p.outlook_conversation_id) refs.push({ conversationId: p.outlook_conversation_id, source: `project ${p.id}` });
        }
      }
    } else {
      kind = 'project';
      const project = await getProject(id);
      entity = project;
      if (project?.outlook_conversation_id) refs.push({ conversationId: project.outlook_conversation_id, source: `project ${project.id}` });
      if (project?.dealership_id) {
        const dealership = await getDealership(project.dealership_id);
        if (dealership?.group_id) {
          const group = await getGroup(dealership.group_id);
          if (group?.outlook_conversation_id) refs.push({ conversationId: group.outlook_conversation_id, source: `group ${group.id}` });
        }
      }
    }

    if (!entity) return NextResponse.json({ ok: false, error: `No ${kind} found for ${id}.` }, { status: 404 });

    // dedupe conversationIds, fetch thread info for each (best-effort)
    const seen = new Set<string>();
    const threads: Record<string, unknown>[] = [];
    for (const r of refs) {
      if (seen.has(r.conversationId)) continue;
      seen.add(r.conversationId);
      try {
        const info = await fetchThreadInfo(r.conversationId);
        threads.push({ ...r, ...(info || { subject: '(thread not found)', webLink: null, count: 0 }) });
      } catch (e) {
        threads.push({ ...r, subject: null, webLink: null, count: 0, error: (e as Error).message });
      }
    }

    return NextResponse.json({ ok: true, kind, entity, threads });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
