import type {
  Job,
  Resolution,
  Segment,
  Transcript,
  OriginalResponse,
} from "./types";
import { compare } from "./compare";
export const MAX_PROJECT_BYTES = 10 * 1024 * 1024;
export type Project = {
  format: "audio-transcriptor";
  version: 1;
  savedAt: string;
  job: Job;
  resolutions: Record<string, Resolution>;
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function parseProject(text: string): Project {
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES)
    throw new Error("El proyecto supera los 10 MB.");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("El archivo no contiene JSON válido.");
  }
  if (
    !record(value) ||
    value.format !== "audio-transcriptor" ||
    value.version !== 1 ||
    !record(value.job) ||
    !record(value.resolutions)
  )
    throw new Error("Formato de proyecto no compatible.");
  const source = value.job;
  if (
    source.status !== "complete" ||
    typeof source.id !== "string" ||
    source.id.length > 100 ||
    typeof source.name !== "string" ||
    source.name.length > 300 ||
    !finite(source.size) ||
    source.size <= 0 ||
    !Number.isSafeInteger(source.size) ||
    !finite(source.duration) ||
    source.duration <= 0 ||
    source.duration > 7200 ||
    typeof source.audioSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.audioSha256)
  )
    throw new Error("Los datos del audio o del proyecto no son válidos.");
  const duration = source.duration;
  function transcript(
    raw: unknown,
    provider: Transcript["provider"],
  ): Transcript {
    if (
      !record(raw) ||
      raw.provider !== provider ||
      !Array.isArray(raw.segments) ||
      raw.segments.length > 50000
    )
      throw new Error("La transcripción no es válida.");
    let previous = -1;
    const segments: Segment[] = raw.segments.map((s) => {
      if (
        !record(s) ||
        !finite(s.start) ||
        !finite(s.end) ||
        s.start < 0 ||
        s.end < s.start ||
        s.end > duration + 0.1 ||
        s.start < previous ||
        typeof s.text !== "string" ||
        s.text.length > 100000
      )
        throw new Error("El proyecto contiene segmentos inválidos.");
      previous = s.start;
      return { start: s.start, end: s.end, text: s.text };
    });
    return { provider, segments };
  }
  const openai = transcript(source.openai, "openai");
  const gemini = transcript(source.gemini, "gemini");
  const differences = compare(openai.segments, gemini.segments);
  const resolutions: Record<string, Resolution> = {};
  for (const d of differences) {
    const resolution = value.resolutions[d.id];
    if (resolution === undefined) continue;
    if (
      !d.different ||
      !record(resolution) ||
      !["openai", "gemini", "manual"].includes(String(resolution.choice)) ||
      typeof resolution.text !== "string" ||
      resolution.text.length > 100000
    )
      throw new Error("Una decisión de revisión no es válida.");
    const choice = resolution.choice as Resolution["choice"];
    if (
      (choice === "openai" && resolution.text !== d.openai) ||
      (choice === "gemini" && resolution.text !== d.gemini)
    )
      throw new Error(
        "La decisión no corresponde a la transcripción original.",
      );
    resolutions[d.id] = { choice, text: resolution.text };
  }
  if (
    Object.keys(value.resolutions).some(
      (key) => !Object.hasOwn(resolutions, key),
    )
  )
    throw new Error("El proyecto contiene decisiones desconocidas.");
  const originals: OriginalResponse[] = [];
  if (source.originals !== undefined) {
    if (!Array.isArray(source.originals) || source.originals.length > 200)
      throw new Error("Respuestas originales inválidas.");
    for (const o of source.originals) {
      if (
        !record(o) ||
        (o.provider !== "openai" && o.provider !== "gemini") ||
        !finite(o.index) ||
        !Number.isInteger(o.index) ||
        o.index < 0 ||
        !finite(o.offset) ||
        o.offset < 0 ||
        o.offset > duration ||
        !record(o.response)
      )
        throw new Error("Respuesta original inválida.");
      originals.push({
        provider: o.provider,
        index: o.index,
        offset: o.offset,
        response: o.response,
      });
    }
  }
  return {
    format: "audio-transcriptor",
    version: 1,
    savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
    job: {
      id: source.id,
      name: source.name,
      size: source.size,
      duration,
      status: "complete",
      stage: "Proyecto abierto desde tu disco",
      progress: 100,
      audioSha256: source.audioSha256,
      openai,
      gemini,
      differences,
      originals,
    },
    resolutions,
  };
}
export function serializeProject(
  job: Job,
  resolutions: Record<string, Resolution>,
): string {
  if (job.status !== "complete")
    throw new Error(
      "Espera a que ambas transcripciones terminen para guardar el proyecto.",
    );
  // Parse our own exported shape to enforce the same contract on save and reopen.
  return JSON.stringify(
    parseProject(
      JSON.stringify({
        format: "audio-transcriptor",
        version: 1,
        savedAt: new Date().toISOString(),
        job,
        resolutions,
      }),
    ),
    null,
    2,
  );
}
