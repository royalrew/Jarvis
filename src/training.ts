import postgres from "postgres";
import crypto from "node:crypto";
import { getTrainingSmartMatch, generateDynamicWorkout } from "./llm.js";
import { TIERS } from "./seed-content.js";

type Mode = "reps" | "hold";
export type TrainingLocation = "hemma" | "utegym";

const USER_ID = "me";

/**
 * Tolkar om Jimmy sagt att han tränar ute (utegym/stång) eller inne (hemma/golv),
 * så att dagens pass kan anpassas efter tillgänglig utrustning.
 */
export function detectTrainingLocation(message: string): TrainingLocation | undefined {
  const p = normalizeText(message.toLowerCase());
  if (/\bute\b|utegym|utomhus|parken|stang|racke|barr/.test(p)) return "utegym";
  if (/\binne\b|hemma|inomhus|vardagsrum|golvet|hemmaplan/.test(p)) return "hemma";
  return undefined;
}

const EXERCISE_MODE: Record<string, Mode> = {
  "pull-ups": "reps",
  "australiska rows": "reps",
  "scapula-pulls": "reps",
  "negativa pull-ups": "reps",
  "dips": "reps",
  "armhävningar": "reps",
  "pike push-ups": "reps",
  "hängande knälyft": "reps",
  "hängande benlyft": "reps",
  "liggande benlyft": "reps",
  "side plank": "hold",
  "hollow hold": "hold",
  "tuck front lever": "hold",
  "support-hållning": "hold",
  "pseudo planche-lutning": "hold",
  "väggstående handstativ": "hold",
  "fristående handstativ": "hold",
  "vertikal flagga": "hold",
  "tuck-flagga": "hold",
  "straddle-flagga": "hold",
  "split squats": "reps",
  "pistol-progression": "reps"
};

const EXERCISE_ALIASES: Record<string, string> = {
  pullups: "Pull-ups",
  "pull ups": "Pull-ups",
  chins: "Pull-ups",
  dips: "Dips",
  "hollow hold": "Hollow hold",
  hollow: "Hollow hold",
  "side plank": "Side plank",
  sidoplanka: "Side plank",
  armhävningar: "Armhävningar",
  armhävning: "Armhävningar",
  pushups: "Armhävningar",
  "push ups": "Armhävningar",
  "pike pushups": "Pike push-ups",
  "pike push-ups": "Pike push-ups",
  "tuck front lever": "Tuck front lever",
  "front lever": "Tuck front lever",
  "hängande knälyft": "Hängande knälyft",
  knälyft: "Hängande knälyft",
  "liggande benlyft": "Liggande benlyft",
  benlyft: "Liggande benlyft",
  handstående: "Väggstående handstativ",
  handstativ: "Väggstående handstativ",
  "pseudo planche": "Pseudo planche-lutning",
  "pseudo planche-lutning": "Pseudo planche-lutning"
};

const HOME_TEMPLATE = [
  "Handled- & axelprep 5 min",
  "Handstativ mot vägg 3×20-40s",
  "Pseudo planche-lutning 3×15s",
  "Armhävningar 4×8-15",
  "Pike push-ups 3×5-8",
  "Hollow hold 3×30s",
  "Side plank 3×30s/sida",
  "Liggande benlyft 3×10",
  "Split squats / pistol-prog. 3×8"
];

const OUTDOOR_TEMPLATE = [
  "Scapula-pulls i stången 2×8",
  "Tuck front lever 4×8s",
  "Flagg-försök om stolpe finns 4×5-10s",
  "Pull-ups 4×3-8",
  "Australiska rows 3×8-12",
  "Dips på barren 4×3-8",
  "Hängande knälyft 3×8-12"
];

let sql: ReturnType<typeof postgres> | null = null;

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas i .env.");
  sql ??= postgres(url, { max: 3 });
  return sql;
}

