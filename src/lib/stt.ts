/**
 * Speech-to-text (server-side, high accuracy).
 *
 * Claude/Anthropic has no audio transcription, so STT uses a separate,
 * pluggable provider — this is intentional and does NOT mix providers for our
 * Claude calls (those stay in lib/ai.ts). Default adapter is OpenAI Whisper
 * (strong Korean) via raw fetch (no SDK dependency). Swap by env:
 *   STT_PROVIDER = openai | none
 *   OPENAI_API_KEY, STT_MODEL (default whisper-1), STT_LANGUAGE (default ko)
 *
 * Other providers (Google Cloud STT, Azure, Deepgram, Naver CLOVA) can be added
 * as adapters behind `transcribe()` without touching callers.
 */

export function sttConfigured(): boolean {
  const p = process.env.STT_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none");
  if (p === "openai") return Boolean(process.env.OPENAI_API_KEY);
  return false;
}

export async function transcribe(
  audio: Buffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const provider = process.env.STT_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "none");
  switch (provider) {
    case "openai":
      return openaiWhisper(audio, mimeType, filename);
    default:
      throw new Error("STT 공급자가 설정되지 않았습니다 (STT_PROVIDER/OPENAI_API_KEY).");
  }
}

async function openaiWhisper(audio: Buffer, mimeType: string, filename: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY 누락");
  const model = process.env.STT_MODEL || "whisper-1";
  const language = process.env.STT_LANGUAGE || "ko";

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType || "audio/webm" }), filename || "audio.webm");
  form.append("model", model);
  form.append("language", language);
  form.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`STT 실패 (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { text?: string };
  return json.text ?? "";
}
