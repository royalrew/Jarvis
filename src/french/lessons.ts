import {
  createLesson,
  getLeechFacets,
  getNearMasteryGaps,
  getDueFacets,
  getModuleItems,
  pinLeech,
  updateState,
  type Channel,
  type FacetKind
} from "./db.js";
import { MASTERY_STABILITY, allowedKinds } from "./fsrs.js";
import { applyTurn } from "./tutor.js";
import { generateStoryLesson } from "./llm.js";
import { storyLessonPrompt } from "./prompts.js";
import { CAST, getStory, initStoryIfNeeded, updateStory, appendBeat, summarizeRecentBeats } from "./story.js";
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
 * Bygger nästa anhalt i den sammanhängande reseberättelsen: du (Jimmy) reser
 * genom Frankrike med Anna, din kultur- och historieguide. Varje lektion
 * fortsätter resan till en ny riktig plats (slott, kyrka, världskrigsminne)
 * och övar orden i din aktuella kursmodul. Annas historieberättelse ligger på
 * svenska för nybörjaren (mer franska högre upp).
 */
export async function buildDailyLesson(): Promise<BuiltLesson> {
  const date = todayStockholm();
  await initStoryIfNeeded();
  const story = await getStory();
  const leeches = await getLeechFacets(2);

  // Dagens målord = de ord du ännu inte behärskar i din aktuella kursdel.
  const { getCurrentModule } = await import("./curriculum.js");
  const current = await getCurrentModule();
  let targetWords: string[] = [];
  let levelLabel = "A1 nybörjare";
  if (current) {
    const items = await getModuleItems(current.module);
    targetWords = items.filter((it) => !it.mastered).slice(0, 6).map((it) => `${it.lemma} (${it.meta.translation})`);
    levelLabel = `${current.module.split(".")[0]} – ${current.theme}`;
  } else {
    const due = await getDueFacets(6);
    targetWords = due.map((f) => `${f.lemma} (${f.meta.translation})`);
  }

  // Pinna de leeches vi väver in, så de räknas som dagens fokus.
  for (const l of leeches) await pinLeech(l.id, true);
  const leechWords = leeches.map((l) => l.lemma);

  const lesson = await generateStoryLesson({
    systemPrompt: storyLessonPrompt(levelLabel, CAST),
    premise: story.premise,
    recentBeats: summarizeRecentBeats(story),
    location: story.location,
    nextHint: story.nextHint,
    day: story.day,
    targetWords,
    leechWords
  });

  // Spara nya ord lektionen introducerar (inga reviews än).
  await applyTurn(
    { reply: lesson.reply, explanation_sv: lesson.explanation_sv, new_items: lesson.new_items, reviews: [], errors: [] },
    "text"
  );

  // Flytta berättelsen framåt.
  const newDay = story.day + 1;
  const newLocation = lesson.story.location || lesson.place.name;
  await appendBeat({
    day: newDay,
    location: newLocation,
    placeName: lesson.place.name,
    placeKind: lesson.place.kind,
    recap: lesson.story.recap
  });
  await updateStory({ location: newLocation, nextHint: lesson.story.next_hint, day: newDay });

  const facetIds = leeches.map((l) => l.id);
  const lessonId = await createLesson("daily", date, lesson.place.name, facetIds, { kind: "daily", day: newDay, place: lesson.place });
  await updateState({ activeLessonId: lessonId, activeQuizId: null, chatActive: false, lastLessonDate: date });

  const parts = [lesson.reply];
  if (lesson.explanation_sv) parts.push("", `🇸🇪 ${lesson.explanation_sv}`);
  if (lesson.culture_sv) parts.push("", `🏛️ *Anna berättar:* ${lesson.culture_sv}`);

  return { lessonId, text: parts.join("\n"), reply: lesson.reply, theme: lesson.place.name };
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
