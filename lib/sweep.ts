import { fetchRecentInbox, fetchThread, tagProcessed, type Msg } from '@/lib/graph';
import { classifyEmail, type Decision } from '@/lib/classify';
import { enqueueAction, type ActionKind } from '@/lib/actions';
import { getProjectByConversation } from '@/lib/projects';
import { logDecision } from '@/lib/decisions';

// The sweep: fetch recent inbox → prefilter → classify → key by conversationId →
// propose actions to the OUTBOX (drafts-first). Nothing auto-executes except the
// processed-tag; the human approves in the OUTBOX. This is the comms-arm front
// door that (later) auto-fires the onboarding lifecycle.

const PROCESSED = 'EZ-Assistant-Processed';
const INTERNAL_DOMAIN = '@ez-wins.com';
const NOISE = /(no[-_.]?reply|donotreply|do-not-reply|mailer-daemon|postmaster|notifications?@|calendar-notification)/i;

function selfEmail(): string {
  return (process.env.MS_USER_EMAIL || '').toLowerCase();
}

// Skip internal senders, obvious noise, and threads we already replied to.
function prefilter(thread: Msg[]): string | null {
  const last = thread[thread.length - 1];
  if (!last) return 'empty';
  const from = (last.from || '').toLowerCase();
  if (from.endsWith(INTERNAL_DOMAIN)) return 'internal';
  if (NOISE.test(from)) return 'noise';
  if (from === selfEmail()) return 'already_replied';
  return null;
}

const OUTCOME_TAG: Record<string, string> = {
  dms_onboarding: 'EZ-Onboarding',
  integration_approval: 'EZ-Approval',
  support_request: 'EZ-Support',
  investigation: 'EZ-Investigation',
  warranty_request: 'EZ-Warranty',
  client_update: 'EZ-Update',
  other: 'EZ-Noise',
};

// Turn a decision into the OUTBOX action(s) to propose. Everything is drafts-first.
async function proposeActions(msg: Msg, decision: Decision): Promise<number> {
  const project = await getProjectByConversation(msg.conversationId);
  const projectId = project?.id || null;
  const base = { conversation_id: msg.conversationId, subject: msg.subject, dealer_name: decision.dealer_name, dms: decision.dms, roster_present: decision.roster_present, from: msg.from };
  const actions: { kind: ActionKind; payload: Record<string, unknown> }[] = [];

  switch (decision.email_type) {
    case 'dms_onboarding':
      // Carry the full decision so approving in the OUTBOX can execute Stage 1.
      actions.push({ kind: 'create_task', payload: { ...base, intent: 'open_onboarding', moc_rep: decision.moc_rep, decision, list: '901113435718' } });
      break;
    case 'integration_approval':
      actions.push({ kind: 'create_task', payload: { ...base, intent: 'stage2_promote' } });
      break;
    case 'support_request':
      actions.push({ kind: 'create_task', payload: { ...base, intent: 'support', list: '901106848667' } });
      break;
    case 'investigation':
    case 'warranty_request':
      actions.push({ kind: 'create_task', payload: { ...base, intent: decision.email_type } });
      break;
    default:
      break;
  }
  if (decision.should_draft && decision.draft) {
    actions.push({ kind: 'draft_reply', payload: { messageId: msg.id, subject: decision.draft.subject, body: decision.draft.body } });
  }

  for (const a of actions) {
    await enqueueAction({ project_id: projectId, conversation_id: msg.conversationId, kind: a.kind, proposed_payload: a.payload });
  }
  return actions.length;
}

export async function runSweep(lookbackHours = 1.5): Promise<{ fetched: number; processed: number; proposed: number; skipped: number; errors: number; byType: Record<string, number>; details: { subject: string; from: string; outcome: string }[] }> {
  const inbox = await fetchRecentInbox(lookbackHours);
  let processed = 0;
  let proposed = 0;
  let skipped = 0;
  let errors = 0;
  const byType: Record<string, number> = {};
  const details: { subject: string; from: string; outcome: string }[] = [];

  for (const msg of inbox) {
    let thread: Msg[];
    try {
      thread = await fetchThread(msg.conversationId);
    } catch {
      thread = [msg];
    }
    const skip = prefilter(thread);
    if (skip) {
      skipped++;
      details.push({ subject: msg.subject, from: msg.from, outcome: `skipped:${skip}` });
      await tagProcessed(msg.id, [PROCESSED, 'EZ-Skip']).catch(() => {});
      continue;
    }
    let decision: Decision;
    try {
      decision = await classifyEmail(thread);
    } catch (e) {
      // classification failed — leave untagged so a later run retries.
      errors++;
      details.push({ subject: msg.subject, from: msg.from, outcome: 'error' });
      await logDecision({ kind: 'sweep_error', decision: 'classify_failed', detail: { conversationId: msg.conversationId, subject: msg.subject, error: (e as Error).message } });
      continue;
    }
    byType[decision.email_type] = (byType[decision.email_type] || 0) + 1;
    const n = await proposeActions(msg, decision);
    proposed += n;
    details.push({ subject: msg.subject, from: msg.from, outcome: `${decision.email_type}${n ? `→proposed` : ''}` });
    await tagProcessed(msg.id, [PROCESSED, OUTCOME_TAG[decision.email_type] || 'EZ-Noise']).catch(() => {});
    processed++;
  }

  // No silent caps: report what was fetched vs acted on.
  await logDecision({ kind: 'sweep', decision: 'complete', detail: { fetched: inbox.length, processed, proposed, skipped, errors, byType } });
  return { fetched: inbox.length, processed, proposed, skipped, errors, byType, details };
}
