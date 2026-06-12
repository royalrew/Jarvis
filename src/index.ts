import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { initDb } from "./db.js";
import { handleJarvisInput } from "./core.js";
import { startTelegramBot } from "./telegram.js";

initDb();
startTelegramBot();

const rl = readline.createInterface({ input, output });

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Jarvis> Starten small: ${message}`);
  process.exitCode = 1;
});

async function main() {
  console.log("Jarvis v0.1 text-loop");
  console.log("Skriv /exit för att avsluta, /remember för minne, /jargon fras = betydelse för jargong.\n");

  rl.setPrompt("Jimmy> ");
  rl.prompt();

  for await (const rawLine of rl) {
    const result = await handleJarvisInput(rawLine.trim());

    if (result.reply) {
      console.log(`Jarvis> ${result.reply}\n`);
    }

    if (!result.shouldContinue) {
      break;
    }

    rl.prompt();
  }

  rl.close();
}
