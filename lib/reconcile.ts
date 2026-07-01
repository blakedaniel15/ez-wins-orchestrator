import { getTask, writeDealerIdField, writeProjectIdField } from '@/lib/clickup';
import { listDealerships } from '@/lib/dealerships';
import { getProjectsByDealership, createProject } from '@/lib/projects';
import { similarity } from '@/lib/match';
import { enqueueAction } from '@/lib/actions';
import { logDecision } from '@/lib/decisions';

// Reconcile a form/email-created ClickUp task back to a dealership: fuzzy-match by
// name, stamp the Dealer ID + project id if the task lacks them. No confident
// match → surface the orphan in the OUTBOX for a human to resolve.

const MATCH_THRESHOLD = 0.6;

export async function reconcileTask(taskId: string): Promise<{ matched: boolean; dealershipId?: string; score?: number }> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Task ${taskId} not found.`);

  // Already stamped? (a non-empty dealer_id custom field)
  const dealerField = (task.custom_fields || []).find((c) => c.name === 'dealer_id');
  if (dealerField && dealerField.value) {
    return { matched: true, dealershipId: String(dealerField.value) };
  }

  const dealerships = await listDealerships(500);
  let best: { id: string; score: number } | null = null;
  for (const d of dealerships) {
    const s = similarity(task.name, d.name);
    if (!best || s > best.score) best = { id: d.id, score: s };
  }

  if (best && best.score >= MATCH_THRESHOLD) {
    // Ensure an onboarding project exists, then stamp both ids.
    const projects = await getProjectsByDealership(best.id);
    let proj = projects.find((p) => p.type === 'onboarding');
    if (!proj) proj = await createProject({ type: 'onboarding', dealership_id: best.id });
    await writeDealerIdField(taskId, best.id);
    await writeProjectIdField(taskId, proj.id);
    await logDecision({ kind: 'reconcile', dealership_id: best.id, decision: 'matched', detail: { taskId, score: best.score } });
    return { matched: true, dealershipId: best.id, score: best.score };
  }

  // No confident match → orphan → OUTBOX for human resolution.
  await enqueueAction({
    kind: 'create_task',
    proposed_payload: { intent: 'reconcile_orphan', taskId, taskName: task.name, bestScore: best?.score ?? 0 },
  });
  await logDecision({ kind: 'reconcile', decision: 'orphan', detail: { taskId, taskName: task.name, bestScore: best?.score ?? 0 } });
  return { matched: false, score: best?.score };
}
