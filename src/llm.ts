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

export async function generateTTSBuffer(text: string, voiceOverride?: string): Promise<Buffer | null> {
  if (!process.env.OPENAI_API_KEY || !text) {
    return null;
  }

  const voice = voiceOverride || process.env.JARVIS_VOICE || "onyx";
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

export async function getTrainingSmartMatch(
  systemPrompt: string,
  userPrompt: string
): Promise<{
  matched: boolean;
  trackId: string | null;
  levelIdx: number | null;
  levelName: string | null;
  target: string | null;
  trackName: string | null;
  confidence: number;
  explanation: string;
}> {
  const provider = resolveProvider();

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_CLASSIFIER_MODEL || "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 150,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI for training match failed with status ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(raw);
  }

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.JARVIS_MODEL || "claude-3-5-sonnet-20241022";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 250,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt + "\nRespond strictly with JSON. No other text." }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic for training match failed with status ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((part) => part.type === "text")?.text || "{}";
    try {
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}") + 1;
      const jsonStr = text.slice(jsonStart, jsonEnd);
      return JSON.parse(jsonStr);
    } catch {
      throw new Error("Kunde inte parsa JSON-svar från Anthropic: " + text);
    }
  }

  // Fallback / Mock
  return {
    matched: false,
    trackId: null,
    levelIdx: null,
    levelName: null,
    target: null,
    trackName: null,
    confidence: 0,
    explanation: "Mock mode - no real LLM integration."
  };
}

export async function getCalendarSmartAction(
  systemPrompt: string,
  userPrompt: string
): Promise<{
  action: "add" | "update" | "delete" | "list" | "none";
  eventId: string | null;
  addEvent: {
    title: string;
    startsAt: string;
    endsAt: string | null;
    location: string | null;
    notes: string | null;
  } | null;
  updateEvent: {
    title: string | null;
    startsAt: string | null;
    endsAt: string | null;
    location: string | null;
    notes: string | null;
  } | null;
  explanation: string;
}> {
  const provider = resolveProvider();

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_CLASSIFIER_MODEL || "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI for calendar match failed with status ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(raw);
  }

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.JARVIS_MODEL || "claude-3-5-sonnet-20241022";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt + "\nRespond strictly with JSON. No other text." }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic for calendar match failed with status ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((part) => part.type === "text")?.text || "{}";
    try {
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}") + 1;
      const jsonStr = text.slice(jsonStart, jsonEnd);
      return JSON.parse(jsonStr);
    } catch {
      throw new Error("Kunde inte parsa JSON-svar från Anthropic: " + text);
    }
  }

  // Fallback / Mock
  return {
    action: "none",
    eventId: null,
    addEvent: null,
    updateEvent: null,
    explanation: "Mock mode - no real LLM integration."
  };
}

