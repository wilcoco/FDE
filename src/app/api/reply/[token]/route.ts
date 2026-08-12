import { NextResponse } from "next/server";
import { processExternalReply, type ReplyUpload } from "@/lib/external-reply-core";

// POST /api/reply/:token — 직답 페이지의 표준 multipart 제출.
// 서버 액션이 아닌 라우트로 받는 이유: 파일 업로드는 이 경로가 견고하다.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (q: string) => NextResponse.redirect(new URL(`/r/${token}?${q}`, req.url), 303);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return back("error=file");
  }
  const content = String(form.get("content") ?? "");
  const responder = String(form.get("responder") ?? "");
  const files: ReplyUpload[] = [];
  for (const f of form.getAll("files")) {
    if (f instanceof File && f.size > 0) {
      files.push({ name: f.name, mime: f.type, buf: Buffer.from(await f.arrayBuffer()) });
    }
  }

  const result = await processExternalReply(token, content, responder, files);
  if (result === "ok") return back("done=1");
  if (result === "invalid") return NextResponse.redirect(new URL("/r/invalid", req.url), 303);
  return back(`error=${result}`);
}
