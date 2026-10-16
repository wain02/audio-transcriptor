import { cp, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
const target = path.resolve("public/ffmpeg");
await mkdir(target, { recursive: true });
await rm(path.join(target, "worker"), { recursive: true, force: true });
await cp("node_modules/@ffmpeg/ffmpeg/dist/esm", path.join(target, "worker"), {
  recursive: true,
  filter: (source) => !source.endsWith(".ts") && !source.endsWith(".map"),
});
for (const name of ["ffmpeg-core.js", "ffmpeg-core.wasm"])
  await cp(
    `node_modules/@ffmpeg/core/dist/esm/${name}`,
    path.join(target, name),
  );
console.log("FFmpeg browser assets ready (served locally; no external CDN).");

const whisper = path.resolve("public/whisper");
await mkdir(path.join(whisper, "ort"), { recursive: true });
await build({
  entryPoints: [
    "node_modules/@huggingface/transformers/dist/transformers.web.min.js",
  ],
  outfile: path.join(whisper, "transformers.web.min.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  minify: true,
  target: "es2022",
});
await cp("src/workers/whisper.js", path.join(whisper, "worker.js"));
for (const name of await readdir("node_modules/onnxruntime-web/dist")) {
  if (/^ort-wasm.*\.(mjs|wasm)$/.test(name))
    await cp(
      path.join("node_modules/onnxruntime-web/dist", name),
      path.join(whisper, "ort", name),
    );
}
console.log(
  "Whisper browser runtime ready. Model weights download on the user device.",
);
