import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getDealership, setDealershipOnboarding } from '@/lib/dealerships';
import { getProjectsByDealership, createProject, setProjectRefs, type Project } from '@/lib/projects';
import { createOnboardingTask, completeOnboardingTask } from '@/lib/onboardingTask';
import { setPortalDealerStatus } from '@/lib/portal';
import { getGroup } from '@/lib/groups';
import { addContacts, listContacts } from '@/lib/contacts';
import { buildStage2Email, buildStage3Email, buildDealerEmail } from '@/lib/email';
import { enqueueAction } from '@/lib/actions';
import { logDecision } from '@/lib/decisions';
import { sql } from '@/lib/db';

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
      // Propose the "send us the data" email to the MOC contacts (drafts-first via OUTBOX).
      const mocContacts = await listContacts(d.id, 'moc');
      let emailQueued = false;
      if (mocContacts.length) {
        await enqueueAction({ project_id: proj.id, kind: 'reach_back', proposed_payload: { ...buildStage2Email(d, mocContacts), stage: 'stage2', dealershipId: d.id } });
        emailQueued = true;
      }
      await logDecision({ kind: 'lifecycle', type: 'onboarding', dealership_id: d.id, decision: 'stage2', detail: { taskId, warning, emailQueued } });
      return NextResponse.json({ ok: true, taskId, projectId: proj.id, warning, emailQueued });
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
      // Propose the go-live email to the original request participants.
      const contacts = await listContacts(d.id);
      const projects = await getProjectsByDealership(d.id);
      const proj = projects.find((p) => p.type === 'onboarding');
      let emailQueued = false;
      if (contacts.length) {
        await enqueueAction({ project_id: proj?.id || null, kind: 'send_welcome', proposed_payload: { ...buildStage3Email(d, contacts), stage: 'stage3', dealershipId: d.id } });
        emailQueued = true;
      }
      await logDecision({ kind: 'lifecycle', type: 'onboarding', dealership_id: d.id, decision: 'stage3', detail: { portalError, emailQueued } });
      return NextResponse.json({ ok: true, portalError, emailQueued });
    }

    if (b.action === 'notify_dealer') {
      await setDealershipOnboarding(d.id, { parts_users_onboarded: true });
      const projects = await getProjectsByDealership(d.id);
      const proj = projects.find((p) => p.type === 'onboarding');
      const rows = proj
        ? ((await sql`select distinct email from roster_member where project_id = ${proj.id} and email is not null and email <> ''`) as { email: string }[])
        : [];
      const rosterEmails = rows.map((r) => r.email);
      let emailQueued = false;
      if (rosterEmails.length) {
        await enqueueAction({ project_id: proj?.id || null, kind: 'send_welcome', proposed_payload: { ...buildDealerEmail(d, rosterEmails), stage: 'dealer_notify', dealershipId: d.id } });
        emailQueued = true;
      }
      await logDecision({ kind: 'lifecycle', type: 'onboarding', dealership_id: d.id, decision: 'notify_dealer', detail: { count: rosterEmails.length, emailQueued } });
      return NextResponse.json({ ok: true, count: rosterEmails.length, emailQueued });
    }

    return NextResponse.json({ ok: false, error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
