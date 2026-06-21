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
  "Du gör en bildningsresa genom Frankrike tillsammans med Anna, en kunnig fransk guide som visar dig slott, kyrkor och katedraler samt första och andra världskrigets platser, och berättar levande om landets kultur och historia.";

export const CAST =
  "Du (Jimmy) är resenären. Anna är din franska guide som lär dig språket OCH berättar om kultur och historia. Övriga bipersoner (servitörer, museivärdar, lokalbor) får hittas på efter behov.";

export interface StoryBeat {
  day: number;
  location: string;
  placeName: string;
  placeKind: string;
  recap: string;
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
    .map((b) => `Dag ${b.day}: ${b.placeName} (${b.placeKind}) — ${b.recap}`)
    .join("\n");
}
