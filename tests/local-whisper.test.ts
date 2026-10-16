import { test } from "node:test";
import assert from "node:assert/strict";
import { whisperSegments, pcmSamples } from "../src/lib/local-whisper";
import { serializeProject, parseProject } from "../src/lib/project";
import type { Job } from "../src/lib/types";
test("preserves local Whisper timestamps including the final unknown end", () => {
  const raw = {
    text: " Hola.",
    chunks: [{ text: " Hola.", timestamp: [0, null] as [number, null] }],
  };
  assert.deepEqual(whisperSegments(raw, 5), [
    { start: 0, end: 5, text: "Hola." },
  ]);
  assert.equal(raw.chunks[0].timestamp[1], null);
  assert.throws(
    () =>
      whisperSegments(
        { text: "bad", chunks: [{ text: "x", timestamp: [-1, 2] }] },
        5,
      ),
    /inválido/,
  );
});
test("converts real PCM sample values without decoding an entire recording", () => {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  const text = (value: string, at: number) =>
    bytes.set(new TextEncoder().encode(value), at);
  text("RIFF", 0);
  view.setUint32(4, 40, true);
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
  view.setUint32(40, 4, true);
  view.setInt16(44, -32768, true);
  view.setInt16(46, 16384, true);
  assert.deepEqual([...pcmSamples(bytes)], [-1, 0.5]);
});
test("project JSON retains local engine identity while accepting legacy OpenAI projects", () => {
  const job: Job = {
    id: "local",
    name: "a.wav",
    size: 100,
    duration: 1,
    status: "complete",
    stage: "done",
    progress: 100,
    audioSha256: "a".repeat(64),
    openai: {
      provider: "whisper-local",
      segments: [{ start: 0, end: 1, text: "Hola" }],
    },
    gemini: {
      provider: "gemini",
      segments: [{ start: 0, end: 1, text: "Hola" }],
    },
    originals: [
      {
        provider: "whisper-local",
        index: 0,
        offset: 0,
        response: { text: "Hola", chunks: [] },
      },
    ],
  };
  assert.equal(
    parseProject(serializeProject(job, {})).job.openai?.provider,
    "whisper-local",
  );
  job.openai!.provider = "openai";
  assert.equal(
    parseProject(serializeProject(job, {})).job.openai?.provider,
    "openai",
  );
});
