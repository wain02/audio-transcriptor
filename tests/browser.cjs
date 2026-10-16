const { chromium } = require("playwright");
const fs = require("fs");
const crypto = require("crypto");
function wav(seconds = 91) {
  const audio = Buffer.alloc(44 + 32000 * seconds);
  audio.write("RIFF");
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVE", 8);
  audio.write("fmt ", 12);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  return audio;
}
(async () => {
  fs.mkdirSync(".test-artifacts", { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("console:", m.text().slice(0, 300));
  });
  page.setDefaultTimeout(60000);
  const requests = [];
  await page.route("**/api/access", (r) => r.fulfill({ json: { ok: true } }));
  await page.route("**/api/transcribe", (r) => {
    const req = r.request();
    const data = req.postDataBuffer();
    if (data.length > 3000000 || data.toString("ascii", 0, 4) !== "RIFF")
      throw Error("Chunk invalid or too big");
    const provider = req.headers()["x-provider"];
    requests.push({ provider, size: data.length });
    const text = provider === "openai" ? "Quince euros." : "Cincuenta euros.";
    return r.fulfill({
      json: {
        segments: [{ start: 0, end: 1, text }],
        original: { test_fixture: true, text },
      },
    });
  });
  await page.goto(process.env.BASE_URL || "http://localhost:3100");
  await page.getByRole("heading", { name: "Cada palabra cuenta." }).waitFor();
  await page.screenshot({
    path: ".test-artifacts/desktop.png",
    fullPage: true,
  });
  const audio = wav();
  const file = { name: "reunion.wav", mimeType: "audio/wav", buffer: audio };
  await page.locator('input[type=file][accept*=".m4a"]').setInputFiles(file);
  await page.getByText("reunion.wav", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Transcribir audio", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "contraseña de acceso" })
    .waitFor();
  await page
    .getByLabel("Contraseña de acceso", { exact: true })
    .fill("browser-test-only-password");
  await page
    .getByRole("button", { name: "Transcribir audio", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Transcripción completada" })
    .waitFor({ timeout: 120000 });
  if (
    requests.length !== 4 ||
    requests.filter((r) => r.provider === "openai").length !== 2
  )
    throw Error(
      "Expected two real browser chunks per model, got " +
        JSON.stringify(requests),
    );
  console.log(
    "PASS: real FFmpeg WASM + WORKERFS generated 90-second and 1-second chunks for both mocked providers",
    requests,
  );
  const accepts = page.getByRole("button", {
    name: "Aceptar OpenAI",
    exact: true,
  });
  await accepts.nth(0).click();
  await page
    .getByRole("button", { name: "Corrección manual", exact: true })
    .nth(1)
    .click();
  await page
    .getByRole("textbox", { name: "Corrección del segmento 01:30" })
    .fill("Sesenta euros.");
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar proyecto JSON" }).click();
  const saved = await projectDownload;
  const projectText = fs.readFileSync(await saved.path(), "utf8");
  const project = JSON.parse(projectText);
  if (
    project.job.audioSha256 !==
    crypto.createHash("sha256").update(audio).digest("hex")
  )
    throw Error("Fingerprint mismatch");
  if (
    project.job.originals.length !== 4 ||
    projectText.includes("browser-test-only-password") ||
    projectText.includes("base64")
  )
    throw Error("Project content invalid");
  await page.reload();
  await page
    .getByRole("button", { name: "Transcribir audio", exact: true })
    .waitFor();
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "saved.json",
      mimeType: "application/json",
      buffer: Buffer.from(projectText),
    });
  await page.getByRole("button", { name: "Exportar TXT" }).waitFor();
  if (await page.getByRole("button", { name: "00:00 – 00:01" }).isEnabled())
    throw Error("Playback must need local audio");
  await page.getByRole("button", { name: "Vincular audio" }).click();
  const wrong = Buffer.from(audio);
  wrong[100] = 1;
  await page
    .locator('input[type=file][accept*=".m4a"]')
    .setInputFiles({ ...file, buffer: wrong });
  await page
    .getByRole("alert")
    .filter({ hasText: "contenido del audio no coincide" })
    .waitFor();
  await page
    .locator('input[type=file][accept*=".m4a"]')
    .setInputFiles({ ...file, name: "renamed.wav" });
  await page.getByRole("button", { name: "00:00 – 00:01" }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector("audio")?.src.startsWith("blob:"),
  );
  await page.getByRole("button", { name: "01:30 – 01:31" }).click();
  await page.waitForFunction(
    () => document.querySelector("audio")?.currentTime >= 87,
  );
  if (requests.length !== 4) throw Error("Reattaching triggered transcription");
  const txtDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar TXT" }).click();
  const txt = await txtDownload;
  if (
    fs.readFileSync(await txt.path(), "utf8") !==
    "Quince euros.\n\nSesenta euros."
  )
    throw Error("Consolidated TXT invalid");
  await page
    .getByRole("button", { name: "Corrección manual", exact: true })
    .nth(0)
    .click();
  await page
    .getByRole("textbox", { name: "Corrección del segmento 00:00" })
    .fill("Revisado después de abrir");
  await page
    .getByText("Cambios sin guardar en disco", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".test-artifacts/mobile.png", fullPage: true });
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw Error("Mobile overflow");
  if (errors.length) throw Error(errors.join("\n"));
  await browser.close();
  console.log(
    "PASS: project download/reopen, originals, password excluded, SHA-256 reattachment, wrong-file rejection, 3-second playback, TXT, dirty state, mobile. No real API requests were made.",
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
