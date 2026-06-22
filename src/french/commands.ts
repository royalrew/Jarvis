import {
  getState,
  updateState,
  getTopErrorCategories,
  getLeechFacets,
  getQuizHistory,
  getItemByLemma,
  getFacet,
  createLesson,
  setLessonStatus,
  getLesson,
  getLatestLesson,
  setLessonPayload,
  type Channel
} from "./db.js";
import { handleTutorTurn, formatTurn, resetHistory } from "./tutor.js";
import { detectFrenchIntent } from "./llm.js";
import { renderCourseMap, seedCurriculum } from "./curriculum.js";
import { finalizeScene, getStory, resetStory } from "./story.js";
import { buildDailyLesson, buildGrandTest, buildModuleCheckpoint, renderQuestion, type QuizPayload } from "./lessons.js";
import { handleQuizAnswer } from "./quiz.js";
import { todayStockholm } from "./time.js";
import { addMysteryTheory, judgeFinalTheory, renderMystery, resetMystery } from "./mystery.js";

/**
 * Kommando-ytan + routern (M6-lim). `maybeHandleFrench` är den enda ingången
 * telegram.ts behöver: returnerar true om fransk-tutorn äger meddelandet,
 * annars false (då faller det igenom till vanliga Jarvis).
 */

export interface FrenchIO {
  send: (text: string, markdown?: boolean) => Promise<void>;
  /** Läser upp ren fransk text som röstnot (valfritt — bara konversation/lektion). */
  speak?: (frenchText: string) => Promise<void>;
}

export interface FrenchInput {
  channel: Channel;
  text: string; // transkript för röst
}

const FRENCH_COMMANDS = new Set([
  "/franska", "/français", "/francais",
  "/lektion", "/delprov", "/streak", "/svaga", "/uttal", "/läge", "/lage",
  "/kurs", "/seed", "/avstämning", "/avstamning",
  "/story", "/resa", "/berättelse", "/berattelse", "/nystart",
  "/mysterium", "/mystery", "/teori", "/slutteori",
  "/glosor",
  "/hjälp", "/hjalp", "/meny", "/avbryt", "/sluta"
]);

/** Tappbara knappar i chatten → kommando. En knapptryckning är ett tydligt val. */
const BUTTON_TO_COMMAND: Record<string, string> = {
  "📖 Lektion": "/lektion",
  "🧳 Min resa": "/story",
  "🗺️ Kurs": "/kurs",
  "📋 Testa mig": "/avstämning",
  "🔥 Streak": "/streak",
  "🧠 Glosor": "/glosor",
  "💬 Prata franska": "/franska",
  "🔎 Mysteriet": "/mysterium",
  "❓ Hjälp": "/hjalp"
};

