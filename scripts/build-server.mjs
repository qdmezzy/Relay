import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, ".release", "runtime");
const staging = path.join(root, ".release", ".build");
const bundle = path.join(staging, "server.mjs");
const config = path.join(staging, "sea-config.json");
const output = path.join(release, "Relay Server.exe");

await fs.mkdir(release, { recursive: true });
await fs.mkdir(staging, { recursive: true });

await build({
  entryPoints: [path.join(root, "src", "server.js")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node26",
  outfile: bundle,
});

await fs.writeFile(
  config,
  JSON.stringify({
    main: bundle,
    mainFormat: "module",
    executable: process.execPath,
    output,
    disableExperimentalSEAWarning: true,
  })
);

const result = spawnSync(process.execPath, ["--build-sea", config], {
  cwd: root,
  stdio: "inherit",
});

await fs.rm(staging, { recursive: true, force: true });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
