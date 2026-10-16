import { pipeline, env } from "./transformers.web.min.js";
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.wasmPaths = new URL("./ort/", self.location.href).href;
let transcriber;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      transcriber ??= await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny",
        {
          device: "wasm",
          dtype: "q8",
          progress_callback: (event) => {
            if (event.status === "progress")
              self.postMessage({
                type: "progress",
                text: `Descargando Whisper local: ${Math.round(event.progress || 0)}% del archivo actual`,
              });
            if (event.status === "initiate")
              self.postMessage({
                type: "progress",
                text: "Descargando el modelo Whisper local (solo la primera vez)…",
              });
          },
        },
      );
      self.postMessage({ type: "ready" });
    } else if (data.type === "transcribe") {
      if (!transcriber) throw new Error("Whisper local no está preparado.");
      const options = {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5,
        task: "transcribe",
        is_multilingual: true,
        language: data.language,
      };
      if (!["spanish", "english"].includes(data.language))
        throw new Error("Idioma no compatible.");
      const original = await transcriber(data.audio, options);
      self.postMessage({ type: "result", original });
    }
  } catch {
    // Runtime errors can include URLs and generated tokens. Keep UI errors actionable
    // without echoing audio, transcripts, credentials or provider internals.
    self.postMessage({
      type: "error",
      text: transcriber
        ? "Whisper local no pudo procesar este fragmento. Prueba un audio más corto en Chrome de escritorio."
        : "No se pudo descargar o cargar Whisper local. Comprueba tu conexión a huggingface.co y que el navegador admita WebAssembly. Puede requerir bastante memoria.",
    });
  }
};