export async function generateDynamicWorkout(
  activeItem: any,
  currentLevels: any,
  location?: "hemma" | "utegym"
): Promise<{
  workoutText: string;
  exercisesToLog: Array<{ name: string; mode: "reps" | "hold"; sets: number[] }>;
}> {
  const provider = resolveProvider();

  const locationBlock =
    location === "hemma"
      ? `\n\nVIKTIGT – Jimmy tränar HEMMA idag. Tillgänglig utrustning: golv, parallettes/låga barr, hantlar och kettlebell. Det finns INGEN pull-up-stång eller räcke hemma. Föreslå därför INGA hängande övningar eller stångövningar (inga Pull-ups, Australiska rows, Scapula-pulls i stången, Hängande knälyft, Hängande benlyft, Tuck front lever, muscle-up). Använd golv- och parallettes-varianter istället (armhävningar, pike push-ups, pseudo planche-lutning, hollow hold, L-sit, side plank, väggstående handstativ, liggande benlyft, split squats/pistols).`
      : location === "utegym"
        ? `\n\nVIKTIGT – Jimmy tränar på UTEGYM idag. Tillgänglig utrustning: pull-up-stång, räcke och parallel bars (men INGA ringar). Prioritera stång- och räckesövningar: pull-ups, australiska rows, scapula-pulls, hängande knä-/benlyft, tuck front lever och dips på barren — utöver fokusövningarna.`
        : "";

  const systemPrompt = `Du är Jarvis, en personlig, kaxig och intelligent AI-tränare för användaren Jimmy.
Din uppgift är att generera ett skräddarsytt träningspass baserat på användarens nuvarande nivåer och deras aktiva kampanjvecka/slutboss.

Användaren tränar calisthenics för att uppnå elitskills. OBS: Jimmy har INGA romerska ringar hemma eller på utegymmet, så föreslå ALDRIG övningar som kräver ringar (t.ex. ring dips eller iron cross). Kompensera med barren (parallel bars) eller räcket (bar) istället.
Du ska svara med ett JSON-objekt som innehåller:
1. "workoutText": En inspirerande, kaxig och välstrukturerad punktlista på svenska med uppvärmning, fokusövningar (från den aktiva kampanjveckans kriterier), kompletterande styrka och nedvarvning. Skriv på ett sätt som passar en kaxig tränare.
2. "exercisesToLog": En lista över övningar som ska loggas i databasen för detta pass. Varje övning i listan MÅSTE matcha exakt ett av namnen i följande katalog av tillgängliga övningar:
- "Pull-ups" (mode: reps)
- "Australiska rows" (mode: reps)
- "Scapula-pulls" (mode: reps)
- "Negativa pull-ups" (mode: reps)
- "Dips (band)" (mode: reps)
- "Dips negativa" (mode: reps)
- "Dips" (mode: reps)
- "Armhävningar" (mode: reps)
- "Pike push-ups" (mode: reps)
- "Pseudo planche push-ups" (mode: reps)
- "Hängande knälyft" (mode: reps)
- "Hängande benlyft" (mode: reps)
- "Liggande benlyft" (mode: reps)
- "Side plank" (mode: hold)
- "Hollow hold" (mode: hold)
- "Tuck front lever" (mode: hold)
- "Support-hållning" (mode: hold)
- "Pseudo planche-lutning" (mode: hold)
- "Väggstående handstativ" (mode: hold)
- "Frigående handstativ" (mode: hold)
- "Vertikal flagga" (mode: hold)
- "Tuck-flagga" (mode: hold)
- "Straddle-flagga" (mode: hold)
- "Knäböj" (mode: reps)
- "Split squats" (mode: reps)
- "Pistol-progression" (mode: reps)
- "Jumping jacks" (mode: reps)
- "Mountain climbers" (mode: reps)
- "High knees" (mode: reps)
- "Armcirklar & axelprep" (mode: reps)
- "Handleds-stretch & prep" (mode: hold)
- "Benböj (uppvärmning)" (mode: reps)
- "Burpees (lågt tempo)" (mode: reps)
- "Scapula-pulls i stången" (mode: reps)
- "Frog stand" (mode: hold)
- "L-sit" (mode: hold)
- "Skin the cat" (mode: reps)
- "Back lever" (mode: hold)
- "Dragon flag" (mode: reps)
- "Straight Bar Inclined Push Up" (mode: reps)
- "Straight Bar Push Up" (mode: reps)
- "Dip Shrug" (mode: reps)
- "Dip Hold" (mode: hold)
- "Assisted Dip" (mode: reps)
- "Ring Hold" (mode: hold)
- "Overhead Ring Fly" (mode: reps)
- "Ring Fly" (mode: reps)
- "Ring Push Up" (mode: reps)
- "Ring Tricep Extension" (mode: reps)
- "Straight Bar Dip" (mode: reps)
- "Assisted Handstand with Parallettes" (mode: hold)
- "Tricep Extension" (mode: reps)
- "Decline Push Up" (mode: reps)
- "Archer Dip" (mode: reps)
- "Assisted Straddle Planche" (mode: hold)
- "Elbow Hold" (mode: hold)
- "L-Sit to Handstand" (mode: reps)
- "Press to Handstand" (mode: reps)
- "Handstand Push Up" (mode: reps)
- "Iguana Handstand" (mode: hold)
- "Straight Bar Handstand" (mode: hold)
- "Straddle Planche" (mode: hold)
- "Assisted Straddle Planche Push Up" (mode: reps)
- "Assisted Planche Push Up" (mode: reps)
- "Bent Arm Planche" (mode: hold)
- "Russian Dip" (mode: reps)
- "Deep Handstand Push Up" (mode: reps)
- "90 Degree Handstand Push Up" (mode: reps)
- "One Arm Handstand" (mode: hold)
- "Assisted One Arm Handstand Push Up" (mode: reps)
- "Straight Bar Planche" (mode: hold)
- "Planche" (mode: hold)

Ange endast relevanta övningar från listan som matchar dagens fokus. Varje övning ska ha "name", "mode" ("reps" eller "hold") samt "sets" (en array med standardvärden, t.ex. [0, 0, 0] för 3 set, eller t.ex. [20, 20, 20] för sekunder hålltid).

Du MÅSTE respektera användarens utvecklingsnivåer ("currentLevels"):
- Om currentLevels.ready.flag är false, får du absolut INTE inkludera "Vertikal flagga", "Tuck-flagga", "Straddle-flagga" eller några flagg-försök i passet.
- Om currentLevels.ready.front är false, får du absolut INTE inkludera "Tuck front lever" eller några front lever-övningar i passet.
- Om currentLevels.ready.muscleUp är false, får du absolut INTE inkludera muscle-up-relaterade övningar i passet.

Formatet ska vara strikt JSON:
{
  "workoutText": "Sträng i markdown-format",
  "exercisesToLog": [
    { "name": "Övningsnamn", "mode": "reps" | "hold", "sets": [number, number, ...] }
  ]
}`;

  const userPrompt = `Aktiv kampanjvecka: Tier ${activeItem.tierIdx} (${activeItem.tierName}) - Vecka ${activeItem.weekIdx || "Boss"}: ${activeItem.boss}
Fokus: ${activeItem.focus}
Krav/Kriterier: ${activeItem.criteria}

Användarens nuvarande nivåer:
${JSON.stringify(currentLevels, null, 2)}${locationBlock}`;

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI dynamic workout failed with status ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content || "{}";
    return JSON.parse(raw);
  }

  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const model = process.env.JARVIS_MODEL || "claude-3-5-sonnet-20241022";
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt + "\nRespond strictly with JSON. No other text." }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic dynamic workout failed with status ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = data.content?.find((part) => part.type === "text")?.text || "{}";
    try {
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}") + 1;
      const jsonStr = text.slice(jsonStart, jsonEnd);
      return JSON.parse(jsonStr);
    } catch {
      throw new Error("Kunde inte parsa JSON-svar från Anthropic: " + text);
    }
  }

  // Fallback / Mock
  return {
    workoutText: `### Dagens pass: Hemmafokus (MOCK)
Hörru, eftersom du kör utan API-nyckel så får du ett mockat pass. Men gör det ordentligt ändå!

**Uppvärmning:**
- Handledsrotationer 2 min
- Skulderbladshävningar 2×10

**Fokus:**
- Pseudo planche-lutning 3×20s (Formen är allt, Jimmy!)
- Väggstående handstativ 3×40s

**Styrka:**
- Armhävningar 3×10
- Hollow hold 3×30s`,
    exercisesToLog: [
      { name: "Pseudo planche-lutning", mode: "hold", sets: [20, 20, 20] },
      { name: "Väggstående handstativ", mode: "hold", sets: [40, 40, 40] },
      { name: "Armhävningar", mode: "reps", sets: [10, 10, 10] },
      { name: "Hollow hold", mode: "hold", sets: [30, 30, 30] }
    ]
  };
}
