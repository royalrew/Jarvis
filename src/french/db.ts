import { getSql } from "../db.js";
import type { Card } from "ts-fsrs";

/**
 * Datalager för den adaptiva fransk-tutorn (v1.2).
 *
 * Det deterministiska lagret äger sanningen: items, facetter (med FSRS-state),
 * lektioner/prov och en enradig state-tabell som styr sessionerna. LLM:en bara
 * bedömer och extraherar — den schemalägger aldrig.
 *
 * Allt prefixas `fr_` så det inte krockar med bot-/trainer-tabellerna i samma
 * Railway-Postgres. Återanvänder den delade poolen via getSql().
 */

export type FacetKind = "meaning" | "production" | "pronunciation";
export type ItemType = "lexeme" | "grammar";
export type LessonType = "daily" | "quiz";
export type LessonStatus = "sent" | "answered" | "graded";
export type Channel = "text" | "voice";
export type Mode = "study" | "immersion";

export interface ItemMeta {
  genre?: string;
  ipa?: string;
  svensk_ljudharmning?: string;
  translation: string;
  phonemes?: string[];
}

export interface FrenchItem {
  id: string;
  type: ItemType;
  lemma: string;
  meta: ItemMeta;
}

export interface FrenchFacet {
  id: string;
  itemId: string;
  kind: FacetKind;
  card: Card;
}

export interface FrenchLesson {
  id: string;
  type: LessonType;
  date: string;
  theme: string | null;
  facetIds: string[];
  status: LessonStatus;
  payload: Record<string, unknown> | null;
}

export interface FrenchState {
  mode: Mode;
  chatActive: boolean;
  activeLessonId: string | null;
  activeQuizId: string | null;
  streak: number;
  lastLessonDate: string | null;
}

export interface FrenchError {
  id: string;
  category: string;
  utterance: string;
  correction: string;
  uttalstipsSv: string | null;
  createdAt: string;
}

/** Skapar alla fr_-tabeller om de saknas. Idempotent — körs vid varje boot. */
export async function initFrenchDb() {
  const sql = getSql();

  await sql`
    CREATE TABLE IF NOT EXISTS fr_items (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type       TEXT NOT NULL DEFAULT 'lexeme' CHECK (type IN ('lexeme','grammar')),
      lemma      TEXT NOT NULL UNIQUE,
      meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS fr_facets (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id        UUID NOT NULL REFERENCES fr_items(id) ON DELETE CASCADE,
      kind           TEXT NOT NULL CHECK (kind IN ('meaning','production','pronunciation')),
      stability      DOUBLE PRECISION NOT NULL DEFAULT 0,
      difficulty     DOUBLE PRECISION NOT NULL DEFAULT 0,
      due            TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_review    TIMESTAMPTZ,
      reps           INTEGER NOT NULL DEFAULT 0,
      lapses         INTEGER NOT NULL DEFAULT 0,
      state          INTEGER NOT NULL DEFAULT 0,
      scheduled_days INTEGER NOT NULL DEFAULT 0,
      elapsed_days   INTEGER NOT NULL DEFAULT 0,
      learning_steps INTEGER NOT NULL DEFAULT 0,
      leech          BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (item_id, kind)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS fr_lessons (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type       TEXT NOT NULL CHECK (type IN ('daily','quiz')),
      date       DATE NOT NULL,
      theme      TEXT,
      facet_ids  UUID[] NOT NULL DEFAULT '{}',
      status     TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','answered','graded')),
      payload    JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS fr_errors (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category      TEXT NOT NULL,
      utterance     TEXT NOT NULL,
      correction    TEXT NOT NULL,
      uttalstips_sv TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS fr_quiz_results (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lesson_id  UUID REFERENCES fr_lessons(id) ON DELETE SET NULL,
      score      INTEGER NOT NULL,
      total      INTEGER NOT NULL,
      mastered   JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS fr_state (
      id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      mode             TEXT NOT NULL DEFAULT 'study' CHECK (mode IN ('study','immersion')),
      chat_active      BOOLEAN NOT NULL DEFAULT false,
      active_lesson_id UUID,
      active_quiz_id   UUID,
      streak           INTEGER NOT NULL DEFAULT 0,
      last_lesson_date DATE,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`INSERT INTO fr_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
}