export function parseTrainingCommand(input: string) {
  const line = input.trim().toLowerCase();
  const plain = normalizeText(line);

  const openMatch = plain.match(/^(?:oppna|open|visa)\s+(?:traning|training|trainer|traningsappen|pass|loggen|logg|nivaer|levels|kampanj|campaign)/);
  if (openMatch || plain === "/trainer" || plain.startsWith("/trainer ")) {
    let view: "pass" | "logg" | "nivaer" | "kampanj" = "pass";
    if (plain.includes("logg")) view = "logg";
    if (plain.includes("niva") || plain.includes("level")) view = "nivaer";
    if (plain.includes("kampanj") || plain.includes("campaign")) view = "kampanj";
    return { type: "open" as const, view };
  }

  if (
    plain === "/next-training" ||
    plain.includes("nasta mal") ||
    plain.includes("nasta niva") ||
    plain.includes("next goal") ||
    plain.includes("vad ar nasta")
  ) {
    return { type: "next" as const };
  }

  const completeMatch = plain.match(/^(?:\/complete-level|klarade|markera|bocka av|complete)\s+(.+)$/);
  if (completeMatch && (plain.includes("niva") || plain.includes("level"))) {
    const trackId = normalizeTrack((completeMatch[1] ?? "").replace(/nasta|nästa|niva|level/g, " "));
    if (trackId) return { type: "completeLevel" as const, trackId };
  }

  // Backa/ångra en nivå om man markerat fel: "backa core", "ångra bål"
  const backMatch = plain.match(/^(?:backa|angra|ta tillbaka|nollstall)\s+(.+)$/);
  if (backMatch) {
    const trackId = normalizeTrack(backMatch[1] ?? "");
    if (trackId) return { type: "backLevel" as const, trackId };
  }

  // Avancera kampanjen: "klarade veckan", "klara bossen", "bocka av kampanjveckan"
  const campaignVerb =
    plain.includes("klarade") || plain.includes("klarat") || plain.includes("bocka") ||
    plain.includes("besegrade") || plain.includes("slog") || plain.includes("klara ");
  const campaignNoun =
    plain.includes("veckan") || plain.includes("vecka") || plain.includes("bossen") ||
    plain.includes("boss") || plain.includes("kampanj");
  if ((campaignVerb && campaignNoun) || plain === "/complete-campaign") {
    return { type: "completeCampaign" as const };
  }

  const completeKeywords = [
    "klarade",
    "klarat",
    "complete",
    "completed",
    "bocka",
    "bockat",
    "markerat",
    "markera",
    "avklarade",
    "avklarat",
    "klar",
    "fixade",
    "fixat",
    "nadde",
    "tog"
  ];

  const words = plain.split(/[\s,.\-!]+/);
  const isSmartComplete =
    words.some((w) =>
      completeKeywords.includes(w) ||
      w.startsWith("klarad") ||
      w.startsWith("klarat") ||
      w.startsWith("avklarad") ||
      w.startsWith("avklarat")
    ) ||
    plain.endsWith("done");

  if (isSmartComplete) {
    return { type: "smartComplete" as const, input };
  }

  if (
    plain.includes("boka passet") ||
    plain.includes("spara passet") ||
    plain.includes("lagg till passet") ||
    plain.includes("lägg till passet") ||
    plain.includes("logga passet") ||
    plain.includes("forbered passet") ||
    plain.includes("förbered passet") ||
    plain.includes("skapa passet")
  ) {
    return { type: "createDraft" as const };
  }

  if (
    plain === "kampanj" ||
    plain === "/kampanj" ||
    plain.includes("var ar jag i kampanj") ||
    plain.includes("kampanjlage") ||
    plain.includes("vilken vecka") ||
    plain.includes("vilken boss") ||
    (plain.includes("kampanj") && (plain.includes("status") || plain.includes("visa") || plain.includes("lage")))
  ) {
    return { type: "campaign" as const };
  }

  if (
    plain === "/traning" ||
    plain === "/training" ||
    plain.includes("vad ska jag trana") ||
    (plain.includes("vad ska jag") && plain.includes("idag")) ||
    plain.includes("dagens pass") ||
    plain.includes("trana idag") ||
    plain.includes("traning idag") ||
    plain.includes("traningspass") ||
    plain.includes("nasta pass") ||
    (plain.includes("pass") &&
      (plain.includes("har vi") ||
        plain.includes("nasta") ||
        plain.includes("idag") ||
        plain.includes("imorgon")))
  ) {
    return { type: "today" as const, location: detectTrainingLocation(input) };
  }

  if (
    plain.includes("traningslage") ||
    plain.includes("traning status") ||
    plain.includes("hur ligger jag till") ||
    plain.includes("traningsdelen")
  ) {
    return { type: "status" as const };
  }

  const logMatch = input.match(/^(?:\/loggträning|\/logtraining|logga|lägg in)\s+(.+?)\s+((?:\d+\s*){1,12})(?:\s*\+\s*(\d+))?\s*(?:kg)?$/i);
  if (logMatch) {
    const exercise = normalizeExercise(logMatch[1] ?? "");
    const sets = (logMatch[2] ?? "")
      .trim()
      .split(/\s+/)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    const weight = logMatch[3] ? Number.parseInt(logMatch[3], 10) : null;
    if (exercise && sets.length > 0) return { type: "log" as const, exercise, sets, weight };
  }

  return null;
}

