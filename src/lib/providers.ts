import "server-only";
import type { Segment } from "./types";
async function request(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `El proveedor respondió HTTP ${response.status}. Revisa las credenciales, la cuota y el modelo configurado.`,
    );
  }
  return response.json();
}
export function segments(
  value: unknown,
  offset: number,
  duration: number,
): Segment[] {
  if (!Array.isArray(value))
    throw new Error("El proveedor no devolvió segmentos válidos.");
  return value
    .map((s) => {
      if (
        !s ||
        typeof s.text !== "string" ||
        !Number.isFinite(s.start) ||
        !Number.isFinite(s.end) ||
        s.start < 0 ||
        s.end < s.start ||
        s.start > duration + 1 ||
        s.end > duration + 2
      )
        throw new Error("Marcas temporales inválidas en la respuesta.");
      return {
        start: offset + Math.min(duration, s.start),
        end: offset + Math.min(duration, s.end),
        text: s.text.trim(),
      };
    })
    .filter((s) => s.text)
    .sort((a, b) => a.start - b.start);
}

export async function transcribe(
  provider: "gemini",
  audio: Uint8Array,
  duration: number,
) {
  const original = await request(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.GEMINI_MODEL || "gemini-2.5-flash")}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Transcribe this audio verbatim in its original language. Do not summarize, translate, or correct names or numbers. Return short phrase segments, ideally under 10 seconds. Start and end are seconds relative to this ${duration.toFixed(2)}-second clip, between 0 and ${duration.toFixed(2)}. Include all audible speech; omit silence.`,
              },
              {
                inlineData: {
                  mimeType: "audio/wav",
                  data: Buffer.from(audio).toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              segments: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    start: { type: "NUMBER" },
                    end: { type: "NUMBER" },
                    text: { type: "STRING" },
                  },
                  required: ["start", "end", "text"],
                },
              },
            },
            required: ["segments"],
          },
        },
      }),
    },
  );
  const candidate = original.candidates?.[0];
  const content = candidate?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text || "")
    .join("");
  if (!content || candidate.finishReason !== "STOP")
    throw new Error(
      "Gemini no completó la respuesta. Revisa el modelo y su cuota.",
    );
  return {
    segments: segments(JSON.parse(content).segments, 0, duration),
    original,
  };
}
