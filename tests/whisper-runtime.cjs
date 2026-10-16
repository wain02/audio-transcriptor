// Optional online integration check: downloads real public weights and executes
// one second of silence locally. Checks runtime only, not speech accuracy.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(process.env.BASE_URL || "http://localhost:3100");
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const worker = new Worker("/whisper/worker.js", { type: "module" });
          const done = (value) => {
            clearTimeout(timer);
            worker.terminate();
            resolve(value);
          };
          const timer = setTimeout(
            () =>
              done({
                type: "error",
                text: "Tiempo agotado al descargar o ejecutar el modelo.",
              }),
            300000,
          );
          worker.onerror = () =>
            done({
              type: "error",
              text: "No se pudo importar el worker de Whisper.",
            });
          worker.onmessage = ({ data }) => {
            if (data.type === "ready")
              worker.postMessage({
                type: "transcribe",
                audio: new Float32Array(16000),
                language: "spanish",
              });
            if (data.type === "result" || data.type === "error") done(data);
          };
          worker.postMessage({ type: "load" });
        }),
    );
    if (
      result.type !== "result" ||
      typeof result.original?.text !== "string" ||
      !Array.isArray(result.original?.chunks)
    )
      throw Error(
        result.text || "Whisper no devolvió una transcripción con tiempos.",
      );
    console.log(
      "PASS: real Whisper weights loaded and local WASM inference completed. No Gemini/OpenAI API calls; this does not validate speech accuracy.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
