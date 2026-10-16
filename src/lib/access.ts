import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
export function accessError(request: Request): Response | null {
  const expected = process.env.APP_ACCESS_PASSWORD;
  if (!expected || expected.length < 16)
    return Response.json(
      {
        error:
          "Configura APP_ACCESS_PASSWORD con al menos 16 caracteres en el servidor.",
      },
      { status: 503 },
    );
  const supplied = request.headers.get("x-access-password") || "";
  const hash = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(hash(expected), hash(supplied)))
    return Response.json(
      { error: "La contraseña de acceso no es correcta." },
      { status: 401 },
    );
  return null;
}
export function configurationError(): Response | null {
  if (!process.env.GEMINI_API_KEY)
    return Response.json(
      {
        error: "Configura GEMINI_API_KEY en el servidor.",
      },
      { status: 503 },
    );
  return null;
}
