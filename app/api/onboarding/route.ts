import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getDealership, setDealershipOnboarding } from '@/lib/dealerships';
import { getProjectsByDealership, createProject, setProjectRefs, type Project } from '@/lib/projects';
import { createOnboardingTask, completeOnboardingTask } from '@/lib/onboardingTask';
import { setPortalDealerStatus } from '@/lib/portal';
import { getGroup } from '@/lib/groups';
import { addContacts } from '@/lib/contacts';
import { logDecision } from '@/lib/decisions';

export const runtime = 'nodejs';
const COMPANIES_INBOUND = '901105435045';

// POST { action, dealershipId, ... }
//   action 'contacts'  { people: [{name,email,kind?}] }  → link request contacts
//   action 'stage2'    integration approved → create the Companies Inbound onboarding task
//   action 'stage3'    onboarding complete → portal dealer goes live
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as {
      action: string; dealershipId: string;
      people?: { name?: string; email: string; kind?: 'moc' | 'dealer' }[];
    };
    const d = await getDealership(b.dealershipId);
    if (!d) return NextResponse.json({ ok: false, error: 'dealership not found' }, { status: 404 });

    if (b.action === 'contacts') {
      const added = await addContacts({ dealership_id: d.id, group_id: d.group_id, source: 'request', people: b.people || [] });
      return NextResponse.json({ ok: true, added });
    }

    if (b.action === 'stage2') {
      const projects = await getProjectsByDealership(d.id);
      let proj: Project | undefined = projects.find((p) => p.type === 'onboarding');
      if (!proj) proj = await createProject({ type: 'onboarding', dealership_id: d.id });
      // Complete the Feed Approval Pending task if we tracked one.
      const pendingTaskId = (d.platform_fields as Record<string, unknown>)?.pending_task_id as string | undefined;
      if (pendingTaskId) await completeOnboardingTask(pendingTaskId);
      // Owner is the dealer group name when grouped, else the store name (handled in onboardingTask).
      let ownerGroupName: string | null = null;
      if (d.group_id) {
        const g = await getGroup(d.group_id);
        ownerGroupName = g?.name || null;
      }
      const { taskId, warning } = await createOnboardingTask({ dealership: d, projectId: proj.id, listId: COMPANIES_INBOUND, ownerGroupName });
      await setProjectRefs(proj.id, { clickup_task_id: taskId });
      await setDealershipOnboarding(d.id, { lifecycle_stage: 'inbound' });
      await logDecision({ kind: 'lifecycle', type: 'onboarding', dealership_id: d.id, decision: 'stage2', detail: { taskId, warning } });
      return NextResponse.json({ ok: true, taskId, projectId: proj.id, warning });
    }

    if (b.action === 'stage3') {
      await setDealershipOnboarding(d.id, { lifecycle_stage: 'live' });
      let portalError: string | null = null;
      if (d.portal_dealer_id) {
        try {
          await setPortalDealerStatus(d.portal_dealer_id, 'live');
        } catch (e) {
          portalError = (e as Error).message;
        }
      }
      await logDecision({ kind: 'lifecycle', type: 'onboarding', dealership_id: d.id, decision: 'stage3', detail: { portalError } });
      return NextResponse.json({ ok: true, portalError });
    }

    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
