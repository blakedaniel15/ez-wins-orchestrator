import { sql } from '@/lib/db';

// Append a decision to the log (the substrate the brain learns from): every
// confirm/edit/reject on an automation proposal, dealership-anchored + type-faceted.
export async function logDecision(entry: {
  kind: string;
  type?: string | null;
  dealership_id?: string | null;
  group_id?: string | null;
  proposal?: unknown;
  decision: string;            // confirmed | edited | rejected
  detail?: unknown;
}): Promise<void> {
  await sql`
    insert into decision_log (kind, type, dealership_id, group_id, proposal, decision, detail)
    values (${entry.kind}, ${entry.type || null}, ${entry.dealership_id || null}, ${entry.group_id || null},
            ${JSON.stringify(entry.proposal || {})}::jsonb, ${entry.decision},
            ${JSON.stringify(entry.detail || {})}::jsonb)
  `;
}
