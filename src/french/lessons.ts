import {
  createLesson,
  getLeechFacets,
  getNearMasteryGaps,
  getDueFacets,
  getModuleItems,
  pinLeech,
  updateState,
  type Channel,
  type FacetKind,
  type ItemMeta
} from "./db.js";
import { MASTERY_STABILITY, allowedKinds } from "./fsrs.js";
import { applyTurn } from "./tutor.js";
import { generateStoryLesson } from "./llm.js";
import { storyLessonPrompt } from "./prompts.js";
import { CAST, TRAVEL_INTERESTS, getStory, initStoryIfNeeded, updateStory, appendBeat, summarizeRecentBeats } from "./story.js";
import { todayStockholm } from "./time.js";
import { lessonPedagogy, needsGentleStart } from "./pedagogy.js";
import { getMysteryLessonContext, recordMysteryScene } from "./mystery.js";

/**
 * Lektions- och provbyggare (M4/M5). Allt urval är deterministiskt — LLM:en
 * används bara för att gjuta dagens lektion i en trevlig fransk text.
 */

export interface BuiltLesson {
  lessonId: string;
  text: string;
  messages: string[];
  /** Endast den franska delen — för TTS/röst-ut (utan svenska nyckeln). */
  reply: string;
  theme: string;
}

export interface LessonVocabulary {
  lemma: string;
  translation: string;
  pronunciation?: string;
  genre?: string;
}

/**
 * Bygger nästa dynamiska kapitel i Jimmys liv och resa genom Frankrike.
 * Modellen väljer situationen utifrån världsminnet; kursmotorn äger målord,
 * svagheter och progression.
 */
