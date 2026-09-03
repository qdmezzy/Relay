import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const release = path.join(root, ".release", "runtime");
const serverName = "Relay Server.exe";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "relay-release-"));
const port = 45000 + Math.floor(Math.random() * 10000);
let child;

try {
  await fs.copyFile(path.join(release, serverName), path.join(temp, serverName));
  const config = JSON.parse(await fs.readFile(path.join(release, "config.json"), "utf8"));
  config.port = port;
  await fs.writeFile(path.join(temp, "config.json"), JSON.stringify(config, null, 2));

  child = spawn(path.join(temp, serverName), [], {
    cwd: temp,
    stdio: "ignore",
    windowsHide: true,
  });

  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/health");
      if (response.ok && (await response.text()) === "ok") {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.ok(ready, "the packaged server did not answer its health check");
  console.log("Release server passed its health check.");
} finally {
  if (child && child.exitCode === null) {
    child.kill();
    await once(child, "exit");
  }
  await fs.rm(temp, { recursive: true, force: true });
}
