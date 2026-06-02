import { rm } from "node:fs/promises";
import * as esbuild from "esbuild";

await rm("dist", { force: true, recursive: true });

const shared = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  packages: "external",
  sourcemap: false,
  minify: false,
  logLevel: "info",
};

await esbuild.build({
  ...shared,
  format: "esm",
  outfile: "dist/esm/index.js",
});

await esbuild.build({
  ...shared,
  format: "cjs",
  outfile: "dist/cjs/index.cjs",
});
