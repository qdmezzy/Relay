import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(root, "desktop", "assets");
const source = path.join(assets, "icon-source.png");

const SIZES = [16, 24, 32, 48, 64, 128, 256];

const work = await fs.mkdtemp(path.join(os.tmpdir(), "relay-icon-"));

const ps = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile('${source.replace(/\\/g, "\\\\")}')
foreach ($size in ${SIZES.join(",")}) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($src, 0, 0, $size, $size)
  $bmp.Save((Join-Path '${work.replace(/\\/g, "\\\\")}' "$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$src.Dispose()
`;

const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
  encoding: "utf8",
});
if (result.status !== 0) {
  throw new Error("could not resize the icon:\n" + (result.stderr || result.stdout));
}

const entries = [];
for (const size of SIZES) {
  entries.push({ size, png: await fs.readFile(path.join(work, size + ".png")) });
}

const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);

const dir = Buffer.alloc(entries.length * 16);
let offset = 6 + dir.length;
entries.forEach((entry, i) => {
  const o = i * 16;
  dir[o] = entry.size === 256 ? 0 : entry.size;
  dir[o + 1] = entry.size === 256 ? 0 : entry.size;
  dir[o + 2] = 0;
  dir[o + 3] = 0;
  dir.writeUInt16LE(1, o + 4);
  dir.writeUInt16LE(32, o + 6);
  dir.writeUInt32LE(entry.png.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += entry.png.length;
});

await fs.mkdir(assets, { recursive: true });
await fs.writeFile(
  path.join(assets, "icon.ico"),
  Buffer.concat([header, dir, ...entries.map((e) => e.png)])
);
await fs.rm(work, { recursive: true, force: true });

console.log("icon.ico written with " + entries.map((e) => e.size).join(", "));
