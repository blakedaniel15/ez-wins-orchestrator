import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getGroupByConversation } from '@/lib/groups';
import { listDealershipsByGroup, getDealership } from '@/lib/dealerships';
import { getProjectByConversation, getProjectsByDealership } from '@/lib/projects';

export const runtime = 'nodejs';

// Resolve a thread to its entity chain. A group deal thread -> group + its dealerships +
// their projects. A single-engagement thread -> the project + its dealership.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const conversationId = req.nextUrl.searchParams.get('conversationId');
  if (!conversationId) {
    return NextResponse.json({ ok: false, error: 'conversationId required.' }, { status: 400 });
  }
  try {
    const group = await getGroupByConversation(conversationId);
    if (group) {
      const dealerships = await listDealershipsByGroup(group.id);
      // Fan out: attach each dealership's projects so the chain is complete.
      const withProjects = await Promise.all(
        dealerships.map(async (d) => ({ ...d, projects: await getProjectsByDealership(d.id) }))
      );
      const projectCount = withProjects.reduce((n, d) => n + d.projects.length, 0);
      return NextResponse.json({ ok: true, kind: 'group', group, dealerships: withProjects, projectCount });
    }
    const project = await getProjectByConversation(conversationId);
    if (project) {
      const dealership = project.dealership_id ? await getDealership(project.dealership_id) : null;
      const siblings = dealership ? await getProjectsByDealership(dealership.id) : [project];
      return NextResponse.json({ ok: true, kind: 'project', project, dealership, projects: siblings });
    }
    return NextResponse.json({ ok: true, kind: 'none' });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
