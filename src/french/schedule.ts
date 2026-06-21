import { hasLessonForDate } from "./db.js";
import { buildDailyLesson, buildGrandTest, renderQuestion } from "./lessons.js";
import { zonedNow, todayStockholm } from "./time.js";

/**
 * Dagsloopen (M3/M5). Minuttick som matchar hur Jarvis redan schemalägger
 * (reminders.ts) snarare än att dra in node-cron.
 *
 * - Vardagar (mån–lör) 07:00 → daglig lektion.
 * - Söndagar 10:00 → Le Grand Test.
 *
 * Idempotent: dubbelkollar mot fr_lessons så en omstart eller flera tick inte
 * skickar samma sak två gånger.
 */

export interface FrenchScheduleDeps {
  sendMessage: (text: string) => Promise<void>;
  /** Läser upp ren fransk text som röstnot (valfritt). */
  sendVoice?: (frenchText: string) => Promise<void>;
}

const TICK_MS = 30_000;
const WINDOW_MIN = 3; // accepterar tick inom 0–2 min efter slaget

export function startFrenchSchedule(deps: FrenchScheduleDeps): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const now = zonedNow();
      const date = todayStockholm();

      const isWeekday = now.weekday >= 1 && now.weekday <= 6;
      const isSunday = now.weekday === 0;
      const inWindow = (hour: number) => now.hour === hour && now.minute < WINDOW_MIN;

      if (isWeekday && inWindow(7) && !(await hasLessonForDate("daily", date))) {
        const lesson = await buildDailyLesson();
        await deps.sendMessage(["☀️ *Bonjour !* Dagens franska:", "", lesson.text].join("\n"));
        await deps.sendVoice?.(lesson.reply);
        console.log(`[Français] Daglig lektion skickad (${date}, tema: ${lesson.theme}).`);
      }

      if (isSunday && inWindow(10) && !(await hasLessonForDate("quiz", date))) {
        const quiz = await buildGrandTest();
        if (quiz.payload.questions.length === 0) {
          console.log("[Français] Le Grand Test hoppat över — för få frågor i datalagret än.");
        } else {
          await deps.sendMessage(quiz.intro);
          await deps.sendMessage(renderQuestion(quiz.payload));
          console.log(`[Français] Le Grand Test skickat (${date}, ${quiz.payload.questions.length} frågor).`);
        }
      }
    } catch (err) {
      console.error("[Français] Schemafel:", err);
    }
  };

  const timer = setInterval(tick, TICK_MS);
  // Kör ett tick direkt vid boot (täcker omstart precis efter ett slag).
  tick();

  console.log("[Français] Schema aktivt: lektion mån–lör 07:00, Le Grand Test sön 10:00 (Europe/Stockholm).");

  return () => {
    stopped = true;
    clearInterval(timer);
    console.log("[Français] Schema stoppat.");
  };
}
