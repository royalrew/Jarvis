import {
  getLesson,
  setLessonPayload,
  setLessonStatus,
  recordQuizResult,
  getMasteredLemmas,
  setItemMastered,
  updateState,
  type Channel
} from "./db.js";
import { gradeFacet } from "./fsrs.js";
import { judgeQuizAnswer } from "./llm.js";
import { renderQuestion, type QuizPayload } from "./lessons.js";

/**
 * Prov-state-maskinen (M5). Driver Le Grand Test fråga för fråga, tvingar fram
 * rätt inmatningsmetod, graderar per facett (källstyrt) och summerar resultatet.
 */

export interface QuizStep {
  reply: string;
  done: boolean;
}

/**
 * Tar emot ett svar under ett aktivt prov. `channel` är hur Jimmy faktiskt
 * svarade (text/röst) — måste matcha frågans krav, annars ber vi om rätt metod.
 */
export async function handleQuizAnswer(quizId: string, answer: string, channel: Channel): Promise<QuizStep> {
  const lesson = await getLesson(quizId);
  if (!lesson || lesson.type !== "quiz" || !lesson.payload) {
    await updateState({ activeQuizId: null });
    return { reply: "Provet verkar redan avslutat.", done: true };
  }

  const payload = lesson.payload as unknown as QuizPayload;
  const q = payload.questions[payload.cursor];
  if (!q) {
    return finishQuiz(quizId, payload);
  }

  // Tvinga rätt inmatningsmetod — själva poängen med provet.
  if (channel !== q.require) {
    const need = q.require === "voice" ? "ett röstmeddelande 🎤" : "ett textsvar ⌨️";
    return { reply: `Den här frågan kräver ${need}. Försök igen.`, done: false };
  }

  const verdict = await judgeQuizAnswer(q.prompt, q.lemma, q.translation, answer, channel);
  await gradeFacet(q.lemma, q.kind, verdict.grade, channel);

  q.answered = true;
  q.grade = verdict.grade;
  if (verdict.grade >= 3) payload.score += 1;
  payload.cursor += 1;
  await setLessonPayload(quizId, payload as unknown as Record<string, unknown>);

  const fb: string[] = [];
  fb.push(verdict.correct ? "✅ Rätt!" : `❌ Rätt svar: *${q.lemma}*`);
  if (verdict.feedback_sv) fb.push(verdict.feedback_sv);
  if (verdict.correction && !verdict.correct) fb.push(`Rättning: ${verdict.correction}`);
  if (verdict.uttalstips_sv) fb.push(`🔊 Uttal: _${verdict.uttalstips_sv}_`);

  if (payload.cursor >= payload.questions.length) {
    const summary = await finishQuiz(quizId, payload);
    return { reply: [fb.join("\n"), "", summary.reply].join("\n"), done: true };
  }

  return { reply: [fb.join("\n"), "", "—", renderQuestion(payload)].join("\n"), done: false };
}

async function finishQuiz(quizId: string, payload: QuizPayload): Promise<QuizStep> {
  await setLessonStatus(quizId, "graded");
  await updateState({ activeQuizId: null });

  if (payload.kind === "checkpoint") {
    return finishCheckpoint(quizId, payload);
  }

  const { advanceCurriculum } = await import("./curriculum.js");
  await advanceCurriculum();

  const quizLemmas = [...new Set(payload.questions.map((q) => q.lemma))];
  const masteredAll = await getMasteredLemmas();
  const newlyMastered = masteredAll.filter((l) => quizLemmas.includes(l));

  await recordQuizResult(quizId, payload.score, payload.questions.length, newlyMastered);

  const lines = [
    "🏁 *Le Grand Test klart!*",
    `Poäng: *${payload.score}/${payload.questions.length}*`
  ];
  if (newlyMastered.length) {
    lines.push("", `🎉 Behärskade ord: ${newlyMastered.join(", ")}`);
  } else {
    lines.push("", "Inga nya ord nådde full mastery den här gången — fortsätt nöta uttal + stavning.");
  }
  lines.push("", "À dimanche prochain ! 🇫🇷");
  return { reply: lines.join("\n"), done: true };
}

/**
 * Lärarens dom efter en avstämning: ett ord får JA bara om BÅDE stavning och
 * uttal satt (grade >= 3). Alla ord JA → modulen godkänd → nästa låses upp.
 */
async function finishCheckpoint(quizId: string, payload: QuizPayload): Promise<QuizStep> {
  // Samla betyg per ord och kanal.
  const byLemma = new Map<string, { prod?: number; pron?: number }>();
  for (const q of payload.questions) {
    const entry = byLemma.get(q.lemma) ?? {};
    if (q.kind === "production") entry.prod = q.grade ?? 0;
    if (q.kind === "pronunciation") entry.pron = q.grade ?? 0;
    byLemma.set(q.lemma, entry);
  }

  const passed: string[] = [];
  const failed: { lemma: string; missing: string }[] = [];
  for (const [lemma, g] of byLemma) {
    const spellingOk = (g.prod ?? 0) >= 3;
    const soundOk = (g.pron ?? 0) >= 3;
    if (spellingOk && soundOk) {
      await setItemMastered(lemma, true);
      passed.push(lemma);
    } else {
      const missing = !spellingOk && !soundOk ? "stavning + uttal" : !spellingOk ? "stavning" : "uttal";
      failed.push({ lemma, missing });
    }
  }

  const { advanceCurriculum } = await import("./curriculum.js");
  const unlocked = await advanceCurriculum();
  await recordQuizResult(quizId, passed.length, byLemma.size, passed);

  const moduleOk = failed.length === 0;
  const lines: string[] = [
    moduleOk ? `✅ *Godkänt!* ${payload.moduleId} sitter.` : `📋 *Avstämning ${payload.moduleId} klar*`
  ];
  lines.push("", `Läraren säger JA på ${passed.length}/${byLemma.size} ord.`);

  if (passed.length) lines.push("", `✅ Behärskade: ${passed.join(", ")}`);
  if (failed.length) {
    lines.push("", "🔄 Behöver mer (läraren säger NEJ än):");
    for (const f of failed) lines.push(`• ${f.lemma} — ${f.missing}`);
  }

  if (moduleOk && unlocked.length) {
    lines.push("", `🔓 Nästa del upplåst: ${unlocked.join(", ")}. På vi! 🇫🇷`);
  } else if (moduleOk) {
    lines.push("", "Hela delen sitter. 🎉");
  } else {
    lines.push("", "Nöt vidare på orden ovan, kör /avstämning igen när du är redo.");
  }

  return { reply: lines.join("\n"), done: true };
}
