/**
 * Adversarial tests for collaboration logic: @mention parsing (overlapping
 * names, substrings, repeats, case) and recipient resolution (dedup, self-exclusion).
 */
import assert from "node:assert/strict";
import { parseMentions, commentRecipients } from "../src/lib/collab";

const M = [
  { id: "u1", name: "김철수" },
  { id: "u2", name: "김철" }, // substring of 김철수
  { id: "u3", name: "이영희" },
  { id: "u4", name: "Bob" },
];

export async function run(t: (name: string, fn: () => void) => void) {
  t("plain mention", () => {
    assert.deepEqual(parseMentions("@이영희 확인해줘", M).sort(), ["u3"]);
  });

  t("longer name wins over its substring (no double-claim)", () => {
    // "@김철수" must match 김철수 only, NOT also 김철
    assert.deepEqual(parseMentions("@김철수 봐줘", M), ["u1"]);
  });

  t("the shorter name still matches when it stands alone", () => {
    assert.deepEqual(parseMentions("@김철 님", M), ["u2"]);
  });

  t("both distinct names in one body", () => {
    const r = parseMentions("@김철수 랑 @이영희 회의", M).sort();
    assert.deepEqual(r, ["u1", "u3"]);
  });

  t("repeated mention dedups to one id", () => {
    assert.deepEqual(parseMentions("@Bob @Bob @Bob", M), ["u4"]);
  });

  t("case-insensitive (English)", () => {
    assert.deepEqual(parseMentions("hey @bob", M), ["u4"]);
  });

  t("no mention → empty", () => {
    assert.deepEqual(parseMentions("email me at a@b.com please", M), []);
  });

  t("@ without a matching member → empty", () => {
    assert.deepEqual(parseMentions("@박대리 없음", M), []);
  });

  t("mention glued to text still parses", () => {
    // "@김철수님" → 김철수 matched, trailing 님 is plain text
    assert.deepEqual(parseMentions("@김철수님하고", M), ["u1"]);
  });

  t("empty-name members are ignored, no crash", () => {
    assert.deepEqual(parseMentions("@ hello", [{ id: "x", name: "" }]), []);
  });

  // ── recipients ─────────────────────────────────────────────────────────────
  t("thread = owner + author + prior commenters, minus self", () => {
    const r = commentRecipients({
      authorId: "me",
      ownerId: "owner",
      instructionAuthorId: "boss",
      priorCommenterIds: ["boss", "alice", "me"],
      mentionedIds: [],
    });
    assert.deepEqual(r.thread.sort(), ["alice", "boss", "owner"]);
    assert.deepEqual(r.mentioned, []);
  });

  t("self-mention is dropped", () => {
    const r = commentRecipients({
      authorId: "me", ownerId: null, instructionAuthorId: "boss",
      priorCommenterIds: [], mentionedIds: ["me", "alice"],
    });
    assert.deepEqual(r.mentioned, ["alice"]);
  });

  t("mentioned users are removed from the thread bucket (no double notify)", () => {
    const r = commentRecipients({
      authorId: "me", ownerId: "alice", instructionAuthorId: "boss",
      priorCommenterIds: ["carol"], mentionedIds: ["alice"],
    });
    assert.ok(!r.thread.includes("alice"), "alice should be in mentioned, not thread");
    assert.deepEqual(r.mentioned, ["alice"]);
    assert.deepEqual(r.thread.sort(), ["boss", "carol"]);
  });

  t("author is owner AND instruction author → nobody double-counted, empty thread", () => {
    const r = commentRecipients({
      authorId: "solo", ownerId: "solo", instructionAuthorId: "solo",
      priorCommenterIds: ["solo"], mentionedIds: [],
    });
    assert.deepEqual(r.thread, []);
  });

  t("no owner (unassigned milestone) still notifies the instruction author", () => {
    const r = commentRecipients({
      authorId: "me", ownerId: null, instructionAuthorId: "boss",
      priorCommenterIds: [], mentionedIds: [],
    });
    assert.deepEqual(r.thread, ["boss"]);
  });
}
