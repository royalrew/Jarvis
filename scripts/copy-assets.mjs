import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const assets = [
  "electron.cjs",
  "renderer.html",
  "renderer.css",
  "renderer.js",
  "trigger.html",
  "trigger.css",
  "trigger.js",
  "preload.cjs"
];

await mkdir(path.join(root, "dist"), { recursive: true });

await Promise.all(
  assets.map((asset) => copyFile(path.join(root, "src", asset), path.join(root, "dist", asset)))
);
