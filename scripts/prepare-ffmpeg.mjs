import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
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