/** Persistent knappbord som följer med franska svar (skickas från telegram.ts). */
export const FRENCH_KEYBOARD = {
  keyboard: [
    [{ text: "📖 Lektion" }, { text: "🧳 Min resa" }],
    [{ text: "🗺️ Kurs" }, { text: "📋 Testa mig" }],
    [{ text: "🧠 Glosor" }, { text: "🔥 Streak" }, { text: "💬 Prata franska" }],
    [{ text: "🔎 Mysteriet" }, { text: "❓ Hjälp" }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

/** För Telegrams "/"-meny (setMyCommands). Endast ASCII-namn tillåts av API:t. */
export const FRENCH_BOT_COMMANDS = [
  { command: "lektion", description: "📖 Nästa anhalt på resan med Anna" },
  { command: "kurs", description: "🗺️ Din kurskarta och var du står" },
  { command: "story", description: "🧳 Din resa hittills" },
  { command: "avstamning", description: "📋 Läxförhör: behärskar du delen?" },
  { command: "delprov", description: "📝 Le Grand Test (veckans prov)" },
  { command: "uttal", description: "🔊 Uttalsdrill för ett ord" },
  { command: "streak", description: "🔥 Streak och statistik" },
  { command: "svaga", description: "🎯 Dina svagaste ord" },
  { command: "glosor", description: "🧠 Senaste lektionens glosor" },
  { command: "franska", description: "💬 Slå på fritt franskt samtal" },
  { command: "lage", description: "🔁 Växla immersion/studie" },
  { command: "nystart", description: "🆕 Börja en ny resa" },
  { command: "mysterium", description: "🔎 Ledtrådar och dina teorier" },
  { command: "slutteori", description: "🔐 Pröva mysteriets slutlösning" },
  { command: "hjalp", description: "❓ Visa allt du kan göra" },
  { command: "sluta", description: "👋 Avsluta franska-läget" }
];

/** Naturligt språk → kommando (distinkta svenska fraser, inget LLM-anrop). */
export function naturalCommand(text: string): { command: string; arg: string } | null {
  const t = text.toLowerCase();
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));
  const finalTheory = text.match(/^\s*ma th[ée]orie (?:est|:)\s*(.+)$/i);
  if (finalTheory?.[1]) return { command: "/slutteori", arg: text.trim() };
  const theory = text.match(/^\s*min teori (?:är|ar|:)\s*(.+)$/i);
  if (theory?.[1]) return { command: "/teori", arg: theory[1].trim() };
  if (has("testa mig", "förhör", "forhor", "avstämning", "avstamning", "läxförhör", "laxforhor")) return { command: "/avstämning", arg: "" };
  if (has("lära mig franska", "lara mig franska", "lär mig franska", "lar mig franska", "öva franska", "ova franska", "träna franska", "trana franska", "studera franska")) return { command: "/lektion", arg: "" };
  if (has("min resa", "visa resan", "berättelse", "berattelse", "reserutt", "var har jag varit")) return { command: "/story", arg: "" };
  if (has("mysteriet", "visa ledtrådar", "mina ledtrådar", "detektivbok")) return { command: "/mysterium", arg: "" };
  if (has("glosor", "dagens ord", "visa orden", "mina ord")) return { command: "/glosor", arg: "" };
  if (has("nästa lektion", "nasta lektion", "ny lektion", "dagens lektion", "fortsätt resan", "fortsatt resan")) return { command: "/lektion", arg: "" };
  if (has("min kurs", "kurskarta", "var är jag i kursen", "hur långt har jag", "hur langt har jag", "kursöversikt", "kursoversikt")) return { command: "/kurs", arg: "" };
  if (has("delprov", "grand test", "veckans prov", "kör ett prov", "kor ett prov")) return { command: "/delprov", arg: "" };
  if (has("min streak", "dagar i rad")) return { command: "/streak", arg: "" };
  if (has("svaga ord", "mina svagheter")) return { command: "/svaga", arg: "" };
  if (has("vad kan du", "vad kan jag göra", "vad kan jag gora", "vilka kommandon", "meny", "visa hjälp", "visa hjalp")) return { command: "/hjalp", arg: "" };
  return null;
}

export async function maybeHandleFrench(input: FrenchInput, io: FrenchIO): Promise<boolean> {
  const text = input.text.trim();

  // 1. Knapptryckning → kommando (högsta prioritet).
  if (BUTTON_TO_COMMAND[text]) {
    const [cmd, ...rest] = BUTTON_TO_COMMAND[text].split(/\s+/);
    return runFrenchCommand(cmd.toLowerCase(), rest.join(" "), io);
  }

  // 2. Slash-kommando.
  if (text.startsWith("/")) {
    const [cmd, ...rest] = text.split(/\s+/);
    const command = cmd.toLowerCase();
    if (!FRENCH_COMMANDS.has(command)) return false; // t.ex. /remember → Jarvis
    return runFrenchCommand(command, rest.join(" ").trim(), io);
  }

  // 3. Naturliga navigeringsfraser fungerar även under en aktiv session.
  const nat = naturalCommand(text);
  if (nat) return runFrenchCommand(nat.command, nat.arg, io);

  // 4. Aktiv session äger övriga meddelanden.
  const state = await getState();

  if (state.activeQuizId) {
    const step = await handleQuizAnswer(state.activeQuizId, text, input.channel);
    await io.send(step.reply, true);
    return true;
  }

  if (state.activeLessonId) {
    const lessonId = state.activeLessonId;
    const lesson = await getLesson(lessonId);
    const lessonPhase = lesson?.payload?.lessonPhase === "recall" ? "recall" : "scene";
    const previousTurns = Number(lesson?.payload?.sceneTurns ?? 0);
    const result = await handleTutorTurn(text, input.channel);
    const sceneTurns = previousTurns + 1;
    const enterRecall = lessonPhase === "scene" && ((result.sceneComplete && sceneTurns >= 2) || sceneTurns >= 5);
    const lessonComplete = lessonPhase === "recall";
    const previousTranscript = Array.isArray(lesson?.payload?.transcript) ? lesson.payload.transcript : [];
    const transcript = [...previousTranscript, { user: text, assistant: result.reply }].slice(-5);
    const pendingStoryUpdate = result.storyUpdate ?? lesson?.payload?.pendingStoryUpdate;
    const learnerSignal = result.errors.length >= 2
      ? "struggling"
      : result.errors.length === 0 && result.outcomes.some((outcome) => outcome.applied)
        ? "confident"
        : "steady";
    await setLessonPayload(lessonId, {
      ...(lesson?.payload ?? {}),
      sceneTurns,
      transcript,
      learnerSignal,
      lessonPhase: enterRecall ? "recall" : lessonPhase,
      pendingStoryUpdate
    });
    await setLessonStatus(lessonId, lessonComplete ? "graded" : "answered");
    if (lessonComplete) {
      if (pendingStoryUpdate && typeof pendingStoryUpdate === "object" && "recap" in pendingStoryUpdate) {
        await finalizeScene(pendingStoryUpdate as { recap: string; location?: string; nextHint?: string });
      }
      await bumpStreak();
      await updateState({ activeLessonId: null, chatActive: true });
    }
    const activeWords = Array.isArray(lesson?.payload?.activeWords) ? lesson.payload.activeWords : [];
    const recallWords = activeWords
      .filter((word): word is string => typeof word === "string")
      .slice(0, 3)
      .map((word) => word.replace(/\s*\([^)]*\)$/, ""));
    const gentleStart = lesson?.payload?.gentleStart === true;
    const recall = enterRecall
      ? gentleStart
        ? `\n\n🎒 *Ett sista litet steg*\nSkriv eller säg en av dagens tre glosor som passar scenen.${recallWords.length ? ` Välj mellan: *${recallWords.join(" · ")}*.` : ""}`
        : `\n\n🎒 *Innan du går vidare*\nBerätta mycket kort på franska vad som hände eller vad du gjorde.${recallWords.length ? ` Försök få med: *${recallWords.join(" · ")}*.` : ""}`
      : "";
    const ending = lessonComplete ? "\n\n✅ *Kapitel klart.* Orden återkommer senare i resan, med mindre hjälp." : "";
    await io.send(formatTurn(result) + recall + ending, true);
    await io.speak?.(result.reply);
    return true;
  }

  if (state.chatActive) {
    const result = await handleTutorTurn(text, input.channel);
    await io.send(formatTurn(result), true);
    await io.speak?.(result.reply);
    return true;
  }

  // 5. Idle: öva/fråga-intent.
  const intent = await detectFrenchIntent(text);
  if (intent.action !== "none") {
    if (intent.action === "learn") {
      await io.send("Jag startar en stöttad lektion från din nuvarande nivå…");
      const lesson = await buildDailyLesson();
      for (const message of lesson.messages) await io.send(message, true);
      await io.speak?.(lesson.reply);
      return true;
    }
    if (intent.action === "practice") {
      await updateState({ chatActive: true, activeLessonId: null, activeQuizId: null });
    }
    const result = await handleTutorTurn(text, input.channel);
    await io.send(formatTurn(result), true);
    await io.speak?.(result.reply);
    return true;
  }

  return false;
}

