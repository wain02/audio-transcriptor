import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeProject, parseProject } from "../src/lib/project";
import { compare } from "../src/lib/compare";
import type { Job } from "../src/lib/types";
const openai = {
  provider: "openai" as const,
  segments: [{ start: 0, end: 2, text: "Quince euros." }],
};
const gemini = {
  provider: "gemini" as const,
  segments: [{ start: 0, end: 2, text: "Cincuenta euros." }],
};
const job: Job = {
  id: "test",
  name: "reunión.mp3",
  size: 2000,
  duration: 3,
  status: "complete",
  progress: 100,
  stage: "Lista",
  audioSha256: "a".repeat(64),
  openai,
  gemini,
  differences: compare(openai.segments, gemini.segments),
  originals: [
    {
      provider: "openai",
      index: 0,
      offset: 0,
      response: { text: "Quince euros." },
    },
  ],
};
test("round-trips transcripts, manual decisions, fingerprint and originals with no audio", () => {
  const text = serializeProject(job, {
    "0": { choice: "manual", text: "Sesenta euros." },
  });
  const result = parseProject(text);
  assert.deepEqual(result.resolutions, {
    "0": { choice: "manual", text: "Sesenta euros." },
  });
  assert.equal(result.job.audioSha256, job.audioSha256);
  assert.deepEqual(result.job.originals, job.originals);
  assert.equal(result.job.openai?.segments[0].text, "Quince euros.");
  assert.ok(!text.includes("base64"));
  assert.ok(!text.includes("password"));
});
test("rejects corrupt JSON, unsupported versions and invalid temporal data", () => {
  assert.throws(() => parseProject("not json"), /JSON/);
  const value = JSON.parse(serializeProject(job, {}));
  value.version = 99;
  assert.throws(() => parseProject(JSON.stringify(value)), /compatible/);
  value.version = 1;
  value.job.openai.segments[0].end = 10;
  assert.throws(() => parseProject(JSON.stringify(value)), /segmentos/);
});
test("rebuilds comparison rather than trusting imported differences", () => {
  const value = JSON.parse(serializeProject(job, {}));
  value.job.differences = [];
  const result = parseProject(JSON.stringify(value));
  assert.equal(result.job.differences?.[0].different, true);
});
test("blocks provider decisions that rewrite the original and unfinished projects", () => {
  assert.throws(
    () =>
      serializeProject(job, { "0": { choice: "openai", text: "Inventado" } }),
    /original/,
  );
  assert.throws(
    () => serializeProject({ ...job, status: "processing" }, {}),
    /terminen/,
  );
});
