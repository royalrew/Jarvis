import type { Channel } from "./db.js";

/**
 * LLM-kontraktet (M2). LLM:en bedömer och klassificerar — extraherar reviews,
 * nya items och fel som det deterministiska lagret sedan agerar på. Den
 * schemalägger aldrig själv.
 *
 * Vi använder OpenAI med JSON-läge (matchar resten av Jarvis i src/llm.ts) och
 * normaliserar/validerar svaret i kod istället för strikt json_schema, eftersom
 * kontraktet har flera valfria fält.
 */

export interface TutorReview {
  item_lemma: string;
  facet_kind: "meaning" | "production" | "pronunciation";
  grade: number; // 1–4
  confidence: "high" | "low";
}

export interface TutorNewItem {
  lemma: string;
  meta: {
    genre?: string;
    svensk_ljudharmning: string;
    translation: string;
  };
  phonemes: string[];
}

export interface TutorError {
  category: string;
  utterance: string;
  correction: string;
  uttalstips_sv?: string;
}

export interface TutorTurn {
  reply: string; // alltid på franska
  explanation_sv?: string;
  reviews: TutorReview[];
  new_items: TutorNewItem[];
  errors: TutorError[];
}

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Kör ett konversationsturn genom LLM:en och får tillbaka det strukturerade
 * TutorTurn-kontraktet. `channel` säger om Jimmys senaste svar var text eller
 * röst — det styr hur LLM:en ska tänka kring vilka facetter den kan bedöma.
 */
export async function callTutorTurn(
  systemPrompt: string,
  messages: TutorMessage[],
  channel: Channel
): Promise<TutorTurn> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return mockTurn(messages);
  }

  const model = process.env.FRENCH_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
  const channelNote =
    channel === "voice"
      ? "Jimmys SENASTE svar kom via RÖST (transkriberat). Du kan bedöma 'meaning' och 'pronunciation', men ALDRIG 'production' (stavning) — du ser inte hur han stavade."
      : "Jimmys SENASTE svar kom via TEXT. Du kan bedöma 'meaning' och 'production' (stavning), men ALDRIG 'pronunciation' (uttal) — du hör honom inte.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.6,
      max_tokens: 900,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: channelNote + "\n\n" + SCHEMA_INSTRUCTIONS },
        ...messages
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI (fransk-tutor) svarade ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content || "{}";
  return normalizeTurn(JSON.parse(raw));
}

const SCHEMA_INSTRUCTIONS = [
  "Svara ENDAST med ett JSON-objekt med exakt dessa fält:",
  "{",
  '  "reply": string,            // ditt svar till Jimmy, ALLTID på franska',
  '  "explanation_sv": string,   // valfri kort förklaring på svenska (utelämna om onödig)',
  '  "reviews": [                // ord/fraser Jimmy använde som du nu bedömer',
  '    { "item_lemma": string, "facet_kind": "meaning"|"production"|"pronunciation", "grade": 1-4, "confidence": "high"|"low" }',
  "  ],",
  '  "new_items": [              // nya ord värda att lära in',
  '    { "lemma": string, "meta": { "genre": string?, "svensk_ljudharmning": string, "translation": string }, "phonemes": string[] }',
  "  ],",
  '  "errors": [                 // konkreta fel att rätta',
  '    { "category": string, "utterance": string, "correction": string, "uttalstips_sv": string? }',
  "  ]",
  "}",
  "",
  "Regler:",
  "- svensk_ljudharmning = ett försvenskat, lättläst uttalstips, t.ex. 'wazo' för 'oiseau'.",
  "- Vid uttalsfel: fyll uttalstips_sv med en pragmatisk svensk stavning av hur det SKA låta.",
  "- grade: 1=fel/blank, 2=tveksamt, 3=rätt med ansträngning, 4=lätt och korrekt.",
  "- Sätt INTE reviews för en facet_kind som den aktuella kanalen inte kan bedöma.",
  "- Alla arrayer ska finnas med (tomma [] om inget passar). reply får aldrig vara tom."
].join("\n");

