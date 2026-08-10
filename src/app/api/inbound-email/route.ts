import { prisma } from "@/lib/db";
import { notify, notifyEmail } from "@/lib/notify";
import { generateMilestones } from "@/lib/ai";
import {
  parseInboundAddress, normalizeEmail, extractThreadRefs, routeInboundEmail,
  selectStoredBody, type InboundPayload,
} from "@/lib/inbound-email";
import type { Prisma } from "@prisma/client";

/**
 * Inbound email webhook. An email-receiving service (Resend/Postmark/Cloudflare
 * Email Routing) parses the mail and POSTs this normalized JSON. A member CCs
 * the company's secret address to register a mail as a 지시(SAY); a reply in the
 * same thread is recorded as a DO signal.
 *
 * Auth: shared secret header (the service is configured with it) + the per-tenant
 * token embedded in the recipient address. Privacy-by-default: only metadata is
 * stored unless the tenant opted into bodies.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-inbound-secret") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  let p: InboundPayload;
  try {
    p = normalize(await req.json());
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const addr = parseInboundAddress(p.to);
  if (!addr) return ok("ignored:no_address");

  const tenant = await prisma.tenant.findFirst({
    where: { slug: addr.slug, inboundToken: addr.token },
    select: { id: true, storeEmailBody: true },
  });

  const senderEmail = normalizeEmail(p.from);
  const sender = tenant
    ? await prisma.user.findFirst({
        where: { tenantId: tenant.id, email: senderEmail, status: "ACTIVE" },
        select: { id: true, name: true },
      })
    : null;

  // gather tracked thread ids for reply matching (only the referenced ones)
  const refs = extractThreadRefs({ inReplyTo: p.inReplyTo, references: p.references });
  const knownRows = tenant && refs.length
    ? await prisma.instruction.findMany({
        where: { tenantId: tenant.id, threadMessageId: { in: refs } },
        select: { id: true, threadMessageId: true, authorId: true, summary: true, milestones: { select: { id: true }, orderBy: { order: "asc" }, take: 1 } },
      })
    : [];
  const known = new Set(knownRows.map((r) => r.threadMessageId!).filter(Boolean));

  const decision = routeInboundEmail(p, {
    tenantExists: !!tenant,
    senderIsMember: !!sender,
    known,
  });

  if (decision.action === "reject") return ok(`rejected:${decision.reason}`);

  // ─── reply → DO signal on the matched instruction ───
  if (decision.action === "reply") {
    const parent = knownRows.find((r) => r.threadMessageId === decision.parentMessageId)!;
    const body = selectStoredBody(p.text, tenant!.storeEmailBody);
    const preview = body ? ` — ${body.slice(0, 120)}` : "";
    // record the reply as a note on the instruction thread (author = system view)
    await prisma.milestoneComment.create({
      data: {
        tenantId: tenant!.id,
        instructionId: parent.id,
        milestoneId: null,
        authorId: parent.authorId, // attributed to the instruction owner's thread
        body: `📧 답장 도착: ${senderEmail} · "${p.subject}"${preview}`,
        mentions: [] as Prisma.InputJsonValue,
      },
    });
    const entry = {
      tenantId: tenant!.id, userId: parent.authorId, type: "PROOF_ADDED",
      title: `📧 답장 도착: ${parent.summary ?? p.subject}`,
      body: `${senderEmail} 님이 회신했습니다.`,
      link: `/instructions/${parent.id}`,
    };
    await notify(prisma, entry);
    void notifyEmail(entry).catch(() => {});
    return ok("reply_recorded");
  }

  // ─── new mail → SAY (Instruction) ───
  const body = selectStoredBody(p.text, tenant!.storeEmailBody);
  // decompose into milestones from the body when we have one; otherwise a single
  // milestone from the subject (metadata-only mode).
  let summary = p.subject || "이메일 지시";
  let milestones: { title: string; expectedResult: string | null }[];
  if (body) {
    const gen = await generateMilestones(`${p.subject}\n\n${body}`);
    summary = gen.summary || summary;
    milestones = gen.milestones.map((m) => ({ title: m.title, expectedResult: m.expectedResult || null }));
  } else {
    milestones = [{ title: p.subject || "이메일 지시", expectedResult: null }];
  }

  await prisma.$transaction(async (tx) => {
    const inst = await tx.instruction.create({
      data: {
        tenantId: tenant!.id,
        authorId: sender!.id,
        rawText: body ? `${p.subject}\n\n${body}` : `[메타데이터만] ${p.subject}`,
        summary,
        source: "EMAIL",
        threadMessageId: p.messageId,
      },
    });
    await tx.milestone.createMany({
      data: milestones.map((m, i) => ({
        tenantId: tenant!.id,
        instructionId: inst.id,
        order: i,
        title: m.title,
        expectedResult: m.expectedResult,
        status: (i === 0 ? "ACTIVE" : "PENDING") as Prisma.MilestoneCreateManyInput["status"],
        activatedAt: i === 0 ? new Date() : null,
        proof: [] as Prisma.InputJsonValue,
      })),
    });
    await tx.auditLog.create({
      data: { tenantId: tenant!.id, actorId: sender!.id, action: "INSTRUCTION_FROM_EMAIL", target: inst.id },
    });
  });

  return ok("instruction_created");
}

function ok(status: string) {
  return Response.json({ ok: true, status });
}

/** Map a loose inbound-service payload into our normalized shape. */
function normalize(raw: unknown): InboundPayload {
  const r = raw as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",").map((s) => s.trim()) : [];
  const to = [...arr(r.to), ...arr(r.cc)];
  const h = (r.headers ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v == null ? null : String(v));
  return {
    to,
    from: String(r.from ?? ""),
    subject: String(r.subject ?? ""),
    messageId: String(r.messageId ?? r.message_id ?? h["message-id"] ?? ""),
    inReplyTo: str(r.inReplyTo ?? r.in_reply_to ?? h["in-reply-to"]),
    references: str(r.references ?? h["references"]),
    text: str(r.text ?? r.body ?? r.plain),
    spf: str(r.spf ?? (r.authentication as Record<string, unknown> | undefined)?.spf),
    dkim: str(r.dkim ?? (r.authentication as Record<string, unknown> | undefined)?.dkim),
  };
}