export async function buildDailyLesson(): Promise<BuiltLesson> {
  const date = todayStockholm();
  await initStoryIfNeeded();
  const story = await getStory();

  // Dagens målord = de ord du ännu inte behärskar i din aktuella kursdel.
  const { getCurrentModule } = await import("./curriculum.js");
  const current = await getCurrentModule();
  let targetWords: string[] = [];
  let targetVocabulary: LessonVocabulary[] = [];
  let levelLabel = "A1 nybörjare";
  let gentleStart = false;
  let greetingModule = false;
  if (current) {
    const items = await getModuleItems(current.module);
    levelLabel = `${current.module.split(".")[0]} – ${current.theme}`;
    greetingModule = current.module === "A1.1";
    gentleStart = needsGentleStart(current.module, items);
    const policy = lessonPedagogy(levelLabel, gentleStart);
    const selected = items
      .filter((it) => !it.mastered)
      .sort((a, b) => {
        const aEvidence = a.meaningStability + Math.max(a.productionStability, a.pronunciationStability);
        const bEvidence = b.meaningStability + Math.max(b.productionStability, b.pronunciationStability);
        return aEvidence - bEvidence;
      })
      .slice(0, policy.targetWords);
    targetWords = selected.map((it) => `${it.lemma} (${it.meta.translation})`);
    targetVocabulary = selected.map((it) => vocabularyItem(it.lemma, it.meta));
  } else {
    const { getLearnerLevel } = await import("./curriculum.js");
    levelLabel = `${await getLearnerLevel()} – repetition och fördjupning`;
    const policy = lessonPedagogy(levelLabel, gentleStart);
    const due = await getDueFacets(policy.targetWords);
    targetWords = due.map((f) => `${f.lemma} (${f.meta.translation})`);
    targetVocabulary = due.map((f) => vocabularyItem(f.lemma, f.meta));
  }

  const policy = lessonPedagogy(levelLabel, gentleStart);
  const leeches = await getLeechFacets(policy.leechWords);
  const rawMysteryContext = await getMysteryLessonContext(levelLabel, story.day);
  const mysteryContext = gentleStart
    ? { ...rawMysteryContext, hook: "Mysteriet väntar tills de första franska grunderna sitter.", knownClues: [], eligibleClue: null, mustReveal: false }
    : rawMysteryContext;

  // Pinna de leeches vi väver in, så de räknas som dagens fokus.
  for (const l of leeches) await pinLeech(l.id, true);
  const leechWords = leeches.map((l) => l.lemma);

  const lesson = await generateStoryLesson({
    systemPrompt: storyLessonPrompt(levelLabel, CAST, TRAVEL_INTERESTS, policy, greetingModule),
    premise: story.premise,
    recentBeats: gentleStart ? "(tidigare mysterium och resplan är pausade medan hälsningsgrunderna tränas)" : summarizeRecentBeats(story),
    location: story.location,
    nextHint: gentleStart ? null : story.nextHint,
    day: story.day,
    targetWords,
    leechWords,
    maxNewItems: policy.maxNewItems,
    sentenceStarters: policy.sentenceStarters,
    wordBankMax: policy.wordBankMax,
    frenchMaxWords: policy.frenchMaxWords,
    gentleStart: policy.gentleStart,
    greetingModule,
    mysteryContext
  });

  // Spara nya ord lektionen introducerar (inga reviews än).
  await applyTurn(
    { reply: lesson.reply, explanation_sv: lesson.explanation_sv, new_items: lesson.new_items, reviews: [], errors: [] },
    "text"
  );

  const vocabulary = dedupeVocabulary([
    ...targetVocabulary,
    ...leeches.map((item) => vocabularyItem(item.lemma, item.meta)),
    ...lesson.new_items.map((item) => vocabularyItem(item.lemma, item.meta))
  ]);
  const activeWords = vocabulary.map((item) => `${item.lemma} (${item.translation})`);

  // Flytta berättelsen framåt.
  const newDay = story.day + 1;
  const newLocation = lesson.story.location || lesson.place.name;
  await appendBeat({
    day: newDay,
    location: newLocation,
    placeName: lesson.place.name,
    placeKind: lesson.place.kind,
    recap: lesson.story.recap,
    sceneKind: lesson.scene.kind
  });
  await updateStory({ location: newLocation, nextHint: lesson.story.next_hint, day: newDay });
  await recordMysteryScene(lesson.mystery, mysteryContext.eligibleClue?.id);

  const facetIds = leeches.map((l) => l.id);
  const lessonId = await createLesson("daily", date, lesson.place.name, facetIds, {
    kind: "daily",
    day: newDay,
    place: lesson.place,
    scene: lesson.scene,
    sceneTurns: 0,
    lessonPhase: "scene",
    settingSv: lesson.setting_sv,
    openingReply: lesson.reply,
    missionSv: lesson.mission_sv,
    levelLabel,
    gentleStart,
    greetingModule,
    frenchMaxWords: policy.frenchMaxWords,
    responseMaxWords: policy.responseMaxWords,
    translateAllFrench: policy.translateAllFrench,
    activeWords,
    activeVocabulary: vocabulary
  });
  await updateState({ activeLessonId: lessonId, activeQuizId: null, chatActive: false, lastLessonDate: date });

  const messages = [
    `🎬 *${lesson.scene.title}*\n📍 ${lesson.place.name}${lesson.place.region ? ` · ${lesson.place.region}` : ""}${lesson.setting_sv ? `\n\n${lesson.setting_sv}` : ""}`,
    renderVocabularyMessage(vocabulary),
    `🇫🇷 *Scenen*\n\n${lesson.reply}`
  ].filter(Boolean);
  if (lesson.explanation_sv) messages.push(`🗝️ *Språknyckel*\n\n${lesson.explanation_sv}`);
  if (lesson.culture_sv) messages.push(`🏛️ *Kultur och historia*\n\n${lesson.culture_sv}`);
  const support = lesson.response_support;
  const responseParts = [
    "🎭 *Din tur*",
    lesson.mission_sv,
    `🇫🇷 *Svara på franska.* ${support.instruction_sv}`
  ];
  if (support.sentence_starters.length) {
    responseParts.push(`*Börja så här om du vill:*\n${support.sentence_starters.map((starter) => `• ${starter}`).join("\n")}`);
  }
  if (support.word_bank.length) {
    responseParts.push(`*Ord och fraser från lektionen:*\n${support.word_bank.map((word) => `• ${word}`).join("\n")}`);
  }
  responseParts.push(`🛟 ${support.rescue_sv}`);
  messages.push(responseParts.join("\n\n"));

  return {
    lessonId,
    text: messages.join("\n\n"),
    messages,
    reply: lesson.reply,
    theme: lesson.place.name
  };
}

function vocabularyItem(lemma: string, meta: Pick<ItemMeta, "translation" | "svensk_ljudharmning" | "genre">): LessonVocabulary {
  return {
    lemma,
    translation: meta.translation,
    pronunciation: meta.svensk_ljudharmning,
    genre: meta.genre
  };
}

function dedupeVocabulary(items: LessonVocabulary[]): LessonVocabulary[] {
  return [...new Map(items.map((item) => [item.lemma.toLowerCase(), item])).values()];
}

function renderVocabularyMessage(items: LessonVocabulary[]): string {
  if (!items.length) return "";
  const lines = ["🧠 *Dagens glosor*", "", "Det här är orden du aktivt tränar idag:"];
  for (const item of items) {
    const genre = item.genre ? ` (${item.genre})` : "";
    lines.push(`• *${item.lemma}*${genre} — ${item.translation}`);
    if (item.pronunciation) lines.push(`  Uttal: _${item.pronunciation}_`);
  }
  return lines.join("\n");
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