function normalizeTurn(obj: unknown): TutorTurn {
  const o = (obj ?? {}) as Record<string, unknown>;
  return {
    reply: typeof o.reply === "string" && o.reply.trim() ? o.reply.trim() : "On continue ?",
    explanation_sv: typeof o.explanation_sv === "string" && o.explanation_sv.trim() ? o.explanation_sv.trim() : undefined,
    reviews: Array.isArray(o.reviews) ? (o.reviews as TutorReview[]).filter(isValidReview) : [],
    new_items: Array.isArray(o.new_items) ? (o.new_items as TutorNewItem[]).filter(isValidNewItem) : [],
    errors: Array.isArray(o.errors) ? (o.errors as TutorError[]).filter(isValidError) : []
  };
}

function isValidReview(r: unknown): r is TutorReview {
  const x = r as TutorReview;
  return (
    !!x &&
    typeof x.item_lemma === "string" &&
    ["meaning", "production", "pronunciation"].includes(x.facet_kind) &&
    typeof x.grade === "number"
  );
}

function isValidNewItem(r: unknown): r is TutorNewItem {
  const x = r as TutorNewItem;
  return !!x && typeof x.lemma === "string" && !!x.meta && typeof x.meta.translation === "string";
}

function isValidError(r: unknown): r is TutorError {
  const x = r as TutorError;
  return !!x && typeof x.category === "string" && typeof x.correction === "string";
}

export interface QuizJudgement {
  grade: number; // 1–4
  correct: boolean;
  feedback_sv: string;
  correction?: string;
  uttalstips_sv?: string;
}

/**
 * Domare för en enskild provfråga. Bedömer Jimmys svar mot det förväntade ordet
 * och kanalen (text = stavning, röst = uttal). Returnerar ett grade 1–4 som det
 * deterministiska lagret sedan kör genom FSRS.
 */
export async function judgeQuizAnswer(
  prompt: string,
  expectedLemma: string,
  translation: string,
  answer: string,
  channel: Channel
): Promise<QuizJudgement> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const correct = answer.toLowerCase().includes(expectedLemma.toLowerCase());
    return { grade: correct ? 3 : 1, correct, feedback_sv: "(mock-läge) " + (correct ? "Rätt." : `Rätt svar: ${expectedLemma}`) };
  }

  const model = process.env.FRENCH_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
  const channelNote =
    channel === "voice"
      ? "Svaret kom via RÖST (transkriberat) — bedöm uttal/korrekthet, var överseende med transkriptionsbrus i accenter."
      : "Svaret kom via TEXT — bedöm stavning och korrekthet exakt.";

  const sys = [
    "Du rättar en fransk provfråga. Förväntat ord/svar och Jimmys svar ges.",
    channelNote,
    'Svara ENDAST med JSON: { "grade": 1-4, "correct": bool, "feedback_sv": string, "correction": string?, "uttalstips_sv": string? }',
    "grade: 1=fel/blank, 2=nära men fel, 3=rätt med liten miss, 4=helt rätt.",
    "feedback_sv: en mening på svenska. correction: rätt form om fel. uttalstips_sv: försvenskat uttal vid röst."
  ].join("\n");

  const user = [
    `Fråga: ${prompt}`,
    `Förväntat ord (lemma): ${expectedLemma}`,
    `Betydelse: ${translation}`,
    `Jimmys svar: ${answer}`
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 250,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI (quiz-domare) svarade ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const o = JSON.parse(data.choices?.[0]?.message?.content || "{}") as Record<string, unknown>;
  const grade = Math.min(4, Math.max(1, Math.round(Number(o.grade) || 1)));
  return {
    grade,
    correct: typeof o.correct === "boolean" ? o.correct : grade >= 3,
    feedback_sv: typeof o.feedback_sv === "string" ? o.feedback_sv : "",
    correction: typeof o.correction === "string" ? o.correction : undefined,
    uttalstips_sv: typeof o.uttalstips_sv === "string" ? o.uttalstips_sv : undefined
  };
}

function mockTurn(messages: TutorMessage[]): TutorTurn {
  const last = messages.at(-1)?.content ?? "";
  return {
    reply: "Très bien ! (mock-läge — ingen OPENAI_API_KEY) Continuons : comment ça va aujourd'hui ?",
    explanation_sv: "Mock-läge: ingen riktig bedömning gjordes. Sätt OPENAI_API_KEY för skarpt läge.",
    reviews: [],
    new_items: [],
    errors: last.trim() ? [] : []
  };
}
