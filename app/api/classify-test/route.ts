import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getToken, searchMessagesBySubject, fetchThread } from '@/lib/graph';
import { classifyEmail } from '@/lib/classify';

export const runtime = 'nodejs';
export const maxDuration = 120;

// DRY RUN — classify a single real thread with NO side effects (no category tag,
// no OUTBOX write). For evaluating classification + draft quality on a real email.
//   /api/classify-test?subject=<part of the subject>
//   /api/classify-test?conversationId=<id>
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const sp = req.nextUrl.searchParams;
    let conversationId = sp.get('conversationId') || '';
    let matches: { subject: string; from: string; conversationId: string }[] = [];

    if (!conversationId) {
      const subject = sp.get('subject');
      if (!subject) return NextResponse.json({ ok: false, error: 'pass ?subject= or ?conversationId=' }, { status: 400 });
      const token = await getToken();
      const found = await searchMessagesBySubject(token, subject);
      matches = found.map((m) => ({ subject: m.subject || '', from: m.from?.emailAddress?.address || '', conversationId: m.conversationId }));
      if (!found.length) return NextResponse.json({ ok: false, error: `no message matched subject "${subject}"` }, { status: 404 });
      conversationId = found[0].conversationId;
    }

    const thread = await fetchThread(conversationId);
    if (!thread.length) return NextResponse.json({ ok: false, error: 'thread has no messages' }, { status: 404 });
    const decision = await classifyEmail(thread);

    return NextResponse.json({
      ok: true,
      conversationId,
      matchedFrom: sp.get('subject') ? matches.slice(0, 5) : undefined,
      thread: thread.map((m) => ({ from: m.from, subject: m.subject, date: m.receivedDateTime })),
      decision,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
