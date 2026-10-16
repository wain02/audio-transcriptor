import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../src/app/api/transcribe/route";
import { wavDuration, MAX_CHUNK_BYTES } from "../src/lib/audio-format";
function wav(seconds = 1) {
  const audio = new Uint8Array(44 + 32000 * seconds);
  const view = new DataView(audio.buffer);
  const text = (value: string, at: number) =>
    audio.set(new TextEncoder().encode(value), at);
  text("RIFF", 0);
  view.setUint32(4, audio.length - 8, true);
  text("WAVE", 8);
  text("fmt ", 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text("data", 36);
  view.setUint32(40, audio.length - 44, true);
  return audio;
}
const password = "test-only-access-password";
function request(audio: Uint8Array, provider = "openai", access = password) {
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    headers: { "x-provider": provider, "x-access-password": access },
    body: new Blob([new Uint8Array(audio)]),
  });
}
test("validates WAV size, format, complete payload and duration", () => {
  assert.equal(wavDuration(wav(90)), 90);
  assert.throws(() => wavDuration(wav(91)), /90/);
  assert.throws(() => wavDuration(wav().slice(0, -1)), /incompleto/);
  const invalid = wav();
  invalid[22] = 2;
  assert.throws(() => wavDuration(invalid), /mono/);
});
test("serverless endpoint authorizes, bounds requests and transcribes independently without persistence", async () => {
  const previous = {
    password: process.env.APP_ACCESS_PASSWORD,
    openai: process.env.AUDIO_OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  };
  const originalFetch = globalThis.fetch;
  process.env.APP_ACCESS_PASSWORD = password;
  process.env.AUDIO_OPENAI_API_KEY = "test-fixture";
  process.env.GEMINI_API_KEY = "test-fixture";
  const calls: string[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes("api.openai.com")) {
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), "whisper-1");
      return Response.json({
        segments: [{ start: 0, end: 1, text: "Quince euros." }],
        original_marker: "openai-fixture",
      });
    }
    const body = JSON.parse(init?.body as string);
    assert.equal(body.contents[0].parts.length, 2);
    assert.ok(body.contents[0].parts[1].inlineData.data);
    assert.ok(!body.contents[0].parts[0].text.includes("Quince"));
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  segments: [{ start: 0, end: 1, text: "Cincuenta euros." }],
                }),
              },
            ],
          },
        },
      ],
      original_marker: "gemini-fixture",
    });
  };
  try {
    assert.equal((await POST(request(wav(), "openai", "wrong"))).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await POST(request(wav(), "unknown"))).status, 400);
    assert.equal(
      (await POST(request(new Uint8Array(MAX_CHUNK_BYTES + 1)))).status,
      413,
    );
    assert.equal((await POST(request(new Uint8Array(44)))).status, 400);
    const a = await POST(request(wav()));
    assert.equal(a.status, 200);
    const openai = await a.json();
    assert.equal(openai.segments[0].text, "Quince euros.");
    assert.equal(openai.original.original_marker, "openai-fixture");
    const b = await POST(request(wav(), "gemini"));
    assert.equal(b.status, 200);
    assert.equal((await b.json()).segments[0].text, "Cincuenta euros.");
    assert.equal(calls.length, 2);
    assert.equal(b.headers.get("cache-control"), "private, no-store");
    globalThis.fetch = async () => Response.json({}, { status: 429 });
    assert.equal((await POST(request(wav()))).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["APP_ACCESS_PASSWORD", previous.password],
      ["AUDIO_OPENAI_API_KEY", previous.openai],
      ["GEMINI_API_KEY", previous.gemini],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