export async function handleTrainingCommand(command: NonNullable<ReturnType<typeof parseTrainingCommand>>) {
  if (command.type === "today") return getTodayTrainingReply(command.location);
  if (command.type === "status") return getTrainingStatusReply();
  if (command.type === "open") return getOpenTrainingReply(command.view);
  if (command.type === "next") return getNextTrainingReply();
  if (command.type === "campaign") return getCampaignReply();
  if (command.type === "completeCampaign") return completeCampaignReply();
  if (command.type === "completeLevel") return completeNextLevelReply(command.trackId);
  if (command.type === "backLevel") return backLevelReply(command.trackId);
  if (command.type === "smartComplete") return handleSmartComplete(command.input);
  if (command.type === "createDraft") return createDraftedWorkoutSession();
  return logTrainingReply(command.exercise, command.sets, command.weight);
}

export async function handleSmartComplete(input: string): Promise<string | null> {
  const levels = await db()`
    select t.id as track_id, t.name as track_name, l.idx, l.name as level_name, l.target
    from track t
    join track_level l on l.track_id = t.id
    order by t.sort_idx, l.idx
  `;

  const progressRows = await db()`
    select track_id, reached from track_progress
    where user_id = ${USER_ID}
  `;
  const progressMap = new Map<string, number>();
  for (const row of progressRows) {
    progressMap.set(String(row.track_id), Number(row.reached));
  }

  const levelsText = levels.map((l) => {
    const reached = progressMap.get(String(l.track_id)) ?? 0;
    return `- Spår [ID: ${l.track_id}, Namn: ${l.track_name}] Nivå ${l.idx}: "${l.level_name}" (Mål: ${l.target}) | reached: ${reached}`;
  }).join("\n");

  const systemPrompt = `
Du är träningsassistenten Jarvis för calisthenics-applikationen "Vägen till flaggan".
Din uppgift är att matcha användarens påstående om att ha klarat en övning mot den rätta nivån i träningsdatabasen.

Här är alla tillgängliga nivåspår, nivåer och användarens nuvarande framsteg (reached anger den senast avklarade nivån):
${levelsText}

Analysera användarens meddelande och avgör om de har klarat en nivå.
Svara EXKLUSIVT med ett JSON-objekt i följande format:
{
  "matched": true,
  "trackId": "core",
  "levelIdx": 1,
  "levelName": "Hollow hold",
  "target": "40s",
  "trackName": "Bål",
  "confidence": 0.95,
  "explanation": "Användaren klarade hollow hold 40 sekunder, vilket matchar Bål nivå 1."
}

Om du inte kan matcha påståendet till en specifik nivå med rimlig säkerhet (confidence < 0.7), eller om det bara är en allmän kommentar, svara med:
{
  "matched": false,
  "trackId": null,
  "levelIdx": null,
  "levelName": null,
  "target": null,
  "trackName": null,
  "confidence": 0.0,
  "explanation": "Kunde inte hitta en matchande nivå."
}
  `.trim();

  try {
    const match = await getTrainingSmartMatch(systemPrompt, input);

    if (match.matched && match.trackId && match.confidence >= 0.7) {
      const reached = progressMap.get(match.trackId) ?? 0;
      const nextLevelIdx = reached + 1;

      if (match.levelIdx !== null && match.levelIdx <= reached) {
        return `Det matchar **${match.trackName} nivå ${match.levelIdx}: ${match.levelName}** (mål: ${match.target}), men du har redan markerat nivå ${reached} eller högre som klar på det spåret. Bra kört ändå!`;
      }

      // Hoppar mer än ett steg framåt: bocka av hela vägen upp till den nivån.
      const targetIdx = match.levelIdx !== null && match.levelIdx > nextLevelIdx ? match.levelIdx : nextLevelIdx;

      await db()`
        insert into track_progress (user_id, track_id, reached)
        values (${USER_ID}, ${match.trackId}, ${targetIdx})
        on conflict (user_id, track_id) do update set reached = ${targetIdx}
      `;

      const jumped = targetIdx - reached;
      const jumpNote = jumped > 1 ? ` (hoppade upp ${jumped} nivåer)` : "";
      return `✅ Bockat av: **${match.trackName} nivå ${targetIdx}: ${match.levelName}** (mål: ${match.target})${jumpNote}. Snyggt jobbat! Säg "backa ${match.trackId}" om jag tog i för mycket.`;
    }
  } catch (error) {
    console.error("[Training Smart Match] error:", error);
  }

  return null;
}

