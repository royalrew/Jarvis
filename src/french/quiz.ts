import {
  getLesson,
  setLessonPayload,
  setLessonStatus,
  recordQuizResult,
  getMasteredLemmas,
  updateState,
  type Channel
} from "./db.js";
import { gradeFacet, MASTERY_STABILITY } from "./fsrs.js";
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

  const { advanceCurriculum } = await import("./curriculum.js");
  await advanceCurriculum();

  const quizLemmas = [...new Set(payload.questions.map((q) => q.lemma))];
  const masteredAll = await getMasteredLemmas(MASTERY_STABILITY);
  const newlyMastered = masteredAll.filter((l) => quizLemmas.includes(l));

  await recordQuizResult(quizId, payload.score, payload.questions.length, newlyMastered);

  const lines = [
    "🏁 *Le Grand Test klart!*",
    `Poäng: *${payload.score}/${payload.questions.length}*`
  ];
  if (newlyMastered.length) {
    lines.push("", `🎉 Fullt behärskade (både stavning + uttal): ${newlyMastered.join(", ")}`);
  } else {
    lines.push("", "Inga nya ord nådde full mastery den här gången — fortsätt nöta uttal + stavning.");
  }
  lines.push("", "À dimanche prochain ! 🇫🇷");
  return { reply: lines.join("\n"), done: true };
}
