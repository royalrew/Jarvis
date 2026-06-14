import { getJargon, getMemories, upsertImprovementSuggestion } from "./db.js";

type TranscriptionPayload = {
  audio: ArrayBuffer | Uint8Array;
  mimeType?: string;
  durationMs?: number;
};

export type TranscriptionResult = {
  transcript: string;
  raw: string;
};

export async function transcribeAudio(payload: TranscriptionPayload): Promise<TranscriptionResult> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY saknas i .env. Scroll-knappen funkar, men öronen är inte inkopplade än.");
  }

  const audio = toBuffer(payload.audio);

  if (audio.length < 1200 || (payload.durationMs && payload.durationMs < 350)) {
    return { transcript: "", raw: "" };
  }

  const raw = await transcribeWithOpenAI(audio, payload.mimeType);
  console.log("[Jarvis transkribering] Rå:", JSON.stringify(raw));

  const refined = await refineTranscript(raw);
  console.log("[Jarvis transkribering] Raffinerad:", JSON.stringify(refined));

  return { transcript: refined || raw, raw };
}

async function transcribeWithOpenAI(audio: Buffer, mimeType = "audio/webm") {
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
  const audioCopy = new ArrayBuffer(audio.byteLength);
  new Uint8Array(audioCopy).set(audio);
  const file = new Blob([audioCopy], { type: mimeType });
  const formData = new FormData();

  formData.append("file", file, getAudioFilename(mimeType));
  formData.append("model", model);
  formData.append("language", process.env.OPENAI_TRANSCRIBE_LANGUAGE || "sv");
  formData.append("response_format", "json");
  formData.append("prompt", buildTranscriptionPrompt());

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Transkriberingen small (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { text?: string };
  return String(data.text || "").trim();
}

async function refineTranscript(rawTranscript: string) {
  const enabled = (process.env.OPENAI_TRANSCRIPT_REFINEMENT || "false").toLowerCase() === "true";

  if (!enabled || !rawTranscript || rawTranscript.length < 4) {
    return rawTranscript;
  }

  const model = process.env.OPENAI_TRANSCRIPT_REFINER_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 240,
      messages: [
        {
          role: "system",
          content: [
            "Du korrigerar MINIMALT ett svenskt rösttranskript.",
            "Rätta bara uppenbara felstavningar på egennamn och tekniska termer i ordlistan.",
            "LÄGG ALDRIG TILL ord, fraser eller meningar som inte finns i transkriptet.",
            "Om du är osäker — returnera originalet oförändrat.",
            "Svara bara med det korrigerade transkriptet, inget annat."
          ].join(" ")
        },
        {
          role: "user",
          content: `Egennamn och termer:\n${buildTermsGlossary()}\n\nTranskript:\n${rawTranscript}`
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    await upsertImprovementSuggestion(
      "Robust fallback för transkriptputsning",
      `Efterkorrigering av transkript misslyckades: ${response.status} ${body}`,
      "Låt Jarvis använda rå transkribering tyst när putsning fallerar, och visa bara ett diskret förbättringsförslag i backlogen.",
      3,
      "transcription"
    );
    return rawTranscript;
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content?.trim() || rawTranscript;
}

function buildTranscriptionPrompt() {
  return [
    "Transkribera exakt svenska. Egennamn och termer:",
    buildTermsGlossary()
  ].join("\n");
}

function buildTermsGlossary() {
  const staticTerms = [
    "Jimmy",
    "Jarvis",
    "Sintari Display",
    "Sintari",
    "Codex",
    "Cursor",
    "Claude",
    "OpenAI",
    "Electron",
    "TypeScript",
    "SQLite",
    "Töreboda",
    "hemtjänsten"
  ];

  const envTerms = (process.env.JARVIS_TRANSCRIBE_TERMS || "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);

  return [...staticTerms, ...envTerms].map((term) => `- ${term}`).join("\n");
}

function getAudioFilename(mimeType: string) {
  if (mimeType.includes("wav")) {
    return "speech.wav";
  }

  if (mimeType.includes("mp4")) {
    return "speech.mp4";
  }

  return "speech.webm";
}

function toBuffer(audio: ArrayBuffer | Uint8Array) {
  if (audio instanceof Uint8Array) {
    return Buffer.from(audio);
  }

  return Buffer.from(audio);
}
