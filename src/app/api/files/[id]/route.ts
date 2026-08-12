import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentContext } from "@/lib/session";

// GET /api/files/:id — 직답 첨부 다운로드. 같은 테넌트 멤버만.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCurrentContext();
  if (!ctx) return new NextResponse("unauthorized", { status: 401 });
  const { id } = await params;
  const f = await prisma.replyFile.findFirst({
    where: { id, tenantId: ctx.tenant.id },
  });
  if (!f) return new NextResponse("not found", { status: 404 });
  return new NextResponse(Buffer.from(f.data), {
    headers: {
      "content-type": f.mime,
      "content-length": String(f.size),
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "cache-control": "private, max-age=3600",
    },
  });
}