/** Kör ett franskt kommando. Delas av slash-kommandon, knappar och naturligt språk. */
async function runFrenchCommand(command: string, arg: string, io: FrenchIO): Promise<boolean> {
  switch (command) {
    case "/franska":
    case "/français":
    case "/francais":
      await updateState({ chatActive: true, activeLessonId: null, activeQuizId: null });
      await io.send("🇫🇷 *Mode français activé.* Skriv eller prata franska med mig. Tryck *Hjälp* eller skriv /sluta när du vill sluta.", true);
      return true;

    case "/lektion": {
      await io.send("Bygger dagens lektion…");
      const lesson = await buildDailyLesson();
      for (const message of lesson.messages) await io.send(message, true);
      await io.speak?.(lesson.reply);
      return true;
    }

    case "/delprov":
      await startQuiz(io);
      return true;

    case "/kurs":
      await io.send(await renderCourseMap(), true);
      return true;

    case "/glosor":
      await io.send(await renderVocabulary(), true);
      return true;

    case "/story":
    case "/resa":
    case "/berättelse":
    case "/berattelse":
      await io.send(await renderStory(), true);
      return true;

    case "/mysterium":
    case "/mystery":
      await io.send(await renderMystery(), true);
      return true;

    case "/teori":
      if (!arg) {
        await io.send("Skriv _min teori är …_ så sparar jag tanken i detektivboken.", true);
        return true;
      }
      await addMysteryTheory(arg);
      await io.send(`🔎 Teorin är sparad: _${arg}_`, true);
      return true;

    case "/slutteori": {
      if (!arg) {
        await io.send("När finalen är upplåst: presentera hela beviskedjan på franska med _Ma théorie est…_", true);
        return true;
      }
      await addMysteryTheory(arg);
      const verdict = await judgeFinalTheory(arg);
      const icon = verdict.solved ? "✅" : verdict.unlocked ? "🧩" : "🔒";
      await io.send(`${icon} ${verdict.feedbackSv}`, true);
      return true;
    }

    case "/nystart":
      await resetStory(arg || undefined);
      await resetMystery();
      resetHistory();
      await updateState({ chatActive: false, activeLessonId: null, activeQuizId: null, lastScenario: null });
      await io.send(
        arg
          ? `🧳 Ny resa påbörjad med fokus: *${arg}*. Tryck *Lektion* så börjar äventyret med Anna!`
          : "🧳 Ny resa påbörjad! Tryck *Lektion* så börjar äventyret med Anna från början.",
        true
      );
      return true;

    case "/avstämning":
    case "/avstamning": {
      const { getCurrentModule } = await import("./curriculum.js");
      const cur = await getCurrentModule();
      if (!cur) {
        await io.send("Inget att stämma av just nu — inga öppna kursdelar. Tryck *Kurs* för kartan.", true);
        return true;
      }
      const cp = await buildModuleCheckpoint(cur.module, cur.theme);
      if (!cp) {
        await io.send(`Alla ord i ${cur.module} är redan godkända. Tryck *Kurs*.`, true);
        return true;
      }
      await io.send(cp.intro, true);
      await io.send(renderQuestion(cp.payload), true);
      return true;
    }

    case "/seed": {
      await io.send("Seedar läroplanen…");
      const { items, modules } = await seedCurriculum();
      await io.send(`✓ Läroplan på plats: ${items} ord i ${modules} moduler. Tryck *Kurs* för kartan.`, true);
      return true;
    }

    case "/streak":
      await io.send(await renderStreak(), true);
      return true;

    case "/svaga":
      await io.send(await renderWeak(), true);
      return true;

    case "/uttal":
      await startPronunciationDrill(arg, io);
      return true;

    case "/läge":
    case "/lage":
      await toggleMode(io);
      return true;

    case "/hjälp":
    case "/hjalp":
    case "/meny":
      await io.send(helpText(), true);
      return true;

    case "/avbryt":
    case "/sluta":
      await updateState({ chatActive: false, activeLessonId: null, activeQuizId: null });
      await io.send("Avslutat. À bientôt ! 👋");
      return true;

    default:
      return false;
  }
}