/** Länk till webb-appen om TRAINER_URL är satt, annars null (Telegram-först). */
function appLink(view: string): string | null {
  const base = process.env.TRAINER_URL?.replace(/\/+$/, "");
  return base ? `${base}/${view}` : null;
}

async function getOpenTrainingReply(view: "pass" | "logg" | "nivaer" | "kampanj") {
  const labels = {
    pass: "dagens pass",
    logg: "loggen",
    nivaer: "nivåerna",
    kampanj: "kampanjen"
  };
  const link = appLink(view);
  if (link) return `Öppna ${labels[view]}: ${link}`;

  // Ingen webb deployad → visa innehållet direkt här i Telegram.
  if (view === "pass") return getTodayTrainingReply();
  if (view === "kampanj") return getCampaignReply();
  return getTrainingStatusReply();
}

async function getCampaignReply() {
  const active = await getActiveCampaignItem();
  const clearedRows = await db()`
    select count(*)::int n from campaign_progress
    where user_id = ${USER_ID} and cleared = true
  `;
  const clearedCount = Number(clearedRows[0]?.n ?? 0);

  if (!active) {
    return "🏆 Hela kampanjen är klar – alla tiers och bossar besegrade. Galet jobbat.";
  }

  const kind = active.type === "boss" ? "🔥 SLUTBOSS" : `Vecka ${active.weekIdx}`;
  return [
    `🗺️ Kampanjläge — Tier ${active.tierIdx}: ${active.tierName}`,
    `${kind}: ${active.boss}`,
    `Fokus: ${active.focus}`,
    `Krav: ${active.criteria}`,
    "",
    `Avklarat hittills: ${clearedCount} steg.`,
    "Klarat det? Skriv 'klarade veckan' (eller 'klarade bossen') så bockar jag av och låser upp nästa."
  ].join("\n");
}

async function completeCampaignReply() {
  const active = await getActiveCampaignItem();
  if (!active) {
    return "Det finns inget aktivt kampanjsteg att bocka av – allt är redan klart. 🏆";
  }

  await db()`
    insert into campaign_progress (user_id, item_id, cleared)
    values (${USER_ID}, ${active.id}, true)
    on conflict (user_id, item_id) do update set cleared = true
  `;

  const clearedLabel =
    active.type === "boss" ? `slutbossen ${active.boss}` : `vecka ${active.weekIdx} (${active.boss})`;
  const next = await getActiveCampaignItem();

  if (!next) {
    return `✅ Bockade av ${clearedLabel}. Och därmed är HELA kampanjen klar. Du är elit, Jimmy. 🏆`;
  }

  const nextKind = next.type === "boss" ? `slutbossen ${next.boss}` : `vecka ${next.weekIdx}: ${next.boss}`;
  return [
    `✅ Bockade av ${clearedLabel}. Snyggt.`,
    `Nästa: Tier ${next.tierIdx} — ${nextKind}.`,
    `Fokus: ${next.focus}`,
    "Skriv 'dagens pass' så bygger jag passet för det."
  ].join("\n");
}

async function getNextTrainingReply() {
  const status = await getProgressSummary();
  if (status.nextReady.length === 0) {
    return "Jag hittar inget nytt rimligt nivåmål just nu. Antingen är allt klart, eller så behöver en gate öppnas först.";
  }

  return [
    "Nästa rimliga träningsmål:",
    ...status.nextReady.slice(0, 5).map((item) => `- ${item}`),
    "",
    "Jag håller tillbaka human flag/front lever tills grunden är där. Ingen cirkus dag ett."
  ].join("\n");
}