// --------------------------------------------------------------------------
// Items + facetter
// --------------------------------------------------------------------------

const FACET_KINDS: FacetKind[] = ["meaning", "production", "pronunciation"];

/**
 * Skapar (eller hämtar) ett item via lemma och säkerställer att alla tre
 * facetter finns. Nya facetter får ett tomt FSRS-kort.
 */
export async function upsertItemWithFacets(
  lemma: string,
  meta: ItemMeta,
  type: ItemType = "lexeme"
): Promise<string> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO fr_items (lemma, meta, type)
    VALUES (${lemma}, ${sql.json(meta as never)}, ${type})
    ON CONFLICT (lemma) DO UPDATE SET meta = fr_items.meta || ${sql.json(meta as never)}
    RETURNING id
  `;
  const itemId = rows[0].id as string;

  for (const kind of FACET_KINDS) {
    await sql`
      INSERT INTO fr_facets (item_id, kind)
      VALUES (${itemId}, ${kind})
      ON CONFLICT (item_id, kind) DO NOTHING
    `;
  }

  return itemId;
}

export async function getItemByLemma(lemma: string): Promise<FrenchItem | null> {
  const sql = getSql();
  const rows = await sql`SELECT id, type, lemma, meta FROM fr_items WHERE lemma = ${lemma} LIMIT 1`;
  if (rows.length === 0) return null;
  return rowToItem(rows[0]);
}

export async function getFacet(itemId: string, kind: FacetKind): Promise<FrenchFacet | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM fr_facets WHERE item_id = ${itemId} AND kind = ${kind} LIMIT 1`;
  if (rows.length === 0) return null;
  return rowToFacet(rows[0]);
}

export async function getFacetById(facetId: string): Promise<(FrenchFacet & { lemma: string; meta: ItemMeta }) | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT f.*, i.lemma AS lemma, i.meta AS meta
    FROM fr_facets f JOIN fr_items i ON i.id = f.item_id
    WHERE f.id = ${facetId} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return { ...rowToFacet(rows[0]), lemma: rows[0].lemma as string, meta: rows[0].meta as ItemMeta };
}

/** Persisterar ett uppdaterat FSRS-kort på en facett. */
export async function saveFacetCard(facetId: string, card: Card, leech?: boolean) {
  const sql = getSql();
  await sql`
    UPDATE fr_facets SET
      stability = ${card.stability},
      difficulty = ${card.difficulty},
      due = ${card.due},
      last_review = ${card.last_review ?? null},
      reps = ${card.reps},
      lapses = ${card.lapses},
      state = ${card.state},
      scheduled_days = ${card.scheduled_days},
      elapsed_days = ${card.elapsed_days},
      learning_steps = ${card.learning_steps ?? 0}
      ${leech === undefined ? sql`` : sql`, leech = ${leech}`}
    WHERE id = ${facetId}
  `;
}

/** Förfallna facetter (inlärningsschema) av en viss kind, närmast i tiden först. */
export async function getDueFacets(limit = 20, kinds: FacetKind[] = FACET_KINDS) {
  const sql = getSql();
  const rows = await sql`
    SELECT f.*, i.lemma AS lemma, i.meta AS meta
    FROM fr_facets f JOIN fr_items i ON i.id = f.item_id
    WHERE f.due <= now() AND f.kind = ANY(${kinds})
    ORDER BY f.due ASC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ ...rowToFacet(r), lemma: r.lemma as string, meta: r.meta as ItemMeta }));
}

/**
 * Items som är "nära mastery" men saknar poäng i antingen production eller
 * pronunciation — provbyggarens favoriter. Returnerar item + vilken facett
 * som släpar (det är den facetten provet ska testa).
 */
export async function getNearMasteryGaps(masteryStability: number, limit = 4) {
  const sql = getSql();
  const rows = await sql`
    WITH agg AS (
      SELECT i.id, i.lemma, i.meta,
        MAX(CASE WHEN f.kind = 'production'    THEN f.stability END) AS prod_s,
        MAX(CASE WHEN f.kind = 'pronunciation' THEN f.stability END) AS pron_s
      FROM fr_items i JOIN fr_facets f ON f.item_id = i.id
      GROUP BY i.id, i.lemma, i.meta
    )
    SELECT * FROM agg
    WHERE GREATEST(COALESCE(prod_s,0), COALESCE(pron_s,0)) >= ${masteryStability * 0.5}
      AND LEAST(COALESCE(prod_s,0), COALESCE(pron_s,0)) < ${masteryStability}
    ORDER BY GREATEST(COALESCE(prod_s,0), COALESCE(pron_s,0)) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => {
    const prod = Number(r.prod_s ?? 0);
    const pron = Number(r.pron_s ?? 0);
    // Facetten som släpar mest avgör vilket svarssätt provet kräver.
    const missingKind: FacetKind = prod <= pron ? "production" : "pronunciation";
    return {
      itemId: r.id as string,
      lemma: r.lemma as string,
      meta: r.meta as ItemMeta,
      missingKind,
      requireChannel: (missingKind === "production" ? "text" : "voice") as Channel
    };
  });
}

