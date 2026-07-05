"use client";

import { useRef, useState } from "react";
import { addComment, deleteComment } from "@/app/actions/collab";

export interface CommentView {
  id: string;
  body: string;
  authorName: string;
  authorId: string;
  createdAt: string;
  canDelete: boolean;
}
export interface MemberLite {
  id: string;
  name: string;
}

/** Render a comment body with @mentions highlighted. */
function renderBody(body: string, memberNames: string[]) {
  if (memberNames.length === 0) return body;
  // longest first so "@김철수" wins over "@김철"
  const names = [...memberNames].sort((a, b) => b.length - a.length);
  const parts: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  outer: while (i < body.length) {
    if (body[i] === "@") {
      for (const n of names) {
        if (body.startsWith("@" + n, i)) {
          parts.push(
            <span key={key++} className="rounded bg-indigo-100 px-1 font-medium text-indigo-700">
              @{n}
            </span>,
          );
          i += n.length + 1;
          continue outer;
        }
      }
    }
    // accumulate a plain run
    let j = i + 1;
    while (j < body.length && body[j] !== "@") j++;
    parts.push(<span key={key++}>{body.slice(i, j)}</span>);
    i = j;
  }
  return parts;
}

export default function CommentThread({
  instructionId,
  milestoneId,
  comments,
  members,
  currentUserId,
}: {
  instructionId: string;
  milestoneId?: string;
  comments: CommentView[];
  members: MemberLite[];
  currentUserId: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  const memberNames = members.map((m) => m.name);

  const insertMention = (name: string) => {
    const ta = ref.current;
    if (!ta) return;
    const at = ta.selectionStart ?? ta.value.length;
    const before = ta.value.slice(0, at);
    const after = ta.value.slice(at);
    const sep = before && !before.endsWith(" ") ? " " : "";
    ta.value = `${before}${sep}@${name} ${after}`;
    ta.focus();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {comments.length === 0 && (
          <p className="text-xs text-gray-400">아직 노트가 없습니다. 첫 노트를 남겨보세요.</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="rounded-md bg-white p-2 text-sm shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-800">
                {c.authorName}
                {c.authorId === currentUserId && <span className="ml-1 text-[10px] text-gray-400">(나)</span>}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400">{new Date(c.createdAt).toLocaleString()}</span>
                {c.canDelete && (
                  <form action={deleteComment}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="text-[11px] text-gray-300 hover:text-red-500">삭제</button>
                  </form>
                )}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-gray-700">{renderBody(c.body, memberNames)}</p>
          </div>
        ))}
      </div>

      <form
        action={async (fd) => {
          setPending(true);
          try {
            await addComment(fd);
            if (ref.current) ref.current.value = "";
          } finally {
            setPending(false);
          }
        }}
        className="space-y-2"
      >
        <input type="hidden" name="instructionId" value={instructionId} />
        {milestoneId && <input type="hidden" name="milestoneId" value={milestoneId} />}
        <textarea
          ref={ref}
          name="body"
          className="input min-h-16 text-sm"
          placeholder="노트를 남기거나 @이름 으로 동료를 언급하세요…"
          required
        />
        {members.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {members.slice(0, 12).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => insertMention(m.name)}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-indigo-100 hover:text-indigo-700"
              >
                @{m.name}
              </button>
            ))}
          </div>
        )}
        <button className="btn px-3 py-1.5 text-xs" disabled={pending}>
          {pending ? "등록 중…" : "노트 등록"}
        </button>
      </form>
    </div>
  );
}
