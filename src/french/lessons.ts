import {
  createLesson,
  getTopErrorCategories,
  getLeechFacets,
  getNearMasteryGaps,
  getDueFacets,
  pinLeech,
  updateState,
  type Channel,
  type FacetKind
} from "./db.js";
import { MASTERY_STABILITY, allowedKinds } from "./fsrs.js";
import { applyTurn } from "./tutor.js";
import { callTutorTurn } from "./llm.js";
import { lessonBuilderPrompt } from "./prompts.js";
import { todayStockholm } from "./time.js";

/**
 * Lektions- och provbyggare (M4/M5). Allt urval är deterministiskt — LLM:en
 * används bara för att gjuta dagens lektion i en trevlig fransk text.
 */

export interface BuiltLesson {
  lessonId: string;
  text: string;
  /** Endast den franska delen — för TTS/röst-ut (utan svenska nyckeln). */
  reply: string;
  theme: string;
}

/**
 * Bygger dagens lektion (vardagar). Tema ur veckans vanligaste fel, plus 1–2
 * pinnade leeches som tvingas in i ett sammanhängande morgonmeddelande.
 */
export async function buildDailyLesson(): Promise<BuiltLesson> {
  const date = todayStockholm();
  const topErrors = await getTopErrorCategories(7, 3);
  const leeches = await getLeechFacets(2);

  const theme = topErrors.length
    ? `repetera ${topErrors.map((e) => e.category).join(" & ")}`
    : "vardagsfranska – en lätt start på dagen";

  // Pinna de leeches vi väver in, så de räknas som dagens fokus.
  for (const l of leeches) await pinLeech(l.id, true);
  const leechWords = leeches.map((l) => l.lemma);

  const due = await getDueFacets(6);
  const context = [
    topErrors.length ? "Veckans vanligaste fel: " + topErrors.map((e) => `${e.category} (${e.count})`).join(", ") : "",
    due.length ? "Förfallna ord: " + due.map((f) => `${f.lemma}=${f.meta.translation}`).join(", ") : ""
  ].filter(Boolean).join("\n");

  const turn = await callTutorTurn(
    lessonBuilderPrompt(theme, leechWords, context),
    [{ role: "user", content: "Bygg dagens lektion." }],
    "text"
  );

  // Spara eventuella nya ord lektionen introducerar (men inga reviews än).
  await applyTurn({ ...turn, reviews: [] }, "text");

  const facetIds = [...leeches.map((l) => l.id), ...due.map((d) => d.id)];
  const lessonId = await createLesson("daily", date, theme, facetIds, { kind: "daily" });

  await updateState({ activeLessonId: lessonId, activeQuizId: null, chatActive: false, lastLessonDate: date });

  const text = [turn.reply, turn.explanation_sv ? `\n🇸🇪 ${turn.explanation_sv}` : ""].filter(Boolean).join("\n");
  return { lessonId, text, reply: turn.reply, theme };
}

// --------------------------------------------------------------------------
// Le Grand Test (söndagar)
// --------------------------------------------------------------------------

export interface QuizQuestion {
  facetId: string;
  lemma: string;
  kind: FacetKind;
  translation: string;
  prompt: string;
  require: Channel; // tvingad inmatningsmetod
  answered: boolean;
  grade: number | null;
}

export interface QuizPayload {
  kind: "quiz" | "checkpoint";
  questions: QuizQuestion[];
  cursor: number;
  score: number;
  /** Satt för avstämningar (modul-prov): vilken modul som bedöms. */
  moduleId?: string;
}

export interface BuiltQuiz {
  lessonId: string;
  payload: QuizPayload;
  intro: string;
}

/**
 * Bygger Le Grand Test: 2 items nära mastery (saknar poäng i text eller uttal)
 * + 2 envisa leeches. Varje fråga tvingar fram en specifik inmatningsmetod
 * beroende på vilken facett som saknar poäng.
 */
