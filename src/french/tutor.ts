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
import { getLesson } from "./db.js";
import { CAST, TRAVEL_INTERESTS, getStory, summarizeRecentBeats } from "./story.js";
import { getMysteryTutorContext } from "./mystery.js";

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
  sceneComplete: boolean;
  storyUpdate?: { recap: string; location?: string; nextHint?: string };
}

/**
 * Hanterar ett fritt konversationsturn. `channel` avgör vilka facetter som får
 * graderas (text → meaning+production, röst → meaning+pronunciation).
 */
export async function handleTutorTurn(userText: string, channel: Channel): Promise<TurnResult> {
  const state = await getState();
  const context = await buildContext(channel, state.activeLessonId);
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
    errors,
    sceneComplete: turn.scene_complete === true,
    storyUpdate: turn.story_update
      ? { recap: turn.story_update.recap, location: turn.story_update.location, nextHint: turn.story_update.next_hint }
      : undefined
  };
}

/** Bygger en kort kontextsträng av förfallna facetter för LLM:en. */
async function buildContext(channel: Channel, activeLessonId: string | null): Promise<string> {
  const due = await getDueFacets(8, allowedKinds(channel));
  const lines = due.map((f) => {
    const tip = f.meta.svensk_ljudharmning ? ` [uttal: ${f.meta.svensk_ljudharmning}]` : "";
    return `- ${f.lemma} (${f.kind}) = ${f.meta.translation}${tip}`;
  });
  const story = await getStory();
  const activeLesson = activeLessonId ? await getLesson(activeLessonId) : null;
  const sceneTurns = Number(activeLesson?.payload?.sceneTurns ?? 0);
  const lessonPhase = activeLesson?.payload?.lessonPhase === "recall" ? "recall" : "scene";
  let levelLabel = typeof activeLesson?.payload?.levelLabel === "string" ? activeLesson.payload.levelLabel : "";
  if (!levelLabel) {
    const { getLearnerLevel } = await import("./curriculum.js");
    levelLabel = await getLearnerLevel();
  }
  const learnerSignal = typeof activeLesson?.payload?.learnerSignal === "string" ? activeLesson.payload.learnerSignal : "unknown";
  const gentleStart = activeLesson?.payload?.gentleStart === true;
  const frenchMaxWords = Number(activeLesson?.payload?.frenchMaxWords ?? 70);
  const responseMaxWords = Number(activeLesson?.payload?.responseMaxWords ?? 10);
  const activeWords = Array.isArray(activeLesson?.payload?.activeWords)
    ? activeLesson.payload.activeWords.filter((word): word is string => typeof word === "string")
    : [];
  const mysteryContext = await getMysteryTutorContext(levelLabel);
  const openingReply = typeof activeLesson?.payload?.openingReply === "string" ? activeLesson.payload.openingReply : "";
  const missionSv = typeof activeLesson?.payload?.missionSv === "string" ? activeLesson.payload.missionSv : "";
  const transcript = Array.isArray(activeLesson?.payload?.transcript)
    ? (activeLesson.payload.transcript as Array<{ user?: string; assistant?: string }>).slice(-5)
    : [];
  return [
    "PÅGÅENDE VÄRLD (fortsätt den fritt; behandla inte detta som en ny fristående chatt):",
    `Premiss: ${story.premise}`,
    `Karaktärer: ${CAST}`,
    `Reseintressen (möjligheter, inte en fast rutt): ${TRAVEL_INTERESTS}`,
    `Nuvarande plats: ${story.location ?? "resan har inte börjat"}`,
    story.nextHint ? `Öppen tråd: ${story.nextHint}` : "",
    summarizeRecentBeats(story, 6),
    mysteryContext,
    activeLesson ? [
      `AKTIV LEKTION: nivå ${levelLabel}, fas ${lessonPhase}, Jimmy har svarat ${sceneTurns} gånger.`,
      `Senaste prestationssignal: ${learnerSignal}. Anpassa mängden svensk stöttning och fransk komplexitet därefter, utan att kommentera signalen.`,
      gentleStart
        ? `MIKRODOS FÖR ABSOLUT NYBÖRJARE: ditt reply får innehålla högst ${frenchMaxWords} mycket enkla franska ord och en enda fråga som kan besvaras med högst ${responseMaxWords} ord. explanation_sv ska översätta allt franskt du skriver. Kräv aldrig en hel översättning från svenska.`
        : "",
      activeWords.length ? `Aktiva ord att locka fram och bedöma, inte ersätta med fler nya ord: ${activeWords.join(", ")}` : "",
      lessonPhase === "recall"
        ? "ÅTERKALLNINGSFAS: bedöm Jimmys korta återberättande, ge kompakt återkoppling, återanvänd målord, avsluta scenen och fyll scene_complete=true samt story_update. Ställ ingen ny scenfråga."
        : `Låt situationen utvecklas naturligt och väv in en förståelsekontroll som en handling eller följdfråga. Avsluta inom totalt 2–5 svar.${sceneTurns >= 4 ? " Detta är sista scensvaret: ge situationen ett naturligt slut, sätt scene_complete=true och fyll story_update." : ""}`,
      openingReply ? `Scenens öppning:\n${openingReply}` : "",
      missionSv ? `Ursprungligt uppdrag: ${missionSv}` : "",
      transcript.length ? `Dialogen hittills:\n${transcript.map((turn) => `Jimmy: ${turn.user ?? ""}\nVärlden: ${turn.assistant ?? ""}`).join("\n")}` : ""
    ].filter(Boolean).join("\n") : "",
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
