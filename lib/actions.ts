import { sql } from '@/lib/db';
import { logDecision } from '@/lib/decisions';

// The OUTBOX — proposed actions land here for human approve/edit/reject. Replaces
// the email assistant's drafts-in-Outlook-folder. Every decision logs to
// decision_log (the substrate the brain learns from).

export type ActionKind =
  | 'draft_reply' | 'create_task' | 'reach_back' | 'send_welcome' | 'login_prompt' | 'internal_pull';

export interface Action {
  id: number;
  project_id: string | null;
  conversation_id: string | null;
  kind: ActionKind;
  proposed_payload: Record<string, unknown>;
  state: 'pending' | 'approved' | 'edited' | 'rejected' | 'sent';
  decision: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function enqueueAction(input: {
  project_id?: string | null;
  conversation_id?: string | null;
  kind: ActionKind;
  proposed_payload: Record<string, unknown>;
}): Promise<Action> {
  const rows = (await sql`
    insert into action_queue (project_id, conversation_id, kind, proposed_payload)
    values (${input.project_id || null}, ${input.conversation_id || null}, ${input.kind},
            ${JSON.stringify(input.proposed_payload)}::jsonb)
    returning *
  `) as Action[];
  return rows[0];
}

export async function listActions(state?: string): Promise<Action[]> {
  if (state) {
    return (await sql`select * from action_queue where state = ${state} order by created_at desc`) as Action[];
  }
  return (await sql`select * from action_queue order by created_at desc limit 100`) as Action[];
}

export async function getAction(id: number): Promise<Action | null> {
  const rows = (await sql`select * from action_queue where id = ${id}`) as Action[];
  return rows[0] || null;
}

// Record a decision on an action. `payload` (when editing) replaces proposed_payload.
export async function decideAction(
  id: number,
  state: 'approved' | 'edited' | 'rejected' | 'sent',
  payload?: Record<string, unknown>
): Promise<Action | null> {
  const rows = (await sql`
    update action_queue set
      state = ${state},
      proposed_payload = coalesce(${payload ? JSON.stringify(payload) : null}::jsonb, proposed_payload),
      decision = ${JSON.stringify({ state, at: new Date().toISOString() })}::jsonb,
      updated_at = now()
    where id = ${id}
    returning *
  `) as Action[];
  const action = rows[0] || null;
  if (action) {
    await logDecision({
      kind: 'outbox', dealership_id: null, group_id: null,
      proposal: action.proposed_payload, decision: state, detail: { kind: action.kind, actionId: id },
    });
  }
  return action;
}
