import type { Difference, Segment } from "./types";
export function normalize(text: string) {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
// Build connected temporal groups. Overlapping segment boundaries cannot be compared
// individually without inventing word timestamps, so preserve their full text together.
export function compare(openai: Segment[], gemini: Segment[]): Difference[] {
  const all = [
    ...openai.map((s) => ({ ...s, source: "openai" })),
    ...gemini.map((s) => ({ ...s, source: "gemini" })),
  ].sort((a, b) => a.start - b.start);
  const groups: {
    start: number;
    end: number;
    openai: string[];
    gemini: string[];
  }[] = [];
  for (const s of all) {
    let g = groups.at(-1);
    if (!g || s.start >= g.end - 0.05) {
      g = { start: s.start, end: s.end, openai: [], gemini: [] };
      groups.push(g);
    }
    g.end = Math.max(g.end, s.end);
    if (s.source === "openai") g.openai.push(s.text);
    else g.gemini.push(s.text);
  }
  return groups.map((g, i) => ({
    id: String(i),
    start: g.start,
    end: g.end,
    openai: g.openai.join(" "),
    gemini: g.gemini.join(" "),
    different: normalize(g.openai.join(" ")) !== normalize(g.gemini.join(" ")),
  }));
}
export function timestamp(seconds: number) {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
