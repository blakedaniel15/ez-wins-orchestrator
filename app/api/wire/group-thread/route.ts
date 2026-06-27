import { NextRequest, NextResponse } from 'next/server';
import { isAuthed, unauthorized } from '@/lib/security';
import { tagThread, projectCategory } from '@/lib/graph';
import { setGroupRefs } from '@/lib/groups';

export const runtime = 'nodejs';

// POST { groupId, conversationId } → tag every message in the thread with the
// GROUP's category (EZW-{groupId}) and store the conversationId on the group.
// One thread → the whole group → all its dealerships/projects (resolve fans out).
export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return unauthorized();
  try {
    const { groupId, conversationId } = (await req.json()) as {
      groupId?: string;
      conversationId?: string;
    };
    if (!groupId || !conversationId) {
      return NextResponse.json({ ok: false, error: 'groupId and conversationId are required.' }, { status: 400 });
    }
    const result = await tagThread(conversationId, groupId);
    await setGroupRefs(groupId, { outlook_conversation_id: conversationId });
    return NextResponse.json({
      ok: true,
      tagged: result.tagged,
      category: projectCategory(groupId),
      conversationId,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
