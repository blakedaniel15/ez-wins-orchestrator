import { sql } from '@/lib/db';
import { enqueueAction } from '@/lib/actions';

// Generalized follow-up cadence, ported from ez-wins-email-assistant/lib/followups.js.
// The onboarding ladder (business days unless noted), anchored on when the first
// email was actually SENT, stopping the moment anyone replies or the stage advances:
//   step 1  nudge 1   +2 business days
//   step 2  nudge 2   +3 bd after step 1
//   step 3  nudge 3   +3 bd after step 2
//   step 4  last-ditch +7 CALENDAR days after step 3, rolled to next business day
//   step 5  moc rep   +3 bd after step 4
//   step 6  call task +5 bd after step 5
// The ladder is per-type via `track`; onboarding uses the 'customer' track. Other
// tracks (moc_rep/missing_email/integration_chase) reuse the same math.

export interface LadderStep {
  kind: 'nudge1' | 'nudge2' | 'nudge3' | 'lastditch' | 'moc' | 'call';
  businessDays?: number;
  calendarDaysRolled?: number;
}

export const CUSTOMER_LADDER: LadderStep[] = [
  { kind: 'nudge1', businessDays: 2 },
  { kind: 'nudge2', businessDays: 3 },
  { kind: 'nudge3', businessDays: 3 },
  { kind: 'lastditch', calendarDaysRolled: 7 },
  { kind: 'moc', businessDays: 3 },
  { kind: 'call', businessDays: 5 },
];

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

// Add N business days (skips Sat/Sun). Operates on calendar days in UTC — good
// enough for a due-date clock; the sweep only compares next_due <= now.
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) added++;
  }
  return d;
}

// Add N calendar days, then roll forward to the next business day if it lands on a weekend.
export function addCalendarDaysRolled(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  d.setUTCDate(d.getUTCDate() + n);
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// The due date for a given 1-based step, cumulative from the anchor (the send time).
export function nextDue(anchor: Date, step: number, ladder: LadderStep[] = CUSTOMER_LADDER): Date {
  let d = new Date(anchor.getTime());
  for (let i = 0; i < step && i < ladder.length; i++) {
    const s = ladder[i];
    d = s.calendarDaysRolled != null ? addCalendarDaysRolled(d, s.calendarDaysRolled) : addBusinessDays(d, s.businessDays || 0);
  }
  return d;
}

export const LADDER_LEN = CUSTOMER_LADDER.length;

// ── cadence table CRUD ───────────────────────────────────────────────

export interface Cadence {
  id: number;
  project_id: string;
  type: string;
  track: string;
  anchor_sent_at: string | null;
  next_due: string | null;
  step: number;
  stopped_reason: string | null;
}

export async function startCadence(input: {
  project_id: string; type: string; track: string; anchorSentAt: Date;
}): Promise<Cadence> {
  const due = nextDue(input.anchorSentAt, 1);
  const rows = (await sql`
    insert into cadence (project_id, type, track, anchor_sent_at, next_due, step)
    values (${input.project_id}, ${input.type}, ${input.track}, ${input.anchorSentAt.toISOString()}, ${due.toISOString()}, 0)
    returning *
  `) as Cadence[];
  return rows[0];
}

// Rows whose next_due has passed and that are still active.
export async function dueCadences(now: Date): Promise<Cadence[]> {
  return (await sql`
    select * from cadence
    where stopped_reason is null and next_due is not null and next_due <= ${now.toISOString()}
    order by next_due asc
  `) as Cadence[];
}

// Advance a cadence to the next ladder step (or stop it if the ladder is exhausted).
export async function advanceCadence(c: Cadence): Promise<void> {
  const nextStep = c.step + 1;
  if (nextStep >= LADDER_LEN || !c.anchor_sent_at) {
    await sql`update cadence set stopped_reason = 'ladder_complete', updated_at = now() where id = ${c.id}`;
    return;
  }
  const due = nextDue(new Date(c.anchor_sent_at), nextStep + 1);
  await sql`update cadence set step = ${nextStep}, next_due = ${due.toISOString()}, updated_at = now() where id = ${c.id}`;
}

export async function stopCadence(projectId: string, reason: string): Promise<void> {
  await sql`update cadence set stopped_reason = ${reason}, updated_at = now() where project_id = ${projectId} and stopped_reason is null`;
}

// Cron tick: for each due cadence, propose the step's nudge to the OUTBOX (drafts-first)
// and advance the ladder. Reply/stage-advance stops are applied via stopCadence elsewhere.
export async function tickCadence(now: Date): Promise<{ fired: number }> {
  const due = await dueCadences(now);
  for (const c of due) {
    const step = CUSTOMER_LADDER[c.step] || CUSTOMER_LADDER[CUSTOMER_LADDER.length - 1];
    const kind = step.kind === 'call' ? 'internal_pull' : step.kind === 'moc' ? 'reach_back' : 'draft_reply';
    await enqueueAction({
      project_id: c.project_id,
      kind,
      proposed_payload: { cadence: true, track: c.track, ladderStep: step.kind, cadenceId: c.id },
    });
    await advanceCadence(c);
  }
  return { fired: due.length };
}
