import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { getGraphToken, searchMessagesBySubject, tagThread, projectCategory } from '@/lib/graph';
import { setProjectRefs } from '@/lib/projects';

export const runtime = 'nodejs';

// GET /api/wire/outlook?search=subject → find threads to tag (convenience so a
// conversationId doesn't have to be hand-copied).
export async function GET(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const q = req.nextUrl.searchParams.get('search');
    if (!q) return NextResponse.json({ ok: false, error: 'search query required.' }, { status: 400 });
    const token = await getGraphToken();
    const messages = await searchMessagesBySubject(token, q);
    // Collapse to unique threads.
    const seen = new Set<string>();
    const threads = messages
      .filter((m) => (seen.has(m.conversationId) ? false : (seen.add(m.conversationId), true)))
      .map((m) => ({
        conversationId: m.conversationId,
        subject: m.subject,
        from: m.from?.emailAddress?.address || '',
        receivedDateTime: m.receivedDateTime,
      }));
    return NextResponse.json({ ok: true, threads });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// POST { projectId, conversationId } → stamp EZW-{projectId} on every message in
// the thread and store the conversationId on the project (bidirectional link).
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const { projectId, conversationId } = (await req.json()) as {
      projectId?: string;
      conversationId?: string;
    };
    if (!projectId || !conversationId) {
      return NextResponse.json(
        { ok: false, error: 'projectId and conversationId are required.' },
        { status: 400 }
      );
    }
    const result = await tagThread(conversationId, projectId);
    await setProjectRefs(projectId, { outlook_conversation_id: conversationId });
    return NextResponse.json({
      ok: true,
      tagged: result.tagged,
      category: projectCategory(projectId),
      conversationId,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
