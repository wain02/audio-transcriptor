import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, normalize, timestamp } from "../src/lib/compare";
test("ignores punctuation, whitespace and casing while preserving names and numbers", () => {
  assert.equal(normalize("¡Hola, MARÍA!"), normalize("hola maría"));
  assert.notEqual(normalize("15 euros"), normalize("50 euros"));
  assert.notEqual(normalize("María"), normalize("Mario"));
});
test("aligns differing segment boundaries without dropping text", () => {
  const result = compare(
    [
      { start: 0, end: 4, text: "Hola María" },
      { start: 4, end: 8, text: "Son quince euros" },
    ],
    [
      { start: 0, end: 2, text: "Hola" },
      { start: 2, end: 4, text: "María." },
      { start: 4, end: 8, text: "Son cincuenta euros" },
    ],
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].different, false);
  assert.equal(result[1].different, true);
  assert.equal(result[1].start, 4);
});
test("flags one-sided omissions and preserves chronological order", () => {
  const result = compare(
    [
      { start: 1, end: 2, text: "Inicio" },
      { start: 9, end: 11, text: "Omisión" },
    ],
    [{ start: 1, end: 2, text: "Inicio" }],
  );
  assert.equal(result[1].gemini, "");
  assert.equal(result[1].different, true);
  assert.equal(result[1].openai, "Omisión");
});
test("formats long recordings without wrapping minutes", () =>
  assert.equal(timestamp(7199), "119:59"));
