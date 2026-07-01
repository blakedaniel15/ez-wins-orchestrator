import { findDealershipsByName, createDealership, setDealershipRefs, setDealershipOnboarding, type Dealership } from '@/lib/dealerships';
import { createOrLinkPortalDealer } from '@/lib/portal';
import { addContacts } from '@/lib/contacts';
import { createProject, getProjectsByDealership, setProjectRefs } from '@/lib/projects';
import { createOnboardingTask } from '@/lib/onboardingTask';
import { dmsToConduit } from '@/lib/dms';
import { logDecision } from '@/lib/decisions';

const FEED_APPROVAL_PENDING = '901113435718';

// A classified onboarding decision (loose — carries the classifier's nested fields).
export interface OnboardingDecision {
  dealer_name?: string | null;
  dms?: string | null;
  moc_rep?: { name?: string; email?: string } | null;
  dms_onboarding?: {
    dealer_or_group_name?: string;
    dealer_contact_first_name?: string;
    dealer_contact_email?: string;
    dms?: string;
    store_list?: string[];
  } | null;
}

// Open onboarding from a decision: resolve/create the dealership (+ portal pipeline),
// link the MOC rep + dealer contacts, mint the project, and create the Feed Approval
// Pending task. Idempotent-ish: reuses an existing dealership matched by name.
export async function openOnboardingFromDecision(
  decision: OnboardingDecision,
  conversationId?: string | null
): Promise<{ dealershipId: string; taskId: string; projectId: string; created: boolean }> {
  const name = (decision.dealer_name || decision.dms_onboarding?.dealer_or_group_name || '').trim();
  if (!name) throw new Error('no dealer name in the decision');
  const dms = decision.dms_onboarding?.dms || decision.dms || null;

  // Resolve or create the dealership + portal pipeline entry.
  const existing = await findDealershipsByName(name);
  let dealership: Dealership;
  let created = false;
  if (existing.length) {
    dealership = existing[0];
  } else {
    dealership = await createDealership({ name, dms, conduit: dmsToConduit(dms), lifecycle_stage: 'pending' });
    created = true;
    try {
      const pd = await createOrLinkPortalDealer({ dealershipId: dealership.id, name: dealership.name, dms: dealership.dms });
      await setDealershipRefs(dealership.id, { portal_dealer_id: pd.portalDealerId });
      dealership.portal_dealer_id = pd.portalDealerId;
    } catch { /* portal push best-effort */ }
  }

  // Contacts: MOC rep (internal) + the dealer contact (external), from the request.
  const people: { name?: string; email: string; kind?: 'moc' | 'dealer' }[] = [];
  if (decision.moc_rep?.email) people.push({ name: decision.moc_rep.name, email: decision.moc_rep.email, kind: 'moc' });
  const dc = decision.dms_onboarding;
  if (dc?.dealer_contact_email) people.push({ name: dc.dealer_contact_first_name, email: dc.dealer_contact_email, kind: 'dealer' });
  if (people.length) await addContacts({ dealership_id: dealership.id, source: 'onboarding_email', people });

  // Project + Feed Approval Pending task.
  const projects = await getProjectsByDealership(dealership.id);
  let proj = projects.find((p) => p.type === 'onboarding');
  if (!proj) proj = await createProject({ type: 'onboarding', dealership_id: dealership.id });
  const { taskId } = await createOnboardingTask({ dealership, projectId: proj.id, listId: FEED_APPROVAL_PENDING });
  await setProjectRefs(proj.id, { clickup_task_id: taskId, outlook_conversation_id: conversationId || undefined });
  await setDealershipOnboarding(dealership.id, { lifecycle_stage: 'pending', platform_fields: { ...(dealership.platform_fields || {}), pending_task_id: taskId } });

  await logDecision({ kind: 'onboarding_opened', type: 'onboarding', dealership_id: dealership.id, decision: 'stage1', detail: { taskId, created, conversationId } });
  return { dealershipId: dealership.id, taskId, projectId: proj.id, created };
}