/** Envisa svagheter: leech-pinnade facetter, eller de med flest lapses. */
export async function getLeechFacets(limit = 4) {
  const sql = getSql();
  const rows = await sql`
    SELECT f.*, i.lemma AS lemma, i.meta AS meta
    FROM fr_facets f JOIN fr_items i ON i.id = f.item_id
    WHERE f.leech = true OR f.lapses >= 3
    ORDER BY f.leech DESC, f.lapses DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ ...rowToFacet(r), lemma: r.lemma as string, meta: r.meta as ItemMeta }));
}

/** Markerar/avmarkerar en facett som pinnad leech (svaghet att tvinga in). */
export async function pinLeech(facetId: string, leech: boolean) {
  await getSql()`UPDATE fr_facets SET leech = ${leech} WHERE id = ${facetId}`;
}

/**
 * Items som nu räknas som fullt behärskade: BÅDE production OCH pronunciation
 * har nått masterytröskeln (meaning räknas separat). Källstyrd dubbel-mastery.
 */
export async function getMasteredLemmas(masteryStability: number): Promise<string[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT i.lemma
    FROM fr_items i JOIN fr_facets f ON f.item_id = i.id
    WHERE f.kind IN ('production','pronunciation')
    GROUP BY i.lemma
    HAVING MIN(f.stability) >= ${masteryStability}
       AND COUNT(*) FILTER (WHERE f.kind IN ('production','pronunciation')) = 2
  `;
  return rows.map((r) => r.lemma as string);
}

// --------------------------------------------------------------------------
// Fel-loggen (för tema + /svaga)
// --------------------------------------------------------------------------

export async function logError(category: string, utterance: string, correction: string, uttalstipsSv?: string | null) {
  await getSql()`
    INSERT INTO fr_errors (category, utterance, correction, uttalstips_sv)
    VALUES (${category}, ${utterance}, ${correction}, ${uttalstipsSv ?? null})
  `;
}

/** Vanligaste felkategorierna de senaste N dagarna (för veckans tema + /svaga). */
export async function getTopErrorCategories(days = 7, limit = 5) {
  const sql = getSql();
  const rows = await sql`
    SELECT category, COUNT(*)::int AS count, MAX(correction) AS sample
    FROM fr_errors
    WHERE created_at >= now() - (${days} || ' days')::interval
    GROUP BY category
    ORDER BY count DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({ category: r.category as string, count: r.count as number, sample: r.sample as string }));
}

// --------------------------------------------------------------------------
// Lektioner / prov
// --------------------------------------------------------------------------

export async function createLesson(
  type: LessonType,
  date: string,
  theme: string | null,
  facetIds: string[],
  payload: Record<string, unknown> | null
): Promise<string> {
  const sql = getSql();
  const rows = await sql`
    INSERT INTO fr_lessons (type, date, theme, facet_ids, payload, status)
    VALUES (${type}, ${date}, ${theme}, ${facetIds}, ${payload ? sql.json(payload as never) : null}, 'sent')
    RETURNING id
  `;
  return rows[0].id as string;
}

export async function getLesson(id: string): Promise<FrenchLesson | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM fr_lessons WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;
  return rowToLesson(rows[0]);
}

export async function setLessonStatus(id: string, status: LessonStatus) {
  await getSql()`UPDATE fr_lessons SET status = ${status} WHERE id = ${id}`;
}

export async function setLessonPayload(id: string, payload: Record<string, unknown>) {
  const sql = getSql();
  await sql`UPDATE fr_lessons SET payload = ${sql.json(payload as never)} WHERE id = ${id}`;
}

export async function hasLessonForDate(type: LessonType, date: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`SELECT 1 FROM fr_lessons WHERE type = ${type} AND date = ${date} LIMIT 1`;
  return rows.length > 0;
}

export async function recordQuizResult(lessonId: string, score: number, total: number, mastered: string[]) {
  const sql = getSql();
  await sql`
    INSERT INTO fr_quiz_results (lesson_id, score, total, mastered)
    VALUES (${lessonId}, ${score}, ${total}, ${sql.json(mastered)})
  `;
}

export async function getQuizHistory(limit = 5) {
  const sql = getSql();
  const rows = await sql`
    SELECT score, total, mastered, created_at AS "createdAt"
    FROM fr_quiz_results ORDER BY created_at DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    score: r.score as number,
    total: r.total as number,
    mastered: (r.mastered as string[]) ?? [],
    createdAt: r.createdAt as string
  }));
}

