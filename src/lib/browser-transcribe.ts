import type { Job, Segment, OriginalResponse } from "./types";
import { compare } from "./compare";
import { audioChunks, fingerprint } from "./browser-audio";
import { CHUNK_SECONDS } from "./audio-format";
import { LocalWhisper, type WhisperLanguage } from "./local-whisper";
export async function transcribeLocal(
  file: File,
  duration: number,
  password: string,
  signal: AbortSignal,
  onUpdate: (job: Job) => void,
  language: WhisperLanguage = "spanish",
): Promise<Job> {
  const check = await fetch("/api/access", {
    method: "POST",
    headers: { "x-access-password": password },
    signal,
  });
  if (!check.ok) {
    const data = await check.json();
    throw new Error(data.error || "No se pudo verificar el acceso.");
  }
  const job: Job = {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    duration,
    status: "processing",
    progress: 0,
    stage: "Identificando tu archivo local…",
  };
  onUpdate({ ...job });
  job.audioSha256 = await fingerprint(file, signal);
  const openai: Segment[] = [];
  const gemini: Segment[] = [];
  const originals: OriginalResponse[] = [];
  const local = new LocalWhisper(signal, (stage) => {
    job.stage = stage;
    onUpdate({ ...job });
  });
  try {
    await local.load();
    for await (const { audio, offset, index } of audioChunks(
      file,
      duration,
      signal,
      (stage) => {
        job.stage = stage;
        onUpdate({ ...job });
      },
    )) {
      job.stage = `Transcribiendo fragmento ${index + 1} de ${Math.ceil(duration / CHUNK_SECONDS)} con ambas IA`;
      onUpdate({ ...job });
      async function provider(name: "gemini") {
        const response = await fetch("/api/transcribe", {
          method: "POST",
          headers: {
            "Content-Type": "audio/wav",
            "x-provider": name,
            "x-access-password": password,
          },
          body: new Blob([new Uint8Array(audio)], { type: "audio/wav" }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(280000)]),
        });
        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error(
            `${name}: el servidor no respondió correctamente. Comprueba los límites del despliegue.`,
          );
        }
        if (!response.ok)
          throw new Error(
            `${name}: ${data.error || "Error de transcripción."}`,
          );
        return data as { segments: Segment[]; original: unknown };
      }
      // Settle both calls before releasing the chunk. One model never sees the other's output.
      const responses = await Promise.allSettled([
        local.transcribe(audio, language),
        provider("gemini"),
      ]);
      signal.throwIfAborted();
      for (let n = 0; n < responses.length; n++) {
        const response = responses[n];
        if (response.status === "rejected") throw response.reason;
        const name = n === 0 ? "whisper-local" : "gemini";
        originals.push({
          provider: name,
          index,
          offset,
          response: response.value.original,
        });
        const target = n === 0 ? openai : gemini;
        target.push(
          ...response.value.segments.map((s) => ({
            ...s,
            start: s.start + offset,
            end: s.end + offset,
          })),
        );
      }
      job.progress = Math.round(
        (Math.min(duration, offset + CHUNK_SECONDS) / duration) * 100,
      );
      onUpdate({ ...job });
    }
    const result: Job = {
      ...job,
      status: "complete",
      stage: "Lista para revisar · Audio conservado solo en tu equipo",
      progress: 100,
      openai: { provider: "whisper-local", segments: openai },
      gemini: { provider: "gemini", segments: gemini },
      originals,
      differences: compare(openai, gemini),
    };
    onUpdate(result);
    return result;
  } finally {
    local.dispose();
  }
}