export async function buildGrandTest(): Promise<BuiltQuiz> {
  const date = todayStockholm();
  const gaps = await getNearMasteryGaps(MASTERY_STABILITY, 2);
  const leeches = await getLeechFacets(2);

  const questions: QuizQuestion[] = [];

  // Near-mastery: testa exakt den facett som släpar.
  for (const g of gaps) {
    questions.push({
      facetId: "", // löses nedan
      lemma: g.lemma,
      kind: g.missingKind,
      translation: g.meta.translation,
      prompt: buildPrompt(g.lemma, g.meta.translation, g.missingKind, g.requireChannel),
      require: g.requireChannel,
      answered: false,
      grade: null
    });
  }

  // Leeches: testa den kind facetten faktiskt är.
  for (const l of leeches) {
    const require: Channel = l.kind === "pronunciation" ? "voice" : "text";
    questions.push({
      facetId: l.id,
      lemma: l.lemma,
      kind: l.kind === "meaning" ? "production" : l.kind,
      translation: l.meta.translation,
      prompt: buildPrompt(l.lemma, l.meta.translation, l.kind, require),
      require,
      answered: false,
      grade: null
    });
  }

  // Fyll på upp till 4 frågor med förfallna ord om vi har för få.
  if (questions.length < 4) {
    const fillers = await getDueFacets(4, allowedKinds("text"));
    for (const fr of fillers) {
      if (questions.length >= 4) break;
      if (questions.some((q) => q.lemma === fr.lemma)) continue;
      questions.push({
        facetId: fr.id,
        lemma: fr.lemma,
        kind: fr.kind === "meaning" ? "production" : fr.kind,
        translation: fr.meta.translation,
        prompt: buildPrompt(fr.lemma, fr.meta.translation, fr.kind, "text"),
        require: "text",
        answered: false,
        grade: null
      });
    }
  }

  // Lös facet_id för near-mastery-frågorna nu när vi vet lemmat.
  const { getItemByLemma, getFacet } = await import("./db.js");
  for (const q of questions) {
    if (q.facetId) continue;
    const item = await getItemByLemma(q.lemma);
    if (item) {
      const facet = await getFacet(item.id, q.kind);
      if (facet) q.facetId = facet.id;
    }
  }

  const valid = questions.filter((q) => q.facetId);
  const payload: QuizPayload = { kind: "quiz", questions: valid, cursor: 0, score: 0 };

  const facetIds = valid.map((q) => q.facetId);
  const lessonId = await createLesson("quiz", date, "Le Grand Test", facetIds, payload as unknown as Record<string, unknown>);
  await updateState({ activeQuizId: lessonId, activeLessonId: null, chatActive: false });

  const intro = [
    "🇫🇷 *Le Grand Test* — veckans delprov.",
    `${valid.length} frågor. Varje fråga säger hur du ska svara: 🎤 med röst eller ⌨️ med text.`,
    "Skriv /avbryt om du vill hoppa av."
  ].join("\n");

  return { lessonId, payload, intro };
}

// --------------------------------------------------------------------------
// Avstämning (modul-prov) — lärarens "behärskar du denna del? Ja/Nej"
// --------------------------------------------------------------------------

export interface BuiltCheckpoint {
  lessonId: string;
  payload: QuizPayload;
  intro: string;
  moduleTheme: string;
}

/**
 * Bygger en avstämning för en modul: varje ännu inte godkänt ord testas på
 * BÅDE stavning (text) och uttal (röst) — för läraren ska kunna säga JA krävs
 * att båda sitter. Returnerar null om modulen saknar ord att pröva.
 */
export async function buildModuleCheckpoint(moduleId: string, theme: string): Promise<BuiltCheckpoint | null> {
  const { getModuleItems, createLesson, updateState } = await import("./db.js");
  const items = await getModuleItems(moduleId);
  const pending = items.filter((it) => !it.mastered && it.prodFacetId && it.pronFacetId);
  if (pending.length === 0) return null;

  const questions: QuizQuestion[] = [];
  for (const it of pending) {
    // Stavning (text)
    questions.push({
      facetId: it.prodFacetId as string,
      lemma: it.lemma,
      kind: "production",
      translation: it.meta.translation,
      prompt: `Skriv ordet för "${it.meta.translation}" på franska. ⌨️`,
      require: "text",
      answered: false,
      grade: null
    });
    // Uttal (röst)
    questions.push({
      facetId: it.pronFacetId as string,
      lemma: it.lemma,
      kind: "pronunciation",
      translation: it.meta.translation,
      prompt: `Uttala ordet för "${it.meta.translation}" på franska. 🎤`,
      require: "voice",
      answered: false,
      grade: null
    });
  }

  const payload: QuizPayload = { kind: "checkpoint", moduleId, questions, cursor: 0, score: 0 };
  const lessonId = await createLesson("quiz", todayStockholm(), `Avstämning ${moduleId}`, questions.map((q) => q.facetId), payload as unknown as Record<string, unknown>);
  await updateState({ activeQuizId: lessonId, activeLessonId: null, chatActive: false });

  const intro = [
    `📋 *Avstämning — ${moduleId} ${theme}*`,
    `${pending.length} ord, varje ord prövas på *stavning* (⌨️) och *uttal* (🎤).`,
    "Läraren säger JA på ett ord först när båda sitter. /avbryt för att hoppa av."
  ].join("\n");

  return { lessonId, payload, intro, moduleTheme: theme };
}

function buildPrompt(lemma: string, translation: string, kind: FacetKind, require: Channel): string {
  if (require === "voice") {
    return `Uttala ordet för "${translation}" på franska (skicka röstmeddelande).`;
  }
  if (kind === "production") {
    return `Skriv ordet för "${translation}" på franska.`;
  }
  return `Vad betyder/heter "${translation}" på franska? Skriv ditt svar.`;
}

/** Renderar en provfråga till ett Telegram-meddelande. */
export function renderQuestion(payload: QuizPayload): string {
  const q = payload.questions[payload.cursor];
  const n = payload.cursor + 1;
  const total = payload.questions.length;
  const method = q.require === "voice" ? "🎤 Svara med RÖST" : "⌨️ Svara med TEXT";
  return [`*Fråga ${n}/${total}* — ${method}`, "", q.prompt].join("\n");
}