async function completeNextLevelReply(trackId: string) {
  const rows = await db()`
    select t.id, t.name, coalesce(p.reached, 0)::int as reached,
      (select count(*)::int from track_level l where l.track_id = t.id) as total
    from track t
    left join track_progress p on p.track_id = t.id and p.user_id = ${USER_ID}
    where t.id = ${trackId}
    limit 1
  `;

  const row = rows[0];
  if (!row) return `Jag hittar inget nivåspår som heter ${trackId}.`;

  const next = Math.min(Number(row.reached) + 1, Number(row.total));
  await db()`
    insert into track_progress (user_id, track_id, reached)
    values (${USER_ID}, ${trackId}, ${next})
    on conflict (user_id, track_id)
    do update set reached = ${next}
  `;

  return `Markerat: ${row.name} nivå ${next}/${row.total} klar. Det påverkar vad jag föreslår i kommande pass.`;
}

async function backLevelReply(trackId: string) {
  const rows = await db()`
    select t.name, coalesce(p.reached, 0)::int as reached
    from track t
    left join track_progress p on p.track_id = t.id and p.user_id = ${USER_ID}
    where t.id = ${trackId}
    limit 1
  `;

  const row = rows[0];
  if (!row) return `Jag hittar inget nivåspår som heter ${trackId}.`;

  const back = Math.max(0, Number(row.reached) - 1);
  await db()`
    insert into track_progress (user_id, track_id, reached)
    values (${USER_ID}, ${trackId}, ${back})
    on conflict (user_id, track_id)
    do update set reached = ${back}
  `;

  return `↩️ Backade ${row.name} till nivå ${back}. Ingen skam i att kalibrera om — bättre rätt än för snabbt.`;
}

async function getActiveCampaignItem() {
  const rows = await db()`
    select item_id, cleared
    from campaign_progress
    where user_id = ${USER_ID} and cleared = true
  `;
  const cleared = new Set(rows.map((r) => String(r.item_id)));

  let previousBossCleared = true;
  for (const item of TIERS) {
    if (!previousBossCleared) break;
    const firstOpenWeek = item.weeks.find((week) => !cleared.has(week.id));
    if (firstOpenWeek) {
      return {
        type: "week" as const,
        tierIdx: item.idx,
        tierName: item.name,
        weekIdx: firstOpenWeek.idx,
        id: firstOpenWeek.id,
        boss: firstOpenWeek.boss,
        focus: firstOpenWeek.focus,
        criteria: firstOpenWeek.criteria,
      };
    }
    if (!cleared.has(item.endboss.id)) {
      return {
        type: "boss" as const,
        tierIdx: item.idx,
        tierName: item.name,
        weekIdx: null,
        id: item.endboss.id,
        boss: item.endboss.name,
        focus: "Besegra slutbossen för att låsa upp nästa Tier!",
        criteria: item.endboss.criteria.join(" · "),
      };
    }
    previousBossCleared = true;
  }
  return null;
}

async function getTodayTrainingReply(location?: TrainingLocation) {
  const activeItem = await getActiveCampaignItem();
  if (!activeItem) {
    return [
      "Grattis! Du har klarat av alla Tiers och bossar i kampanjen! Du är en certifierad calisthenics-elit.",
      "Fortsätt köra egna pass och logga med t.ex. 'loggade pull-ups 8 7 6'."
    ].join("\n");
  }

  const status = await getProgressSummary();
  const generated = await generateDynamicWorkout(activeItem, status, location);

  const header =
    location === "hemma"
      ? "🏠 Hemmapass (golv, parallettes, hantlar).\n\n"
      : location === "utegym"
        ? "🏋️ Utegympass (stång, räcke, barr).\n\n"
        : "";

  return [
    `${header}${generated.workoutText}`,
    "",
    "💡 *Tips:* Skriv 'spara passet' så lägger jag in passet i träningsdagboken — och logga resultat med t.ex. 'loggade frog stand 3x10'.",
    appLink("pass") ? `\nÖppna träningsappen: ${appLink("pass")}` : ""
  ].filter(Boolean).join("\n");
}

