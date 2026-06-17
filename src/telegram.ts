import { handleJarvisInput } from "./core.js";
import { transcribeAudio } from "./transcription.js";
import { generateTTSBuffer } from "./llm.js";
import { BRAK_REMINDER_MESSAGE, startDailyReminder } from "./reminders.js";

/**
 * Startar polling-loopen för Telegram-boten om API-nycklar finns konfigurerade.
 * Låser åtkomsten till ett specifikt användar-ID för säkerhet.
 */
export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const allowedUserRaw = process.env.TELEGRAM_USER_ID;

  if (!token || !allowedUserRaw) {
    console.log("[Telegram] TELEGRAM_BOT_TOKEN eller TELEGRAM_USER_ID saknas. Telegram-bot startas ej.");
    return;
  }

  const allowedUser = Number(allowedUserRaw.trim());
  if (isNaN(allowedUser)) {
    console.error("[Telegram] Ogiltigt TELEGRAM_USER_ID i .env (måste vara ett nummer).");
    return;
  }

  console.log(`[Telegram] Startar bot. Låst till User ID: ${allowedUser}`);
  let offset = 0;
  let running = true;
  const stopBrakReminder = startDailyReminder({
    hour: 5,
    minute: 0,
    timeZone: "Europe/Stockholm",
    label: "BRAK",
    message: BRAK_REMINDER_MESSAGE,
    onReminder: (message) => sendTelegramMessage(allowedUser, message, token)
  });

  console.log("[Telegram] Daglig BRAK-påminnelse aktiv kl. 05:00 Europe/Stockholm.");

  async function poll() {
    while (running) {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`
        );

        if (!response.ok) {
          console.error(`[Telegram] getUpdates returnerade status ${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        const data = (await response.json()) as {
          ok: boolean;
          result?: Array<{ update_id: number; message?: any }>;
        };

        if (data.ok && data.result && data.result.length > 0) {
          for (const update of data.result) {
            offset = update.update_id + 1;
            if (update.message) {
              handleUpdate(update.message, token!, allowedUser).catch((err) => {
                console.error("[Telegram] Kunde inte hantera meddelande:", err);
              });
            }
          }
        }
      } catch (error) {
        console.error("[Telegram] Fel i polling-loop:", error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  poll();

  return () => {
    running = false;
    stopBrakReminder();
    console.log("[Telegram] Polling-loop stoppad.");
  };
}

async function handleUpdate(message: any, token: string, allowedUser: number) {
  const chat = message.chat;
  const from = message.from;

  if (!from || from.id !== allowedUser) {
    console.warn(`[Telegram] Ignorerar obehörigt meddelande från ID: ${from?.id}, Användarnamn: ${from?.username}`);
    return;
  }

  try {
    if (message.text) {
      const text = message.text.trim();
      console.log(`[Telegram] Textmeddelande: "${text}"`);

      await sendChatAction(chat.id, "typing", token);
      const result = await handleJarvisInput(text);

      if (result.reply) {
        await sendTelegramMessage(chat.id, result.reply, token);

        const voiceEnabled = (process.env.JARVIS_TELEGRAM_VOICE || "true").toLowerCase() === "true";
        if (voiceEnabled) {
          await sendChatAction(chat.id, "record_voice", token);
          const voiceBuffer = await generateTTSBuffer(result.reply);
          if (voiceBuffer) {
            await sendTelegramVoice(chat.id, voiceBuffer, token);
          }
        }
      }
    } else if (message.voice) {
      const voice = message.voice;
      console.log(`[Telegram] Röstmeddelande mottaget. File ID: ${voice.file_id}, längd: ${voice.duration}s`);

      await sendChatAction(chat.id, "typing", token);

      // 1. Hämta filens sökväg från Telegrams API
      const fileResponse = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${voice.file_id}`);
      if (!fileResponse.ok) {
        throw new Error(`Kunde inte hämta filinfo: ${fileResponse.status}`);
      }

      const fileData = (await fileResponse.json()) as {
        ok: boolean;
        result?: { file_path: string };
      };

      if (!fileData.ok || !fileData.result?.file_path) {
        throw new Error("Telegram returnerade ogiltig filinfo.");
      }

      const filePath = fileData.result.file_path;

      // 2. Ladda ner filens binära data
      const downloadResponse = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      if (!downloadResponse.ok) {
        throw new Error(`Kunde inte ladda ner ljudfilen: ${downloadResponse.status}`);
      }

      const audioBuffer = Buffer.from(await downloadResponse.arrayBuffer());

      // 3. Skicka till Whisper
      const transcriptResult = await transcribeAudio({
        audio: audioBuffer,
        mimeType: "audio/ogg",
        durationMs: voice.duration * 1000
      });

      const transcript = typeof transcriptResult === "string" ? transcriptResult : transcriptResult.transcript;

      if (!transcript) {
        await sendTelegramMessage(chat.id, "Jag hörde dig inte riktigt. Kan du ta det igen?", token);
        return;
      }

      console.log(`[Telegram] Transkriberat: "${transcript}"`);
      await sendTelegramMessage(chat.id, `👉 _${transcript}_`, token, "Markdown");

      // 4. Skicka transkriptionen till Jarvis
      await sendChatAction(chat.id, "typing", token);
      const result = await handleJarvisInput(transcript);

      if (result.reply) {
        await sendTelegramMessage(chat.id, result.reply, token);

        // 5. Generera och skicka röstsvar
        await sendChatAction(chat.id, "record_voice", token);
        const voiceBuffer = await generateTTSBuffer(result.reply);
        if (voiceBuffer) {
          await sendTelegramVoice(chat.id, voiceBuffer, token);
        }
      }
    } else {
      await sendTelegramMessage(chat.id, "Jag förstår bara text och röstmeddelanden än så länge.", token);
    }
  } catch (error) {
    console.error("[Telegram] Misslyckades med att behandla meddelandet:", error);
    const msg = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chat.id, `Något small: ${msg}`, token);
  }
}

async function sendChatAction(chatId: number, action: "typing" | "record_voice", token: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action })
    });
  } catch (err) {
    console.error("[Telegram] Kunde inte skicka chat action:", err);
  }
}

async function sendTelegramMessage(chatId: number, text: string, token: string, parseMode?: string) {
  const body: { chat_id: number; text: string; parse_mode?: string } = {
    chat_id: chatId,
    text
  };

  if (parseMode) {
    body.parse_mode = parseMode;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    console.error(`[Telegram] sendMessage misslyckades: ${response.status}`, await response.text());
  }
}

async function sendTelegramVoice(chatId: number, voiceBuffer: Buffer, token: string) {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));

  const blob = new Blob([new Uint8Array(voiceBuffer)], { type: "audio/mpeg" });
  formData.append("voice", blob, "reply.mp3");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[Telegram] sendVoice misslyckades: ${response.status}`, body);
    await sendTelegramAudio(chatId, voiceBuffer, token);
  }
}

async function sendTelegramAudio(chatId: number, audioBuffer: Buffer, token: string) {
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  formData.append("title", "Jarvis");

  const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/mpeg" });
  formData.append("audio", blob, "jarvis-reply.mp3");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    console.error(`[Telegram] sendAudio misslyckades: ${response.status}`, await response.text());
  }
}
