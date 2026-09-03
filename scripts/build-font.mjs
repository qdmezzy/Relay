import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "node_modules", "@fontsource", "jua");
const assets = path.join(root, "desktop", "assets");

await fs.mkdir(assets, { recursive: true });
await fs.copyFile(
  path.join(packageRoot, "files", "jua-korean-400-normal.woff2"),
  path.join(assets, "jua.woff2"),
);
await fs.copyFile(
  path.join(packageRoot, "LICENSE"),
  path.join(assets, "JUA-LICENSE.txt"),
);
