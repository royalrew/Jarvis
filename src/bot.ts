import "dotenv/config";
import { initDb } from "./db.js";
import { startTelegramBot } from "./telegram.js";

initDb();

const stopTelegramBot = startTelegramBot();

console.log("[Jarvis Bot] Headless Telegram worker started.");

function shutdown(signal: string) {
  console.log(`[Jarvis Bot] ${signal} received, shutting down.`);
  stopTelegramBot?.();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
