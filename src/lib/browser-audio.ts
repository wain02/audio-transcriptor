import { createSHA256 } from "hash-wasm";
import { CHUNK_SECONDS } from "./audio-format";
export async function fingerprint(
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const hash = await createSHA256();
  hash.init();
  for (let start = 0; start < file.size; start += 1024 * 1024) {
    signal?.throwIfAborted();
    hash.update(
      new Uint8Array(
        await file.slice(start, start + 1024 * 1024).arrayBuffer(),
      ),
    );
  }
  signal?.throwIfAborted();
  return hash.digest("hex");
}
export async function* audioChunks(
  file: File,
  duration: number,
  signal: AbortSignal,
  onStage: (stage: string) => void,
): AsyncGenerator<{ audio: Uint8Array; offset: number; index: number }> {
  onStage("Preparando el procesador de audio en tu navegador…");
  // Serve the upstream ESM worker package intact. Bundling its dynamic Worker
  // URL through Turbopack changes worker resolution and prevents builds.
  const moduleURL = new URL("/ffmpeg/worker/index.js", location.origin).href;
  const { FFmpeg, FFFSType } = (await import(
    /* webpackIgnore: true */ moduleURL
  )) as typeof import("@ffmpeg/ffmpeg");
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    const url = (path: string) => new URL(path, location.origin).href;
    await ffmpeg.load({
      classWorkerURL: url("/ffmpeg/worker/worker.js"),
      coreURL: url("/ffmpeg/ffmpeg-core.js"),
      wasmURL: url("/ffmpeg/ffmpeg-core.wasm"),
    });
    signal.throwIfAborted();
    await ffmpeg.createDir("/input");
    // WORKERFS exposes the read-only File directly; no full-file decode or MEMFS copy.
    await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, "/input");
    for (
      let offset = 0, index = 0;
      offset < duration;
      offset += CHUNK_SECONDS, index++
    ) {
      signal.throwIfAborted();
      onStage(
        `Preparando fragmento ${index + 1} de ${Math.ceil(duration / CHUNK_SECONDS)} en tu equipo`,
      );
      const code = await ffmpeg.exec([
        "-v",
        "error",
        "-ss",
        String(offset),
        "-i",
        `/input/${file.name}`,
        "-t",
        String(Math.min(CHUNK_SECONDS, duration - offset)),
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        "chunk.wav",
      ]);
      if (code !== 0)
        throw new Error(
          "No se pudo procesar el audio en este navegador. Prueba Chrome de escritorio o un archivo más pequeño.",
        );
      const audio = await ffmpeg.readFile("chunk.wav");
      await ffmpeg.deleteFile("chunk.wav");
      if (!(audio instanceof Uint8Array))
        throw new Error("El procesador no devolvió audio válido.");
      yield { audio, offset, index };
    }
  } finally {
    signal.removeEventListener("abort", abort);
    ffmpeg.terminate();
  }
}
