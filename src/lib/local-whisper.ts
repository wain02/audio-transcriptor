import type { Segment } from "./types";
import { wavDuration } from "./audio-format";
export type WhisperLanguage = "spanish" | "english";
export type WhisperOutput = {
  text: string;
  chunks: { text: string; timestamp: [number, number | null] }[];
};
export function whisperSegments(
  original: WhisperOutput,
  duration: number,
): Segment[] {
  if (typeof original?.text !== "string" || !Array.isArray(original.chunks))
    throw new Error("Whisper local no devolvió tiempos válidos.");
  return original.chunks
    .map((chunk) => {
      const [start, end] = chunk.timestamp || [];
      if (
        typeof chunk.text !== "string" ||
        !Number.isFinite(start) ||
        start < 0 ||
        start > duration + 1 ||
        (end !== null && (!Number.isFinite(end) || end < start))
      )
        throw new Error("Whisper local devolvió un segmento inválido.");
      return {
        start: Math.min(start, duration),
        end: Math.min(end ?? duration, duration),
        text: chunk.text.trim(),
      };
    })
    .filter((s) => s.text)
    .sort((a, b) => a.start - b.start);
}
export function pcmSamples(audio: Uint8Array): Float32Array {
  const duration = wavDuration(audio);
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const output = new Float32Array(Math.round(duration * 16000));
  let index = 0;
  for (let at = 12; at + 8 <= audio.length;) {
    const length = view.getUint32(at + 4, true);
    if (String.fromCharCode(...audio.subarray(at, at + 4)) === "data") {
      for (let n = at + 8; n < at + 8 + length; n += 2)
        output[index++] = view.getInt16(n, true) / 32768;
    }
    at += 8 + length + (length % 2);
  }
  return output;
}
export class LocalWhisper {
  private worker: Worker;
  private onAbort: () => void;
  constructor(
    private signal: AbortSignal,
    private onStage: (stage: string) => void,
  ) {
    this.worker = new Worker("/whisper/worker.js", { type: "module" });
    this.onAbort = () => this.worker.terminate();
    signal.addEventListener("abort", this.onAbort, { once: true });
  }
  private call(
    message: unknown,
    transfer: Transferable[] = [],
  ): Promise<unknown> {
    this.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        this.signal.removeEventListener("abort", onCancel);
      };
      const onCancel = () => {
        cleanup();
        reject(new DOMException("Transcripción cancelada", "AbortError"));
      };
      const onError = () => {
        cleanup();
        reject(
          new Error(
            "No se pudo iniciar Whisper local. Recarga y usa un navegador de escritorio actualizado.",
          ),
        );
      };
      const onMessage = (event: MessageEvent) => {
        const data = event.data;
        if (data.type === "progress") {
          this.onStage(data.text);
          return;
        }
        cleanup();
        if (data.type === "error") reject(new Error(data.text));
        else resolve(data.original);
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      this.signal.addEventListener("abort", onCancel, { once: true });
      this.worker.postMessage(message, transfer);
    });
  }
  async load() {
    this.onStage("Cargando Whisper local en tu computadora…");
    await this.call({ type: "load" });
  }
  async transcribe(audio: Uint8Array, language: WhisperLanguage) {
    const duration = wavDuration(audio);
    const samples = pcmSamples(audio);
    const original = (await this.call(
      { type: "transcribe", audio: samples, language },
      [samples.buffer],
    )) as WhisperOutput;
    return { segments: whisperSegments(original, duration), original };
  }
  dispose() {
    this.signal.removeEventListener("abort", this.onAbort);
    this.worker.terminate();
  }
}
