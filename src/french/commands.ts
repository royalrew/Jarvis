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
  type Channel
} from "./db.js";
import { handleTutorTurn, formatTurn } from "./tutor.js";
import { detectFrenchIntent } from "./llm.js";
import { renderCourseMap, seedCurriculum } from "./curriculum.js";
import { buildDailyLesson, buildGrandTest, buildModuleCheckpoint, renderQuestion, type QuizPayload } from "./lessons.js";
import { handleQuizAnswer } from "./quiz.js";
import { todayStockholm } from "./time.js";

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
  "/kurs", "/seed", "/avstämning", "/avstamning", "/avbryt", "/sluta"
]);

export async function maybeHandleFrench(input: FrenchInput, io: FrenchIO): Promise<boolean> {
  const text = input.text.trim();
  const isCommand = text.startsWith("/");

  if (isCommand) {
    const [cmd, ...rest] = text.split(/\s+/);
    const command = cmd.toLowerCase();
    const arg = rest.join(" ").trim();

    if (!FRENCH_COMMANDS.has(command)) {
      return false; // t.ex. /remember → låt Jarvis ta det
    }

    switch (command) {
      case "/franska":
      case "/français":
      case "/francais":
        await updateState({ chatActive: true, activeLessonId: null, activeQuizId: null });
        await io.send("🇫🇷 *Mode français activé.* Skriv eller prata franska med mig. /sluta för att avsluta, /läge för att växla rättningsläge.", true);
        return true;

      case "/lektion": {
        await io.send("Bygger dagens lektion…");
        const lesson = await buildDailyLesson();
        await io.send(lesson.text, true);
        await io.speak?.(lesson.reply);
        return true;
      }

      case "/delprov":
        await startQuiz(io);
        return true;

      case "/kurs":
        await io.send(await renderCourseMap(), true);
        return true;

      case "/avstämning":
      case "/avstamning": {
        const { getCurrentModule } = await import("./curriculum.js");
        const cur = await getCurrentModule();
        if (!cur) {
          await io.send("Inget att stämma av just nu — inga öppna kursdelar. Skriv /kurs för kartan.");
          return true;
        }
        const cp = await buildModuleCheckpoint(cur.module, cur.theme);
        if (!cp) {
          await io.send(`Alla ord i ${cur.module} är redan godkända. Skriv /kurs.`);
          return true;
        }
        await io.send(cp.intro, true);
        await io.send(renderQuestion(cp.payload), true);
        return true;
      }

      case "/seed": {
        await io.send("Seedar läroplanen…");
        const { items, modules } = await seedCurriculum();
        await io.send(`✓ Läroplan på plats: ${items} ord i ${modules} moduler. Skriv /kurs för kartan.`);
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

      case "/avbryt":
      case "/sluta":
        await updateState({ chatActive: false, activeLessonId: null, activeQuizId: null });
        await io.send("Avslutat. À bientôt ! 👋");
        return true;
    }
  }

  // Inget kommando — kolla om en fransk session är aktiv.
  const state = await getState();

  if (state.activeQuizId) {
    const step = await handleQuizAnswer(state.activeQuizId, text, input.channel);
    await io.send(step.reply, true);
    return true;
  }

  if (state.activeLessonId) {
    // Svar på dagens lektion: gradera + fortsätt som fri konversation.
    const result = await handleTutorTurn(text, input.channel);
    await setLessonStatus(state.activeLessonId, "graded");
    await bumpStreak();
    await updateState({ activeLessonId: null, chatActive: true });
    await io.send(formatTurn(result), true);
    await io.speak?.(result.reply);
    return true;
  }

  if (state.chatActive) {
    const result = await handleTutorTurn(text, input.channel);
    await io.send(formatTurn(result), true);
    await io.speak?.(result.reply);
    return true;
  }

  // Naturligt språk: "nu vill jag öva franska" eller "vad betyder oui".
  const intent = await detectFrenchIntent(text);
  if (intent.action !== "none") {
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