// --------------------------------------------------------------------------
// State (enradig)
// --------------------------------------------------------------------------

export async function getState(): Promise<FrenchState> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM fr_state WHERE id = 1 LIMIT 1`;
  const r = rows[0];
  return {
    mode: (r.mode as Mode) ?? "study",
    chatActive: Boolean(r.chat_active),
    activeLessonId: (r.active_lesson_id as string) ?? null,
    activeQuizId: (r.active_quiz_id as string) ?? null,
    streak: (r.streak as number) ?? 0,
    lastLessonDate: r.last_lesson_date ? String(r.last_lesson_date).slice(0, 10) : null
  };
}

export async function updateState(patch: Partial<{
  mode: Mode;
  chatActive: boolean;
  activeLessonId: string | null;
  activeQuizId: string | null;
  streak: number;
  lastLessonDate: string | null;
}>) {
  const sql = getSql();
  // Bygg en dynamisk uppdatering — bara fält som finns i patch rörs.
  const sets: ReturnType<typeof sql>[] = [];
  if (patch.mode !== undefined) sets.push(sql`mode = ${patch.mode}`);
  if (patch.chatActive !== undefined) sets.push(sql`chat_active = ${patch.chatActive}`);
  if (patch.activeLessonId !== undefined) sets.push(sql`active_lesson_id = ${patch.activeLessonId}`);
  if (patch.activeQuizId !== undefined) sets.push(sql`active_quiz_id = ${patch.activeQuizId}`);
  if (patch.streak !== undefined) sets.push(sql`streak = ${patch.streak}`);
  if (patch.lastLessonDate !== undefined) sets.push(sql`last_lesson_date = ${patch.lastLessonDate}`);
  if (sets.length === 0) return;

  let assignment = sets[0];
  for (let i = 1; i < sets.length; i++) assignment = sql`${assignment}, ${sets[i]}`;
  await sql`UPDATE fr_state SET ${assignment}, updated_at = now() WHERE id = 1`;
}

// --------------------------------------------------------------------------
// Row-mappers
// --------------------------------------------------------------------------

function rowToItem(r: Record<string, unknown>): FrenchItem {
  return { id: r.id as string, type: r.type as ItemType, lemma: r.lemma as string, meta: r.meta as ItemMeta };
}

function rowToFacet(r: Record<string, unknown>): FrenchFacet {
  const card: Card = {
    due: new Date(r.due as string),
    stability: Number(r.stability),
    difficulty: Number(r.difficulty),
    elapsed_days: Number(r.elapsed_days),
    scheduled_days: Number(r.scheduled_days),
    reps: Number(r.reps),
    lapses: Number(r.lapses),
    learning_steps: Number(r.learning_steps),
    state: Number(r.state),
    last_review: r.last_review ? new Date(r.last_review as string) : undefined
  };
  return { id: r.id as string, itemId: r.item_id as string, kind: r.kind as FacetKind, card };
}

function rowToLesson(r: Record<string, unknown>): FrenchLesson {
  return {
    id: r.id as string,
    type: r.type as LessonType,
    date: String(r.date).slice(0, 10),
    theme: (r.theme as string) ?? null,
    facetIds: (r.facet_ids as string[]) ?? [],
    status: r.status as LessonStatus,
    payload: (r.payload as Record<string, unknown>) ?? null
  };
}
