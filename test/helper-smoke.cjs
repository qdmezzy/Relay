const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = path.join(root, ".release", "runtime", "Relay Helper.exe");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "relay-helper-"));
const helperPath = path.join(temp, "Relay Helper Smoke.exe");
const runtimeStates = [];
const baseId = Date.now();
const commands = [
  { id: baseId + 1, action: "selection-popup", value: "false" },
  { id: baseId + 2, action: "selection-popup", value: "true" },
];
let child;

fs.copyFileSync(source, helperPath);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    res.end("ok");
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/control") {
    const after = Number(url.searchParams.get("after") || 0);
    const command = commands.find((item) => item.id > after);
    res.end(command ? [command.id, command.action, command.value].join("\t") : "");
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/runtime") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { runtimeStates.push(JSON.parse(body)); } catch {}
      res.setHeader("Content-Type", "application/json");
      res.end("{}");
    });
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

function waitFor(predicate, timeout = 7000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error("helper did not report both popup states"));
      }
    }, 80);
  });
}

server.listen(0, "127.0.0.1", async () => {
  try {
    const port = server.address().port;
    child = spawn(helperPath, [], {
      cwd: temp,
      env: { ...process.env, RELAY_PORT: String(port) },
      windowsHide: true,
      stdio: "ignore",
    });
    await waitFor(() => {
      const disabled = runtimeStates.findIndex((state) => state.selectionPopupEnabled === false);
      const enabledAgain = runtimeStates.findIndex((state, index) => index > disabled && state.selectionPopupEnabled === true);
      return disabled >= 0 && enabledAgain > disabled;
    });
    assert.equal(runtimeStates.at(-1).selectionPopupEnabled, true);
    console.log("Compiled helper passed popup state and custom-port checks.");
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