function helpText(): string {
  return [
    "🇫🇷 *Så funkar det — inga kommandon att minnas:*",
    "Tryck på knapparna längst ner, välj ur meny-knappen (☰), eller skriv bara naturligt.",
    "",
    "📖 *Lektion* — nästa anhalt på resan med Anna",
    "🧳 *Min resa* — vart du varit och vad som väntar",
    "🗺️ *Kurs* — din karta och var du står",
    "📋 *Testa mig* — läxförhör på delen du läser",
    "🔥 *Streak* — dagar i rad + statistik",
    "🧠 *Glosor* — dagens aktiva ord med betydelse och uttal",
    "💬 *Prata franska* — fritt samtal",
    "🔎 *Mysteriet* — detektivboken, ledtrådar och teorier",
    "",
    'Du kan också bara skriva t.ex. _"nästa lektion"_, _"visa min resa"_, _"testa mig"_ eller _"vad betyder oui"_.'
  ].join("\n");
}

// --------------------------------------------------------------------------

async function startQuiz(io: FrenchIO) {
  const quiz = await buildGrandTest();
  if (quiz.payload.questions.length === 0) {
    await io.send("Det finns för få ord i datalagret för ett prov än. Kör några /lektion-pass först! 🇫🇷");
    await updateState({ activeQuizId: null });
    return;
  }
  await io.send(quiz.intro, true);
  await io.send(renderQuestion(quiz.payload), true);
}

