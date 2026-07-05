// Pure logic for milestone collaboration notes — mention parsing + who to
// notify. No IO, fully unit-testable.

export interface Member {
  id: string;
  name: string;
}

/**
 * Extract @-mentioned member ids from a comment body.
 * Matches `@<name>` where name is one of the given members. Longer names win
 * first (so "@김철수" isn't shadowed by "@김철"). Case-insensitive; a name may
 * be mentioned once (deduped). Robust to names with no following space.
 */
export function parseMentions(body: string, members: Member[]): string[] {
  const lower = body.toLowerCase();
  const byLength = [...members].sort((a, b) => b.name.length - a.name.length);
  const found = new Set<string>();
  const consumed: Array<[number, number]> = []; // claimed [start,end) ranges

  for (const m of byLength) {
    if (!m.name) continue;
    const needle = `@${m.name.toLowerCase()}`;
    let from = 0;
    while (true) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      const end = idx + needle.length;
      // skip if this span overlaps an already-claimed (longer) mention
      const overlaps = consumed.some(([s, e]) => idx < e && s < end);
      if (!overlaps) {
        found.add(m.id);
        consumed.push([idx, end]);
      }
      from = end;
    }
  }
  return [...found];
}

/**
 * Who should be notified about a new comment.
 * Everyone touching this thread — milestone owner, instruction author, prior
 * commenters — plus anyone @-mentioned. The comment's own author is excluded.
 * Mentioned users are returned separately so callers can prioritize them.
 */
export function commentRecipients(input: {
  authorId: string;
  ownerId: string | null;
  instructionAuthorId: string;
  priorCommenterIds: string[];
  mentionedIds: string[];
}): { thread: string[]; mentioned: string[] } {
  const { authorId, ownerId, instructionAuthorId, priorCommenterIds, mentionedIds } = input;

  const mentioned = [...new Set(mentionedIds)].filter((id) => id !== authorId);
  const mentionSet = new Set(mentioned);

  const thread = new Set<string>();
  if (ownerId) thread.add(ownerId);
  thread.add(instructionAuthorId);
  for (const id of priorCommenterIds) thread.add(id);
  thread.delete(authorId);
  // don't double-notify: mentioned people are handled on their own channel
  for (const id of mentionSet) thread.delete(id);

  return { thread: [...thread], mentioned };
}
