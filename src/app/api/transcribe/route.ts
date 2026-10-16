import { accessError, configurationError } from "@/lib/access";
import { transcribe } from "@/lib/providers";
import { MAX_CHUNK_BYTES, wavDuration } from "@/lib/audio-format";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  const forbidden = accessError(request) || configurationError();
  if (forbidden) return forbidden;
  const provider = request.headers.get("x-provider");
  if (provider !== "openai" && provider !== "gemini")
    return Response.json({ error: "Proveedor inválido." }, { status: 400 });
  if (!request.body)
    return Response.json(
      { error: "Falta el fragmento de audio." },
      { status: 400 },
    );
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_CHUNK_BYTES) {
        await reader.cancel();
        return Response.json(
          { error: "El fragmento supera los 3 MB." },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
    const audio = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    let duration: number;
    try {
      duration = wavDuration(audio);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Audio inválido." },
        { status: 400 },
      );
    }
    // Audio exists only in request memory. No disk, bucket, database or background job.
    const result = await transcribe(provider, audio, duration);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo transcribir el fragmento.",
      },
      { status: 502 },
    );
  } finally {
    reader.releaseLock();
  }
}
