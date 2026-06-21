import type { Channel } from "./db.js";
import type { MysteryLessonContext, MysteryLessonResult } from "./mystery.js";

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
  scene_complete?: boolean;
  story_update?: { recap: string; location?: string; next_hint?: string };
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
      max_tokens: 1200,
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
  "  ],",
  '  "scene_complete": boolean, // true när den aktuella situationen har fått ett naturligt avslut',
  '  "story_update": { "recap": string, "location": string?, "next_hint": string? } // fyll när scenen avslutas',
  "}",
  "",
  "Regler:",
  "- svensk_ljudharmning = ett försvenskat, lättläst uttalstips, t.ex. 'wazo' för 'oiseau'.",
  "- Vid uttalsfel: fyll uttalstips_sv med en pragmatisk svensk stavning av hur det SKA låta.",
  "- grade: 1=fel/blank, 2=tveksamt, 3=rätt med ansträngning, 4=lätt och korrekt.",
  "- Sätt INTE reviews för en facet_kind som den aktuella kanalen inte kan bedöma.",
  "- Alla arrayer ska finnas med (tomma [] om inget passar). reply får aldrig vara tom.",
  "- I en lektion: fortsätt scenen naturligt och sätt scene_complete=true först när situationen faktiskt är löst; normalt efter 2–5 svar från Jimmy.",
  "- När scene_complete=true ska story_update sammanfatta vad Jimmy faktiskt gjorde, konsekvensen, aktuell plats och en öppen tråd. Hitta inte på handlingar han inte utförde."
].join("\n");

function normalizeTurn(obj: unknown): TutorTurn {
  const o = (obj ?? {}) as Record<string, unknown>;
  const storyUpdate = (o.story_update ?? {}) as Record<string, unknown>;
  return {
    reply: typeof o.reply === "string" && o.reply.trim() ? o.reply.trim() : "On continue ?",
    explanation_sv: typeof o.explanation_sv === "string" && o.explanation_sv.trim() ? o.explanation_sv.trim() : undefined,
    reviews: Array.isArray(o.reviews) ? (o.reviews as TutorReview[]).filter(isValidReview) : [],
    new_items: Array.isArray(o.new_items) ? (o.new_items as TutorNewItem[]).filter(isValidNewItem) : [],
    errors: Array.isArray(o.errors) ? (o.errors as TutorError[]).filter(isValidError) : [],
    scene_complete: o.scene_complete === true,
    story_update: typeof storyUpdate.recap === "string" && storyUpdate.recap.trim()
      ? {
          recap: storyUpdate.recap.trim(),
          location: typeof storyUpdate.location === "string" ? storyUpdate.location.trim() : undefined,
          next_hint: typeof storyUpdate.next_hint === "string" ? storyUpdate.next_hint.trim() : undefined
        }
      : undefined
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

export interface StoryPlace {
  name: string;
  kind: string;
  region: string;
}

export interface ResponseSupport {
  instruction_sv: string;
  sentence_starters: string[];
  word_bank: string[];
  rescue_sv: string;
}

export interface StoryLesson {
  setting_sv: string;
  reply: string; // scenen på franska (elevens nivå)
  explanation_sv?: string;
  culture_sv: string; // Annas kultur-/historieberättelse
  mission_sv: string;
  response_support: ResponseSupport;
  mystery: MysteryLessonResult | null;
  place: StoryPlace;
  scene: { kind: string; title: string };
  new_items: TutorNewItem[];
  story: { recap: string; location: string; next_hint: string };
}

export interface StoryLessonInput {
  systemPrompt: string;
  premise: string;
  recentBeats: string;
  location: string | null;
  nextHint: string | null;
  day: number;
  targetWords: string[];
  leechWords: string[];
  maxNewItems: number;
  sentenceStarters: number;
  wordBankMax: number;
  gentleStart: boolean;
  mysteryContext: MysteryLessonContext;
}

/**
 * Genererar nästa anhalt i reseberättelsen: en scen på franska + Annas
 * kultur-/historieberättelse, en riktig plats, nya ord och en story-uppdatering
 * (vart resan tar vägen härnäst). LLM:en bedömer inget här — bara berättar.
 */
export async function generateStoryLesson(input: StoryLessonInput): Promise<StoryLesson> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return mockStoryLesson(input);
  }

  const model = process.env.FRENCH_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
  const userContext = [
    `Premiss: ${input.premise}`,
    `Resan hittills:`,
    input.recentBeats,
    input.location ? `Ni är nu: ${input.location}` : "Ni har inte börjat resan än.",
    input.nextHint ? `En öppen möjlighet från förra scenen (inte ett krav): ${input.nextHint}` : "",
    input.targetWords.length ? `Dagens målord att väva in: ${input.targetWords.join(", ")}` : "",
    input.leechWords.length ? `Få också med dessa svaga ord: ${input.leechWords.join(", ")}` : "",
    `Du får introducera högst ${input.maxNewItems} helt nya aktiva ord utöver målord och svaga ord. Övriga miljöord är passiv exponering och ska inte läggas i new_items.`,
    `Svarsstödet ska innehålla exakt ${input.sentenceStarters} nivåanpassade meningsstarter och bara ord/fraser som redan förekommer i scenen, språknyckeln eller målordlistan.`,
    `Mysteriekontext (den enda tillåtna sanningen om mysteriet): ${JSON.stringify(input.mysteryContext)}`,
    `Detta är dag ${input.day + 1} på resan.`
  ].filter(Boolean).join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      max_tokens: 3000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: userContext }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI (story-lektion) svarade ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return normalizeStoryLesson(
    JSON.parse(data.choices?.[0]?.message?.content || "{}"),
    input.maxNewItems,
    input.sentenceStarters,
    input.wordBankMax,
    input.gentleStart,
    [...input.targetWords, ...input.leechWords]
  );
}