async function toggleMode(io: FrenchIO) {
  const state = await getState();
  const next = state.mode === "study" ? "immersion" : "study";
  await updateState({ mode: next });
  const desc =
    next === "immersion"
      ? "🌊 *Immersion* — flytande franska, rättningar samlas diskret."
      : "📚 *Studie* — jag rättar direkt med svenska förklaringar.";
  await io.send(`Läge bytt till ${desc}`, true);
}

async function bumpStreak() {
  const state = await getState();
  const today = todayStockholm();
  // En streak-bump per dag (lektionen byggs en gång/dag).
  if (state.lastLessonDate === today && state.streak > 0) {
    // redan räknad idag via byggsteget? Vi räknar på svaret istället:
  }
  await updateState({ streak: state.streak + 1, lastLessonDate: today });
}

async function renderStreak(): Promise<string> {
  const state = await getState();
  const history = await getQuizHistory(5);
  const lines = [`🔥 *Streak:* ${state.streak} dag${state.streak === 1 ? "" : "ar"}`, `Läge: ${state.mode === "immersion" ? "immersion 🌊" : "studie 📚"}`];
  if (history.length) {
    lines.push("", "*Senaste delprov:*");
    for (const h of history) {
      const date = String(h.createdAt).slice(0, 10);
      const m = h.mastered.length ? ` · behärskade: ${h.mastered.join(", ")}` : "";
      lines.push(`• ${date}: ${h.score}/${h.total}${m}`);
    }
  } else {
    lines.push("", "Inga delprov ännu — söndag kl 10 kommer det första, eller kör /delprov nu.");
  }
  return lines.join("\n");
}

async function renderWeak(): Promise<string> {
  const cats = await getTopErrorCategories(14, 5);
  const leeches = await getLeechFacets(6);
  const lines = ["🎯 *Dina svagheter just nu*"];

  if (cats.length) {
    lines.push("", "*Vanligaste felkategorier (14 dagar):*");
    for (const c of cats) lines.push(`• ${c.category} — ${c.count} ggr`);
  } else {
    lines.push("", "Inga loggade fel än — det kommer när du börjar prata.");
  }

  if (leeches.length) {
    lines.push("", "*Envisaste ord/ljud (leeches):*");
    for (const l of leeches) {
      const tip = l.meta.svensk_ljudharmning ? ` (uttal: _${l.meta.svensk_ljudharmning}_)` : "";
      lines.push(`• ${l.lemma} = ${l.meta.translation}${tip} — ${l.kind}`);
    }
  }
  return lines.join("\n");
}

