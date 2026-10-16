import { test } from "node:test";
import assert from "node:assert/strict";
import { consolidate, txtExporter } from "../src/lib/exporters";
const differences = [
  {
    id: "0",
    start: 0,
    end: 3,
    openai: "Quince",
    gemini: "Cincuenta",
    different: true,
  },
  {
    id: "1",
    start: 3,
    end: 6,
    openai: "Gracias.",
    gemini: "gracias",
    different: false,
  },
];
test("blocks export until every difference has a human decision", () =>
  assert.throws(() => consolidate("Reunión", differences, {}), /pendientes/));
test("exports the chosen correction and preserves agreed speech", async () => {
  const doc = consolidate("Reunión", differences, {
    "0": { choice: "manual", text: "Sesenta" },
  });
  assert.equal(
    await (await txtExporter.render(doc)).text(),
    "Sesenta\n\nGracias.",
  );
});
test("allows explicitly accepting an omission", async () => {
  const doc = consolidate("Reunión", differences, {
    "0": { choice: "manual", text: "" },
  });
  assert.equal(await (await txtExporter.render(doc)).text(), "Gracias.");
});
