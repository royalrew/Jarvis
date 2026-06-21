import { getSql } from "../db.js";

/**
 * Story-minnet för den sammanhängande reseberättelsen.
 *
 * I stället för fristående, hårdkodade scener driver AI:n en pågående resa
 * genom Frankrike: du (Jimmy) reser med Anna — en kultur- och historieguide —
 * och varje lektion fortsätter där förra slutade, till en ny riktig plats.
 *
 * Det deterministiska lagret äger var berättelsen är (plats, dag, beats);
 * LLM:en hittar bara på nästa scen utifrån det.
 */

export const DEFAULT_PREMISE =
  "Du landar på Charles de Gaulle utan att kunna franska och bygger steg för steg ett verkligt liv i Frankrike. Resan blandar vardag, relationer, kultur, historia, slott och platser kopplade till första och andra världskriget. Händelserna uppstår fritt ur det som redan har hänt; det finns ingen fast rutt.";

const LEGACY_PREMISE =
  "Du gör en bildningsresa genom Frankrike tillsammans med Anna, en kunnig fransk guide som visar dig slott, kyrkor och katedraler samt första och andra världskrigets platser, och berättar levande om landets kultur och historia.";

export const CAST =
  "Du (Jimmy) är ny i Frankrike. Anna är din första vän och återkommande reskamrat, inte en ständig lärare eller guide. Skapa fritt trovärdiga återkommande personer när världen behöver dem: grannar, vårdpersonal, servitörer, kollegor, guider, lokalbor och vänner.";

/** Intressen och möjliga resmål — inspiration för modellen, aldrig en fast rutt. */
export const TRAVEL_INTERESTS = [
  "Paris historiska miljöer, Versailles och Fontainebleau",
  "Loiredalens slott, exempelvis Chambord, Chenonceau och Amboise",
  "medeltida platser som Mont-Saint-Michel och Carcassonne",
  "Reims och andra platser som berättar om Frankrikes kungar och samhällsutveckling",
  "första världskrigets Verdun, Douaumont, Somme och Chemin des Dames",
  "andra världskrigets Normandie, Caen, Bayeux, Paris under ockupationen, Oradour-sur-Glane, Alsace och Maginotlinjen",
  "regional kultur i bland annat Normandie, Bretagne, Alsace, Provence och Occitanien"
].join("; ");

export interface StoryBeat {
  day: number;
  location: string;
  placeName: string;
  placeKind: string;
  recap: string;
  /** Fri scenkategori från modellen, t.ex. vardag, relation, resa eller historia. */
  sceneKind?: string;
}

export interface Story {
  premise: string;
  location: string | null;
  nextHint: string | null;
  day: number;
  beats: StoryBeat[];
}

const MAX_BEATS = 30;

export async function getStory(): Promise<Story> {
  const sql = getSql();
  const rows = await sql`SELECT premise, location, next_hint, day, beats FROM fr_story WHERE id = 1 LIMIT 1`;
  const r = rows[0];
  if (!r) {
    return { premise: DEFAULT_PREMISE, location: null, nextHint: null, day: 0, beats: [] };
  }
  return {
    premise: (r.premise as string) ?? DEFAULT_PREMISE,
    location: (r.location as string) ?? null,
    nextHint: (r.next_hint as string) ?? null,
    day: (r.day as number) ?? 0,
    beats: ((r.beats as StoryBeat[]) ?? [])
  };
}

/** Skapar story-raden med default-premiss om den saknas. Idempotent. */
export async function initStoryIfNeeded(): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO fr_story (id, premise, day, beats)
    VALUES (1, ${DEFAULT_PREMISE}, 0, '[]'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `;
  // Uppgradera enbart den gamla standardpremissen. Egna premisser lämnas orörda.
  await sql`UPDATE fr_story SET premise = ${DEFAULT_PREMISE}, updated_at = now() WHERE id = 1 AND premise = ${LEGACY_PREMISE}`;
}

export async function updateStory(patch: Partial<{ premise: string; location: string; nextHint: string; day: number }>) {
  const sql = getSql();
  const sets: ReturnType<typeof sql>[] = [];
  if (patch.premise !== undefined) sets.push(sql`premise = ${patch.premise}`);
  if (patch.location !== undefined) sets.push(sql`location = ${patch.location}`);
  if (patch.nextHint !== undefined) sets.push(sql`next_hint = ${patch.nextHint}`);
  if (patch.day !== undefined) sets.push(sql`day = ${patch.day}`);
  if (sets.length === 0) return;

  let assignment = sets[0];
  for (let i = 1; i < sets.length; i++) assignment = sql`${assignment}, ${sets[i]}`;
  await sql`UPDATE fr_story SET ${assignment}, updated_at = now() WHERE id = 1`;
}

/** Lägger till en återblick (cappar lagrade beats till MAX_BEATS). */
export async function appendBeat(beat: StoryBeat): Promise<void> {
  const sql = getSql();
  const story = await getStory();
  const beats = [...story.beats, beat].slice(-MAX_BEATS);
  await sql`UPDATE fr_story SET beats = ${sql.json(beats as never)}, updated_at = now() WHERE id = 1`;
}

/** Skriver tillbaka det faktiska utfallet när en flerstegsscen har avslutats. */
export async function finalizeScene(update: { recap: string; location?: string; nextHint?: string }): Promise<void> {
  const sql = getSql();
  const story = await getStory();
  const beats = [...story.beats];
  const last = beats.at(-1);
  if (last) {
    beats[beats.length - 1] = {
      ...last,
      recap: update.recap,
      location: update.location || last.location
    };
  }
  await sql`
    UPDATE fr_story
    SET beats = ${sql.json(beats as never)},
        location = ${update.location || story.location},
        next_hint = ${update.nextHint ?? story.nextHint},
        updated_at = now()
    WHERE id = 1
  `;
}

/** Börjar om resan. Behåller kursprogress/mastery — bara berättelsen nollställs. */
export async function resetStory(premise?: string): Promise<void> {
  const sql = getSql();
  const p = premise?.trim()
    ? `${DEFAULT_PREMISE} Särskilt fokus den här resan: ${premise.trim()}.`
    : DEFAULT_PREMISE;
  await sql`
    INSERT INTO fr_story (id, premise, location, next_hint, day, beats)
    VALUES (1, ${p}, NULL, NULL, 0, '[]'::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      premise = EXCLUDED.premise, location = NULL, next_hint = NULL, day = 0, beats = '[]'::jsonb, updated_at = now()
  `;
}

/** Kort sammanfattning av de senaste anhalterna — matas till LLM:en som kontext. */
export function summarizeRecentBeats(story: Story, count = 8): string {
  if (story.beats.length === 0) return "(resan har inte börjat än — detta är första anhalten)";
  return story.beats
    .slice(-count)
    .map((b) => `Scen ${b.day}: ${b.placeName} (${b.placeKind}${b.sceneKind ? `, ${b.sceneKind}` : ""}) — ${b.recap}`)
    .join("\n");
}