function normalizeStoryLesson(obj: unknown, maxNewItems: number, maxSentenceStarters: number, maxWordBank: number, gentleStart: boolean, activeWords: string[]): StoryLesson {
  const o = (obj ?? {}) as Record<string, unknown>;
  const place = (o.place ?? {}) as Record<string, unknown>;
  const scene = (o.scene ?? {}) as Record<string, unknown>;
  const story = (o.story ?? {}) as Record<string, unknown>;
  const support = (o.response_support ?? {}) as Record<string, unknown>;
  const mystery = (o.mystery ?? {}) as Record<string, unknown>;
  const strings = (value: unknown, max: number) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, max)
    : [];
  const generatedStarters = strings(support.sentence_starters, maxSentenceStarters);
  const firstActiveWord = activeWords[0]?.replace(/\s*\([^)]*\)$/, "").trim();
  const fallbackStarters = firstActiveWord
    ? [`${firstActiveWord}…`, "Je voudrais ___, s’il vous plaît.", "Je suis ___"]
    : ["Bonjour…", "Je voudrais ___, s’il vous plaît.", "Je suis ___"];
  const generatedWordBank = strings(support.word_bank, maxWordBank);
  return {
    setting_sv: typeof o.setting_sv === "string" ? o.setting_sv.trim() : "",
    reply: typeof o.reply === "string" && o.reply.trim() ? o.reply.trim() : "On continue le voyage ?",
    explanation_sv: typeof o.explanation_sv === "string" && o.explanation_sv.trim() ? o.explanation_sv.trim() : undefined,
    culture_sv: typeof o.culture_sv === "string" ? o.culture_sv.trim() : "",
    mission_sv: gentleStart
      ? "Svara personen med dagens enda glosa. Du behöver inte bilda en mening."
      : typeof o.mission_sv === "string" && o.mission_sv.trim() ? o.mission_sv.trim() : "Svara på franska och se vad som händer.",
    response_support: {
      instruction_sv: gentleStart
        ? "Skriv eller säg bara dagens glosa."
        : typeof support.instruction_sv === "string" && support.instruction_sv.trim()
        ? support.instruction_sv.trim()
        : "Svara med en kort mening på franska.",
      sentence_starters: gentleStart && firstActiveWord
        ? [`${firstActiveWord}…`]
        : generatedStarters.length
        ? generatedStarters
        : fallbackStarters.slice(0, maxSentenceStarters),
      word_bank: gentleStart
        ? activeWords.slice(0, 1)
        : generatedWordBank.length
        ? generatedWordBank
        : activeWords.slice(0, maxWordBank),
      rescue_sv: typeof support.rescue_sv === "string" && support.rescue_sv.trim()
        ? support.rescue_sv.trim()
        : "Fastnar du kan du skriva på svenska vad du vill säga, så hjälper tutorn dig att uttrycka det på franska."
    },
    mystery: typeof mystery.clue_id === "string" && typeof mystery.discovery_sv === "string"
      ? { clue_id: mystery.clue_id.trim(), discovery_sv: mystery.discovery_sv.trim() }
      : null,
    place: {
      name: typeof place.name === "string" && place.name.trim() ? place.name.trim() : "Frankrike",
      kind: typeof place.kind === "string" ? place.kind.trim() : "plats",
      region: typeof place.region === "string" ? place.region.trim() : ""
    },
    scene: {
      kind: typeof scene.kind === "string" && scene.kind.trim() ? scene.kind.trim() : "vardag",
      title: typeof scene.title === "string" && scene.title.trim() ? scene.title.trim() : "Nästa scen"
    },
    new_items: Array.isArray(o.new_items) ? (o.new_items as TutorNewItem[]).filter(isValidNewItem).slice(0, maxNewItems) : [],
    story: {
      recap: typeof story.recap === "string" ? story.recap.trim() : "",
      location: typeof story.location === "string" && story.location.trim() ? story.location.trim() : "",
      next_hint: typeof story.next_hint === "string" ? story.next_hint.trim() : ""
    }
  };
}

