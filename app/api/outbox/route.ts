import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { listActions, getAction, decideAction } from '@/lib/actions';
import { sendMail, createOutboundDraft, createDraftReply } from '@/lib/graph';

export const runtime = 'nodejs';

// GET /api/outbox?state=pending → the queue.
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  const state = req.nextUrl.searchParams.get('state') || undefined;
  return NextResponse.json({ ok: true, actions: await listActions(state) });
}

// POST { id, decision: 'approved'|'rejected'|'edited', payload? }
// On approve of a send/draft action, dispatch it via Graph, then mark 'sent'/'approved'.
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const b = (await req.json()) as { id: number; decision: 'approved' | 'rejected' | 'edited'; payload?: Record<string, unknown> };
    if (!b.id) return NextResponse.json({ ok: false, error: 'id is required.' }, { status: 400 });

    if (b.decision === 'rejected') {
      return NextResponse.json({ ok: true, action: await decideAction(b.id, 'rejected') });
    }
    if (b.decision === 'edited') {
      return NextResponse.json({ ok: true, action: await decideAction(b.id, 'edited', b.payload) });
    }

    // approved → dispatch by kind
    const action = await getAction(b.id);
    if (!action) return NextResponse.json({ ok: false, error: 'action not found.' }, { status: 404 });
    const p = { ...(action.proposed_payload || {}), ...(b.payload || {}) } as Record<string, unknown>;

    let dispatchError: string | null = null;
    let finalState: 'approved' | 'sent' = 'approved';
    try {
      if (action.kind === 'draft_reply' && p.messageId) {
        await createDraftReply(String(p.messageId), String(p.body || ''));
        finalState = 'approved';
      } else if (action.kind === 'reach_back' || action.kind === 'send_welcome' || action.kind === 'login_prompt') {
        const to = (p.to as string[]) || [];
        if (p.html) {
          await sendMail({ to, cc: p.cc as string[] | undefined, subject: String(p.subject || ''), html: String(p.html) });
        } else {
          await createOutboundDraft(to, String(p.subject || ''), String(p.body || ''));
        }
        finalState = p.html ? 'sent' : 'approved';
      }
    } catch (e) {
      dispatchError = (e as Error).message;
    }

    const updated = await decideAction(b.id, finalState, b.payload);
    return NextResponse.json({ ok: !dispatchError, action: updated, dispatchError });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
