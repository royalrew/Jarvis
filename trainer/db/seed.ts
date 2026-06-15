import { config as loadEnv } from "dotenv";
loadEnv({ path: "../.env" });
loadEnv({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { TIERS, TRACKS } from "./seed-content";
import { levelGuide } from "../lib/level-guides";

const USER_ID = "me";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas");

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema });

  console.log("🌱 Seedar databasen…");

  // Användare (single-user MVP)
  await db.insert(schema.user).values({ id: USER_ID }).onConflictDoNothing();

  // Grepp-rotation
  await db
    .insert(schema.gripState)
    .values({ userId: USER_ID, push: "bred", pull: "bred" })
    .onConflictDoNothing();

  // Rensa config-tabeller så re-seed är idempotent (cascade tar nivåer/veckor/
  // end bosses + ev. progress kopplad till borttagna tracks/tiers).
  await db.delete(schema.track);
  await db.delete(schema.tier);

  // Tracks + nivåer
  for (const [i, t] of TRACKS.entries()) {
    await db
      .insert(schema.track)
      .values({ id: t.id, name: t.name, goalLabel: t.goalLabel, sortIdx: i });
    for (const lvl of t.levels) {
      const guide = levelGuide(t.id, lvl.idx);
      await db.insert(schema.trackLevel).values({
        id: `${t.id}-${lvl.idx}`,
        trackId: t.id,
        idx: lvl.idx,
        name: lvl.name,
        target: lvl.target,
        elite: lvl.elite ?? false,
        plain: guide?.plain ?? null,
        how: guide?.how ?? null,
        regression: guide?.regression ?? null,
        cue: guide?.cue ?? null,
        ready: guide?.ready ?? null,
      });
    }
    await db
      .insert(schema.trackProgress)
      .values({ userId: USER_ID, trackId: t.id, reached: 0 })
      .onConflictDoNothing();
  }

  // Tiers + veckor + end bosses
  for (const ti of TIERS) {
    await db
      .insert(schema.tier)
      .values({ id: ti.id, idx: ti.idx, name: ti.name, theme: ti.theme });
    for (const w of ti.weeks) {
      await db.insert(schema.tierWeek).values({
        id: w.id,
        tierId: ti.id,
        idx: w.idx,
        boss: w.boss,
        focus: w.focus,
        criteria: w.criteria,
      });
    }
    await db.insert(schema.tierEndboss).values({
      id: ti.endboss.id,
      tierId: ti.id,
      name: ti.endboss.name,
      criteria: ti.endboss.criteria,
    });
  }

  console.log("✅ Klar.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
