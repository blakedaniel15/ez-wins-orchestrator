import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { Msg } from '@/lib/graph';

// Email classifier — ported prompt from ez-wins-email-assistant, extended for the
// orchestrator's four types + integration-approval detection (see
// lib/prompts/email_classify.md). Returns the decision object the sweep dispatches on.

export interface Decision {
  email_type: 'dms_onboarding' | 'integration_approval' | 'support_request' | 'investigation' | 'warranty_request' | 'client_update' | 'other';
  should_draft: boolean;
  is_support_request: boolean | 'unsure';
  is_onboarding_request: boolean;
  dms: string | null;
  dealer_name: string | null;
  moc_rep: { name: string; email: string } | null;
  roster_present: boolean;
  draft: { subject: string; body: string } | null;
  reasoning: string;
}

const MODEL = 'claude-opus-4-8';

let PROMPT = '';
function prompt(): string {
  if (PROMPT) return PROMPT;
  PROMPT = fs.readFileSync(path.join(process.cwd(), 'lib/prompts/email_classify.md'), 'utf-8');
  return PROMPT;
}

function client(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
  return new Anthropic({ apiKey });
}

function serializeThread(thread: Msg[]): string {
  return thread
    .map((m, i) => [
      `--- Message ${i + 1} ---`,
      `From: ${m.from}`,
      `To: ${m.toRecipients.join(', ')}`,
      `Date: ${m.receivedDateTime}`,
      `Subject: ${m.subject}`,
      '',
      m.body || m.bodyPreview,
    ].join('\n'))
    .join('\n\n');
}

// Strip ```json fences and parse. If the whole string isn't valid JSON (e.g. stray
// prose or a slightly-off wrapper), fall back to the outermost {...} object.
function parseDecision(text: string): Decision {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as Decision;
  } catch {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1)) as Decision;
    throw new Error(`classifier returned unparseable output: ${cleaned.slice(0, 120)}…`);
  }
}

export async function classifyEmail(thread: Msg[]): Promise<Decision> {
  let lastErr: Error | null = null;
  // Retry once — covers a transient API blip or a rare truncated/garbled response.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await client().messages.create({
        model: MODEL,
        max_tokens: 4000, // decisions carry a full draft + task description; 2000 could truncate → invalid JSON
        system: prompt(),
        messages: [{ role: 'user', content: serializeThread(thread) }],
      });
      const block = res.content.find((b) => b.type === 'text');
      const text = block && block.type === 'text' ? block.text : '';
      return parseDecision(text);
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr || new Error('classification failed');
}