function mockStoryLesson(input: StoryLessonInput): StoryLesson {
  return {
    setting_sv: "Du har precis landat på Charles de Gaulle och försöker förstå hur du ska ta dig in till Paris.",
    reply: "« À Paris ✈️ »\nAnna : Bienvenue à Paris ! On commence le voyage. Et toi, ça va ?",
    explanation_sv: "(mock-läge — ingen OPENAI_API_KEY) Anna hälsar dig välkommen till Paris.",
    culture_sv: "Mock-läge: här skulle Anna berätta om platsen och dess historia.",
    mission_sv: "Hälsa och berätta kort hur du mår på franska.",
    response_support: {
      instruction_sv: "Svara med en kort mening på franska.",
      sentence_starters: ["Bonjour, je…", "Je suis…", "Ça va…"].slice(0, input.sentenceStarters),
      word_bank: input.targetWords,
      rescue_sv: "Fastnar du kan du skriva på svenska, så hjälper tutorn dig vidare på franska."
    },
    mystery: input.mysteryContext.eligibleClue
      ? { clue_id: input.mysteryContext.eligibleClue.id, discovery_sv: input.mysteryContext.eligibleClue.publicNote }
      : null,
    place: { name: "Paris", kind: "ville", region: "Île-de-France" },
    scene: { kind: "ankomst", title: "Första dagen i Frankrike" },
    new_items: [],
    story: {
      recap: "Du landade i Paris och började resan med Anna.",
      location: "Paris",
      next_hint: "Hitta ett sätt att ta sig från flygplatsen."
    }
  };
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

export interface FrenchIntent {
  action: "learn" | "practice" | "question" | "none";
  word?: string;
}

// Billig heuristik-grind: bara om något av detta finns kör vi en LLM-klassning.
// Annars slipper varje vanligt Jarvis-meddelande ett extra API-anrop.
const FR_TRIGGERS = [
  "franska", "fransk", "français", "francais", "en français", "på franska",
  "vad betyder", "vad heter", "vad är", "hur säger", "hur uttalar", "hur stavas",
  "öva franska", "prata franska", "träna franska", "lär mig franska", "parler français",
  "bonjour", "salut", "merci", "comment "
];

/**
 * Avgör om ett naturligt meddelande är fransk-intent (utan kommando).
 * - "learn": vill lära/öva/träna → starta en stöttad lektion.
 * - "practice": vill uttryckligen prata fritt → starta konversationsläge.
 * - "question": frågar om betydelse/uttal av ett FRANSKT ord → svara som tutor.
 * - "none": inget av detta → faller igenom till vanliga Jarvis.
 */
export async function detectFrenchIntent(text: string): Promise<FrenchIntent> {
  const t = text.toLowerCase();
  if (!FR_TRIGGERS.some((k) => t.includes(k))) {
    return { action: "none" };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Heuristisk fallback utan LLM.
    const wantsFrench = t.includes("franska") || t.includes("français") || t.includes("francais");
    if (wantsFrench) {
      const isQuestion = t.includes("vad betyder") || t.includes("vad heter") || t.includes("hur ");
      const wantsLesson = ["lär", "lära", "öva", "träna", "lektion", "studera"].some((word) => t.includes(word));
      return { action: isQuestion ? "question" : wantsLesson ? "learn" : "practice" };
    }
    return { action: "question" };
  }

  const model = process.env.OPENAI_CLASSIFIER_MODEL || "gpt-4o-mini";
  const sys = [
    "Du avgör om ett (oftast svenskt) meddelande handlar om att lära sig franska.",
    'Svara ENDAST med JSON: { "action": "learn"|"practice"|"question"|"none", "word": string }',
    '"learn" = vill lära sig, öva, träna, studera eller få en fransklektion, t.ex. "nu vill jag lära mig franska".',
    '"practice" = vill uttryckligen prata eller konversera fritt på franska, t.ex. "prata franska med mig".',
    '"question" = frågar om betydelse, uttal eller stavning av ett FRANSKT ord/fras, t.ex. "vad betyder oui".',
    '"none" = handlar inte om franska, t.ex. "vad betyder idempotent" eller "boka möte imorgon".',
    'word = det franska ordet/frasen om action=question, annars "".'
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 50,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: text }
        ]
      })
    });
    if (!response.ok) return { action: "none" };
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const o = JSON.parse(data.choices?.[0]?.message?.content || "{}") as { action?: string; word?: string };
    const action = (["learn", "practice", "question", "none"].includes(o.action ?? "") ? o.action : "none") as FrenchIntent["action"];
    return { action, word: o.word || undefined };
  } catch {
    return { action: "none" };
  }
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