async function renderVocabulary(): Promise<string> {
  const state = await getState();
  const lesson = state.activeLessonId
    ? await getLesson(state.activeLessonId)
    : await getLatestLesson("daily");
  const raw = Array.isArray(lesson?.payload?.activeVocabulary) ? lesson.payload.activeVocabulary : [];
  const vocabulary = raw.filter((item): item is { lemma: string; translation: string; pronunciation?: string; genre?: string } => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return typeof value.lemma === "string" && typeof value.translation === "string";
  });
  if (!vocabulary.length) return "🧠 Inga lektionsglosor sparade ännu. Starta en lektion så bygger vi första listan.";

  const lines = ["🧠 *Senaste lektionens glosor*"];
  for (const item of vocabulary) {
    const genre = item.genre ? ` (${item.genre})` : "";
    lines.push("", `• *${item.lemma}*${genre} — ${item.translation}`);
    if (item.pronunciation) lines.push(`  Uttal: _${item.pronunciation}_`);
  }
  lines.push("", "Orden återkommer i scener, återkallning och avstämningar.");
  return lines.join("\n");
}

async function renderStory(): Promise<string> {
  const story = await getStory();
  const lines = ["🧳 *Ditt liv och din resa i Frankrike*", "", `_${story.premise}_`];

  if (story.beats.length === 0) {
    lines.push("", "Resan har inte börjat än — tryck *Lektion* så landar du på Charles de Gaulle utan någon franska. 🇫🇷");
    return lines.join("\n");
  }

  lines.push("", "*Senaste scenerna:*");
  for (const b of story.beats.slice(-15)) {
    const kind = b.sceneKind ? ` · ${b.sceneKind}` : "";
    lines.push(`📍 Scen ${b.day}: ${b.placeName}${kind} — ${b.recap}`);
  }
  if (story.location) lines.push("", `Du är nu: *${story.location}*`);
  if (story.nextHint) lines.push(`Öppen tråd: ${story.nextHint}`);
  lines.push("", "Tryck *Lektion* när du vill fortsätta och låt resan överraska dig.");
  return lines.join("\n");
}

/** /uttal <ord> — bygger ett en-frågors röstprov för uttalsdrill. */
async function startPronunciationDrill(word: string, io: FrenchIO) {
  if (!word) {
    await io.send("Använd: `/uttal <ord>` — t.ex. `/uttal oiseau`.", true);
    return;
  }

  const item = await getItemByLemma(word.toLowerCase());
  if (!item) {
    await io.send(`Jag känner inte ordet "${word}" än. Nämn det i en /lektion eller fri konversation först, så lär jag in det.`);
    return;
  }

  const facet = await getFacet(item.id, "pronunciation");
  if (!facet) {
    await io.send("Hittade inget uttals-facett för ordet.");
    return;
  }

  const payload: QuizPayload = {
    kind: "quiz",
    questions: [
      {
        facetId: facet.id,
        lemma: item.lemma,
        kind: "pronunciation",
        translation: item.meta.translation,
        prompt: `Uttala "${item.lemma}" (${item.meta.translation}). Skicka ett röstmeddelande. 🎤`,
        require: "voice",
        answered: false,
        grade: null
      }
    ],
    cursor: 0,
    score: 0
  };

  const lessonId = await createLesson("quiz", todayStockholm(), "Uttalsdrill", [facet.id], payload as unknown as Record<string, unknown>);
  await updateState({ activeQuizId: lessonId, activeLessonId: null, chatActive: false });

  const tip = item.meta.svensk_ljudharmning ? `\nLjudtips: _${item.meta.svensk_ljudharmning}_` : "";
  await io.send(`🔊 *Uttalsdrill:* ${item.lemma}${tip}\n\n${payload.questions[0].prompt}`, true);
}
