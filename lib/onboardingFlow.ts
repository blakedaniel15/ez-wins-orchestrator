import { findDealershipsByName, createDealership, setDealershipRefs, setDealershipOnboarding, type Dealership } from '@/lib/dealerships';
import { createOrLinkPortalDealer, setPortalDealerRegion, createOrLinkPortalGroup, setPortalDealerGroup } from '@/lib/portal';
import { addContacts } from '@/lib/contacts';
import { createProject, getProjectsByDealership, setProjectRefs } from '@/lib/projects';
import { createOnboardingTask } from '@/lib/onboardingTask';
import { listGroups, createGroup, setGroupRefs } from '@/lib/groups';
import { similarity } from '@/lib/match';
import { dmsToConduit } from '@/lib/dms';
import { regionForRep } from '@/lib/team';
import { logDecision } from '@/lib/decisions';

const FEED_APPROVAL_PENDING = '901113435718';
const GROUP_MATCH_THRESHOLD = 0.7;

// Match an existing group by name, else create it. Ensures the portal group too.
async function resolveGroup(
  groupName: string,
  conversationId?: string | null
): Promise<{ groupId: string; portalGroupId: string | null; created: boolean; matchedName: string }> {
  const groups = await listGroups(500);
  let best: { id: string; name: string; portal: string | null; score: number } | null = null;
  for (const g of groups) {
    const s = similarity(groupName, g.name);
    if (!best || s > best.score) best = { id: g.id, name: g.name, portal: g.portal_group_id, score: s };
  }
  if (best && best.score >= GROUP_MATCH_THRESHOLD) {
    // Existing group — ensure it has a portal group.
    let portalGroupId = best.portal;
    if (!portalGroupId) {
      const pg = await createOrLinkPortalGroup({ groupId: best.id, name: best.name });
      portalGroupId = pg.portalGroupId;
      await setGroupRefs(best.id, { portal_group_id: portalGroupId });
    }
    return { groupId: best.id, portalGroupId, created: false, matchedName: best.name };
  }
  // No confident match — create the group.
  const g = await createGroup({ name: groupName, outlook_conversation_id: conversationId || null });
  const pg = await createOrLinkPortalGroup({ groupId: g.id, name: g.name });
  await setGroupRefs(g.id, { portal_group_id: pg.portalGroupId });
  return { groupId: g.id, portalGroupId: pg.portalGroupId, created: true, matchedName: g.name };
}

// A classified onboarding decision (loose — carries the classifier's nested fields).
export interface OnboardingDecision {
  dealer_name?: string | null;
  group_name?: string | null;
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
): Promise<{ dealershipId: string; taskId: string; projectId: string; created: boolean; group: { groupId: string; matchedName: string; created: boolean } | null }> {
  const name = (decision.dealer_name || decision.dms_onboarding?.dealer_or_group_name || '').trim();
  if (!name) throw new Error('no dealer name in the decision');
  const dms = decision.dms_onboarding?.dms || decision.dms || null;
  // The introducing MOC rep drives the region (no address needed at intro time).
  const region = await regionForRep(decision.moc_rep?.email, decision.moc_rep?.name);

  // Resolve or create the dealership + portal pipeline entry.
  const existing = await findDealershipsByName(name);
  let dealership: Dealership;
  let created = false;
  if (existing.length) {
    dealership = existing[0];
    // Backfill region from the rep if it's still blank.
    if (region && !dealership.region) {
      dealership = (await setDealershipOnboarding(dealership.id, { region })) || dealership;
    }
  } else {
    dealership = await createDealership({ name, dms, conduit: dmsToConduit(dms), region, lifecycle_stage: 'pending' });
    created = true;
    try {
      const pd = await createOrLinkPortalDealer({ dealershipId: dealership.id, name: dealership.name, dms: dealership.dms });
      await setDealershipRefs(dealership.id, { portal_dealer_id: pd.portalDealerId });
      dealership.portal_dealer_id = pd.portalDealerId;
    } catch { /* portal push best-effort */ }
  }
  // Push the region onto the portal dealer (best-effort).
  if (region && dealership.portal_dealer_id) {
    try { await setPortalDealerRegion(dealership.portal_dealer_id, region); } catch { /* best-effort */ }
  }

  // Group: match an existing group or create it, then assign the dealership to it.
  let group: { groupId: string; matchedName: string; created: boolean } | null = null;
  const groupName = (decision.group_name || '').trim();
  if (groupName && !dealership.group_id) {
    try {
      const g = await resolveGroup(groupName, conversationId);
      await setDealershipRefs(dealership.id, { group_id: g.groupId });
      dealership.group_id = g.groupId;
      if (dealership.portal_dealer_id && g.portalGroupId) {
        try { await setPortalDealerGroup(dealership.portal_dealer_id, g.portalGroupId); } catch { /* best-effort */ }
      }
      group = { groupId: g.groupId, matchedName: g.matchedName, created: g.created };
    } catch { /* group best-effort — never block onboarding */ }
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
  const { taskId } = await createOnboardingTask({ dealership, projectId: proj.id, listId: FEED_APPROVAL_PENDING, ownerGroupName: group?.matchedName || null, requestedBy: decision.moc_rep?.name || null });
  await setProjectRefs(proj.id, { clickup_task_id: taskId, outlook_conversation_id: conversationId || undefined });
  await setDealershipOnboarding(dealership.id, { lifecycle_stage: 'pending', platform_fields: { ...(dealership.platform_fields || {}), pending_task_id: taskId } });

  await logDecision({ kind: 'onboarding_opened', type: 'onboarding', dealership_id: dealership.id, group_id: group?.groupId, decision: 'stage1', detail: { taskId, created, conversationId, region, group } });
  return { dealershipId: dealership.id, taskId, projectId: proj.id, created, group };
}
