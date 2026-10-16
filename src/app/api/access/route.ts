import { accessError, configurationError } from "@/lib/access";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return (
    accessError(request) ||
    configurationError() ||
    Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  );
}