export async function createDraftedWorkoutSession() {
  const activeItem = await getActiveCampaignItem();
  if (!activeItem) {
    return "Ingen aktiv kampanj hittades att generera pass ifrån.";
  }

  const status = await getProgressSummary();
  const generated = await generateDynamicWorkout(activeItem, status);

  const date = new Date().toISOString().slice(0, 10);
  const sessionRows = await db()`
    select id from session
    where user_id = ${USER_ID} and date = ${date}
    limit 1
  `;

  const sessionId = sessionRows[0]?.id ?? crypto.randomUUID();
  if (!sessionRows[0]) {
    await db()`insert into session (id, user_id, date) values (${sessionId}, ${USER_ID}, ${date})`;
  }

  for (const exercise of generated.exercisesToLog) {
    await db()`
      insert into entry (id, session_id, name, mode, sets)
      values (${crypto.randomUUID()}, ${sessionId}, ${exercise.name}, ${exercise.mode}, ${exercise.sets})
    `;
  }

  return [
    `Done! Jag har förberett och lagt in följande övningar i din träningsdagbok för idag (${date}):`,
    ...generated.exercisesToLog.map(e => `- ${e.name} (${e.sets.length} set)`),
    "",
    "Fyll i dina resultat med t.ex. 'loggade pull-ups 8 7 6'." +
      (appLink("logg") ? `\nEller öppna loggen: ${appLink("logg")}` : "")
  ].join("\n");
}

async function getTrainingStatusReply() {
  const status = await getProgressSummary();
  const recent = await db()`
    select s.date, e.name, e.mode, e.sets, e.weight
    from session s
    join entry e on e.session_id = s.id
    where s.user_id = ${USER_ID}
    order by s.date desc
    limit 5
  `;

  return [
    `Träningsläge: ${status.clearedLevels}/${status.totalLevels} nivåer klara.`,
    "",
    ...status.tracks.map((track) => `- ${track.name}: ${track.reached}/${track.total}`),
    "",
    status.nextReady.length > 0 ? `Nästa rimliga mål: ${status.nextReady.slice(0, 4).join(", ")}.` : "Nästa mål: allt är markerat klart.",
    "",
    recent.length > 0
      ? ["Senaste logg:", ...recent.map((row) => {
          const suffix = row.mode === "hold" ? "s" : "";
          const weightStr = row.weight ? ` (+${row.weight}kg)` : "";
          return `- ${row.date}: ${row.name} ${row.sets.join("/")}${suffix}${weightStr}`;
        })].join("\n")
      : "Ingen träningslogg sparad ännu."
  ].join("\n");
}

async function logTrainingReply(exercise: string, sets: number[], weight: number | null = null) {
  const date = new Date().toISOString().slice(0, 10);
  const sessionRows = await db()`
    select id from session
    where user_id = ${USER_ID} and date = ${date}
    limit 1
  `;

  const sessionId = sessionRows[0]?.id ?? crypto.randomUUID();
  if (!sessionRows[0]) {
    await db()`insert into session (id, user_id, date) values (${sessionId}, ${USER_ID}, ${date})`;
  }

  const mode = modeFor(exercise);
  await db()`
    insert into entry (id, session_id, name, mode, sets, weight)
    values (${crypto.randomUUID()}, ${sessionId}, ${exercise}, ${mode}, ${sets}, ${weight})
  `;

  const suffix = mode === "hold" ? "s" : " reps";
  const weightSuffix = weight ? ` (+${weight}kg)` : "";
  return `Loggat: ${exercise} ${sets.join("/")}${suffix}${weightSuffix}. Bra, nu finns det i träningsloggen.`;
}

async function getProgressSummary() {
  const tracks = await db()`
    select t.id, t.name, coalesce(p.reached, 0)::int as reached,
      (select count(*)::int from track_level l where l.track_id = t.id) as total
    from track t
    left join track_progress p on p.track_id = t.id and p.user_id = ${USER_ID}
    order by t.sort_idx
  `;

  const nextRows = await db()`
    select t.id, t.name as track_name, l.name, l.target, l.idx
    from track t
    join track_level l on l.track_id = t.id
    left join track_progress p on p.track_id = t.id and p.user_id = ${USER_ID}
    where l.idx = coalesce(p.reached, 0) + 1
    order by t.sort_idx
  `;

  const clearedLevels = tracks.reduce((sum, track) => sum + Number(track.reached), 0);
  const totalLevels = tracks.reduce((sum, track) => sum + Number(track.total), 0);
  const dragReached = Number(tracks.find((track) => track.id === "drag")?.reached ?? 0);
  const coreReached = Number(tracks.find((track) => track.id === "core")?.reached ?? 0);
  const handReached = Number(tracks.find((track) => track.id === "hand")?.reached ?? 0);
  const ringsReached = Number(tracks.find((track) => track.id === "rings")?.reached ?? 0);
  const pushReached =
    handReached +
    Number(tracks.find((track) => track.id === "planche")?.reached ?? 0);
  const ready = {
    front: dragReached >= 1 && coreReached >= 1,
    flag: dragReached >= 2 && coreReached >= 2 && handReached >= 1,
    muscleUp: dragReached >= 2
  };

  const next = nextRows.map((row) => ({
    trackId: String(row.id),
    label: `${row.track_name}: ${row.name} (${row.target})`
  }));

  return {
    tracks: tracks.map((track) => ({
      id: String(track.id),
      name: String(track.name),
      reached: Number(track.reached),
      total: Number(track.total)
    })),
    clearedLevels,
    totalLevels,
    dragReached,
    pushReached,
    ready,
    next: next.map((row) => row.label),
    nextReady: next
      .filter((row) => {
        if (row.trackId === "front") return ready.front;
        if (row.trackId === "flag") return ready.flag;
        if (row.trackId === "mu") return ready.muscleUp;
        return true;
      })
      .map((row) => row.label)
  };
}

