import type { ConversationMessage } from "./types.js";

export async function getJarvisReply(systemPrompt: string, messages: ConversationMessage[], imageBase64?: string) {
  const provider = resolveProvider();

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return callAnthropic(systemPrompt, messages, imageBase64);
  }

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return callOpenAI(systemPrompt, messages, imageBase64);
  }

  return getMockReply(messages);
}

function resolveProvider() {
  const configuredProvider = (process.env.JARVIS_PROVIDER || "auto").toLowerCase();

  if (configuredProvider !== "auto") {
    return configuredProvider;
  }

  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }

  return "mock";
}

async function callAnthropic(systemPrompt: string, messages: ConversationMessage[], imageBase64?: string) {
  const model = process.env.JARVIS_MODEL;

  if (!model) {
    throw new Error("JARVIS_MODEL saknas i .env när JARVIS_PROVIDER=anthropic.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: 450,
      system: systemPrompt,
      messages: messages
        .filter((message) => message.role !== "system")
        .map((message, i, arr) => {
          if (imageBase64 && i === arr.length - 1 && message.role === "user") {
            return {
              role: message.role,
              content: [
                { type: "text", text: message.content },
                { type: "image", source: { type: "base64", media_type: "image/png", data: imageBase64 } }
              ]
            };
          }
          return { role: message.role, content: message.content };
        })
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic svarade ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const text = data.content?.find((part) => part.type === "text")?.text;
  return text?.trim() || "Jag fick ett tomt svar. Snyggt. Inte direkt mitt starkaste ögonblick.";
}

async function callOpenAI(systemPrompt: string, messages: ConversationMessage[], imageBase64?: string) {
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  const filtered = messages.filter((m) => m.role !== "system");
  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...filtered.map((m, i) => {
      if (imageBase64 && i === filtered.length - 1 && m.role === "user") {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content },
            { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}`, detail: "auto" } }
          ]
        };
      }
      return { role: m.role, content: m.content };
    })
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      max_tokens: 450,
      messages: apiMessages
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI svarade ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content;
  return text?.trim() || "Jag fick ett tomt svar. Imponerande, fast på fel sätt.";
}

function getMockReply(messages: ConversationMessage[]) {
  const latest = messages.at(-1)?.content.toLowerCase() || "";

  if (latest.includes("minns") || latest.includes("kom ihåg")) {
    return "Säg `/remember ...` så sparar jag det ordentligt. Jag kan gissa, men vi bygger inte minnet på feeling och lösryckta vibes.";
  }

  if (latest.includes("jargong") || latest.includes("skämt")) {
    return "Yes. Säg `/jargon fras = betydelse` så lägger jag in den. Interna skämt ska sitta med kirurgisk timing, annars blir det bara after work på Teams.";
  }

  if (latest.includes("överbygger") || latest.includes("för mycket")) {
    return "Jimmy, du är nära rymdskepp-av-skruvmejsel-zonen nu. Gör minsta fungerande versionen först.";
  }

  return "Jag är i mock-läge, men jag lever. Säg vad vi ska reda ut, så håller jag det kort och med lite ryggrad.";
}

export async function generateTTSBuffer(text: string): Promise<Buffer | null> {
  if (!process.env.OPENAI_API_KEY || !text) {
    return null;
  }

  const voice = process.env.JARVIS_VOICE || "onyx";
  const model = process.env.JARVIS_TTS_MODEL || "tts-1";

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model, voice, input: text, response_format: "mp3" })
  });

  if (!response.ok) {
    console.error("[Jarvis TTS] misslyckades:", response.status, await response.text());
    return null;
  }

  return Buffer.from(await response.arrayBuffer());
}

