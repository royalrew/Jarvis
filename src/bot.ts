import "dotenv/config";
import { initDb } from "./db.js";
import { initFrenchDb } from "./french/db.js";
import { startTelegramBot } from "./telegram.js";

await initDb();
await initFrenchDb();

const stopTelegramBot = startTelegramBot();

console.log("[Jarvis Bot] Headless Telegram worker started.");

function shutdown(signal: string) {
  console.log(`[Jarvis Bot] ${signal} received, shutting down.`);
  stopTelegramBot?.();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