export async function getCoachContext(): Promise<string> {
  const status = await getProgressSummary();
  return status.tracks
    .map((track) => `- ${track.name}: nivå ${track.reached}/${track.total}`)
    .join("\n");
}

/**
 * Hämtar appens officiella cues för de övningar som nämns i meddelandet, så att
 * boten kan grunda sin coaching i exakt samma text som visas i appen.
 * Matchar på nyckelord mot track_level.name/plain (t.ex. "frog", "lever").
 */
export async function getExerciseCoaching(message: string): Promise<string | null> {
  const tokens = message
    .toLowerCase()
    .split(/[^a-zåäö0-9-]+/)
    .filter((w) => w.length >= 4 && !COACH_STOPWORDS.has(w));
  if (tokens.length === 0) return null;

  const patterns = tokens.map((t) => `%${t}%`);
  const rows = await db()`
    select t.name as track_name, l.idx, l.name, l.target, l.plain, l.how, l.regression, l.cue, l.ready
    from track_level l
    join track t on t.id = l.track_id
    where lower(l.name) ilike any(${patterns})
       or lower(coalesce(l.plain, '')) ilike any(${patterns})
    order by t.sort_idx, l.idx
    limit 4
  `.catch(() => [] as Array<Record<string, string | number | null>>);

  if (rows.length === 0) return null;

  return rows
    .map((r) => {
      const lines = [
        `• ${r.plain ?? r.name} (${r.track_name} nivå ${r.idx}, mål ${r.target})`,
        r.how ? `  Så här: ${r.how}` : "",
        r.cue ? `  Nyckel-cue: ${r.cue}` : "",
        r.regression ? `  Om för svårt: ${r.regression}` : "",
        r.ready ? `  Redo när: ${r.ready}` : ""
      ].filter(Boolean);
      return lines.join("\n");
    })
    .join("\n\n");
}

const COACH_STOPWORDS = new Set([
  "hjälp", "behöver", "behover", "hur", "gör", "gor", "jag", "med", "vad",
  "kan", "tips", "för", "for", "den", "det", "och", "att", "ska", "man",
  "mig", "frågar", "fragar", "teknik", "övning", "ovning", "övningen",
  "stand", "stance", "hålla", "halla", "klara", "träna", "trana", "göra"
]);

function normalizeExercise(raw: string) {
  const normalized = raw.trim().toLowerCase();
  return EXERCISE_ALIASES[normalized] ?? titleCaseExercise(normalized);
}

function titleCaseExercise(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function modeFor(exercise: string): Mode {
  return EXERCISE_MODE[exercise.toLowerCase()] ?? "reps";
}

function normalizeTrack(raw: string) {
  const value = normalizeText(raw).trim();
  if (value.includes("drag") || value.includes("pull")) return "drag";
  if (value.includes("bal") || value.includes("core") || value.includes("mage")) return "core";
  if (value.includes("hand")) return "hand";
  if (value.includes("planche")) return "planche";
  if (value.includes("front")) return "front";
  if (value.includes("flag")) return "flag";
  if (value.includes("muscle") || value === "mu") return "mu";
  if (value.includes("ring")) return "rings";
  return null;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ä/g, "a")
    .replace(/å/g, "a")
    .replace(/ö/g, "o");
}
