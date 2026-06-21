import {
  upsertItemWithFacets,
  getDueFacets,
  logError,
  type Channel,
  type ItemMeta
} from "./db.js";
import { gradeFacet, isKindAllowed, allowedKinds, type GradeOutcome } from "./fsrs.js";
import { callTutorTurn, type TutorTurn, type TutorMessage } from "./llm.js";
import { tutorSystemPrompt } from "./prompts.js";
import { getState } from "./db.js";
import { CAST, TRAVEL_INTERESTS, getStory, summarizeRecentBeats } from "./story.js";

/**
 * Turn-orkestreringen (M2). Binder ihop LLM-kontraktet med det deterministiska
 * lagret: kör turnet, applicerar reviews via FSRS (källstyrt), persisterar nya
 * items och loggar fel. Returnerar ett färdigformaterat svar till Telegram.
 */

// Enkel in-memory historik (single-user bot). Räcker mellan omstarter; den
// långsiktiga sanningen ligger ändå i facetterna, inte i chatt-loggen.
const history: TutorMessage[] = [];
const MAX_HISTORY = 12;

export interface TurnResult {
  reply: string;
  explanationSv?: string;
  outcomes: GradeOutcome[];
  newLemmas: string[];
  errors: { category: string; correction: string }[];
}

/**
 * Hanterar ett fritt konversationsturn. `channel` avgör vilka facetter som får
 * graderas (text → meaning+production, röst → meaning+pronunciation).
 */
export async function handleTutorTurn(userText: string, channel: Channel): Promise<TurnResult> {
  const state = await getState();
  const context = await buildContext(channel);
  const systemPrompt = tutorSystemPrompt(state.mode, context);

  pushHistory({ role: "user", content: userText });
  const turn = await callTutorTurn(systemPrompt, history.slice(), channel);
  pushHistory({ role: "assistant", content: turn.reply });

  const result = await applyTurn(turn, channel);
  return result;
}

/**
 * Applicerar ett färdigt TutorTurn mot datalagret. Delas av fri konversation,
 * lektioner och prov.
 */
export async function applyTurn(turn: TutorTurn, channel: Channel): Promise<TurnResult> {
  // 1. Nya items in först — så reviews mot dem har en facett att landa på.
  const newLemmas: string[] = [];
  for (const ni of turn.new_items) {
    const meta: ItemMeta = {
      genre: ni.meta.genre,
      svensk_ljudharmning: ni.meta.svensk_ljudharmning,
      translation: ni.meta.translation,
      phonemes: ni.phonemes
    };
    await upsertItemWithFacets(ni.lemma, meta);
    newLemmas.push(ni.lemma);
  }

  // 2. Reviews — källstyrt. Kanalen avgör vad som får röras; LLM:ens förslag
  //    för fel kanal släng vi (det deterministiska lagret äger sanningen).
  const outcomes: GradeOutcome[] = [];
  for (const r of turn.reviews) {
    if (!isKindAllowed(channel, r.facet_kind)) continue;
    const outcome = await gradeFacet(r.item_lemma, r.facet_kind, r.grade, channel);
    outcomes.push(outcome);
  }

  // 3. Fel loggas för veckans tema + /svaga.
  const errors: { category: string; correction: string }[] = [];
  for (const e of turn.errors) {
    await logError(e.category, e.utterance, e.correction, e.uttalstips_sv ?? null);
    errors.push({ category: e.category, correction: e.correction });
  }

  // 4. Graderade vi något? Kör progressiv upplåsning (kan tända nästa modul).
  if (outcomes.some((o) => o.applied)) {
    const { advanceCurriculum } = await import("./curriculum.js");
    await advanceCurriculum();
  }

  return {
    reply: turn.reply,
    explanationSv: turn.explanation_sv,
    outcomes,
    newLemmas,
    errors
  };
}

/** Bygger en kort kontextsträng av förfallna facetter för LLM:en. */
async function buildContext(channel: Channel): Promise<string> {
  const due = await getDueFacets(8, allowedKinds(channel));
  const lines = due.map((f) => {
    const tip = f.meta.svensk_ljudharmning ? ` [uttal: ${f.meta.svensk_ljudharmning}]` : "";
    return `- ${f.lemma} (${f.kind}) = ${f.meta.translation}${tip}`;
  });
  const story = await getStory();
  return [
    "PÅGÅENDE VÄRLD (fortsätt den fritt; behandla inte detta som en ny fristående chatt):",
    `Premiss: ${story.premise}`,
    `Karaktärer: ${CAST}`,
    `Reseintressen (möjligheter, inte en fast rutt): ${TRAVEL_INTERESTS}`,
    `Nuvarande plats: ${story.location ?? "resan har inte börjat"}`,
    story.nextHint ? `Öppen tråd: ${story.nextHint}` : "",
    summarizeRecentBeats(story, 6),
    "",
    "Förfallna repetitioner att gärna väva in:",
    ...(lines.length ? lines : ["(inga just nu)"])
  ].filter(Boolean).join("\n");
}

function pushHistory(msg: TutorMessage) {
  history.push(msg);
  while (history.length > MAX_HISTORY) history.shift();
}

export function resetHistory() {
  history.length = 0;
}

/** Formaterar ett TurnResult till ett Telegram-meddelande (franska + svensk hjälp). */
export function formatTurn(result: TurnResult): string {
  const parts: string[] = [result.reply];

  if (result.explanationSv) {
    parts.push("", `🇸🇪 ${result.explanationSv}`);
  }

  if (result.errors.length) {
    parts.push("", "✏️ Rättningar:");
    for (const e of result.errors) parts.push(`• _${e.category}_ → ${e.correction}`);
  }

  const mastered = result.outcomes.filter((o) => o.mastered).map((o) => o.lemma);
  if (mastered.length) {
    parts.push("", `🎉 Behärskat: ${[...new Set(mastered)].join(", ")}`);
  }

  if (result.newLemmas.length) {
    parts.push("", `🆕 Nya ord: ${result.newLemmas.join(", ")}`);
  }

  return parts.join("\n");
}
