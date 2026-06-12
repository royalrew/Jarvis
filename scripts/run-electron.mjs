import { spawn } from "node:child_process";
import path from "node:path";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const electronPath =
  process.platform === "win32"
    ? path.join("node_modules", "electron", "dist", "electron.exe")
    : path.join("node_modules", ".bin", "electron");

const child = spawn(electronPath, ["."], {
  env,
  stdio: "inherit",
  windowsHide: false
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
