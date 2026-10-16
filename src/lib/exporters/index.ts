import type { Difference, Resolution } from "../types";
export type ConsolidatedDocument = {
  title: string;
  paragraphs: { start: number; end: number; text: string }[];
};
export type Exporter = {
  extension: string;
  mimeType: string;
  render: (document: ConsolidatedDocument) => Promise<Blob>;
};
export function consolidate(
  title: string,
  differences: Difference[],
  resolutions: Record<string, Resolution>,
): ConsolidatedDocument {
  if (differences.some((d) => d.different && !resolutions[d.id]))
    throw new Error("Hay discrepancias pendientes de revisión.");
  return {
    title,
    paragraphs: differences.map((d) => ({
      start: d.start,
      end: d.end,
      text: d.different ? resolutions[d.id].text : d.openai,
    })),
  };
}
// DOCX and PDF exporters can implement this interface without changing review state.
export const txtExporter: Exporter = {
  extension: "txt",
  mimeType: "text/plain;charset=utf-8",
  async render(document) {
    return new Blob(
      [
        document.paragraphs
          .map((p) => p.text)
          .filter(Boolean)
          .join("\n\n"),
      ],
      { type: this.mimeType },
    );
  },
};
