import type OpenAI from "openai";
import { toFile } from "openai/uploads";

export async function transcribeTelegramVoice(
  client: OpenAI,
  model: string,
  fileUrl: string,
): Promise<string> {
  const resp = await fetch(fileUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download voice file: ${resp.status} ${resp.statusText}`);
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  const file = await toFile(buf, "voice.ogg");
  const tr = await client.audio.transcriptions.create({
    model,
    file,
  });
  return (tr.text ?? "").trim();
}
