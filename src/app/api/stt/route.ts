import { getCurrentContext } from "@/lib/session";
import { transcribe, sttConfigured } from "@/lib/stt";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // Whisper limit ~25MB

export async function POST(req: Request) {
  const ctx = await getCurrentContext();
  if (!ctx) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!sttConfigured()) return Response.json({ error: "STT 미설정" }, { status: 503 });

  const form = await req.formData();
  const file = form.get("audio");
  if (!(file instanceof File)) return Response.json({ error: "오디오 파일이 필요합니다" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "파일이 너무 큽니다 (25MB 초과)" }, { status: 413 });

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const text = await transcribe(buf, file.type, file.name || "audio.webm");
    return Response.json({ text });
  } catch (e) {
    console.error("STT error:", e);
    return Response.json({ error: e instanceof Error ? e.message : "STT 실패" }, { status: 500 });
  }
}
