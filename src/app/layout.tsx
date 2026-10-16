import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Audio Transcriptor · Escucha. Compara. Confirma.",
  description:
    "Transcribe reuniones con OpenAI y Gemini, compara las diferencias y conserva lo que realmente se dijo.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
