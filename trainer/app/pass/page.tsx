import { eq } from "drizzle-orm";
import { db, USER_ID } from "@/db";
import { gripState, trackProgress } from "@/db/schema";
import { TRACKS } from "@/db/seed-content";
import { isTrackAvailable } from "@/lib/equipment";
import { exerciseForLevel } from "@/lib/level-integration";
import { levelGuide } from "@/lib/level-guides";
import { Passmallar } from "./Passmallar";

export const dynamic = "force-dynamic";

const FOUNDATION_TRACKS = new Set(["drag", "core", "hand", "planche", "rings"]);

function isReadyForTrack(trackId: string, reachedByTrack: Map<string, number>) {
  const drag = reachedByTrack.get("drag") ?? 0;
  const core = reachedByTrack.get("core") ?? 0;
  const hand = reachedByTrack.get("hand") ?? 0;
  const planche = reachedByTrack.get("planche") ?? 0;
  const rings = reachedByTrack.get("rings") ?? 0;

  if (FOUNDATION_TRACKS.has(trackId)) return true;
  if (trackId === "front") return drag >= 1 && core >= 1;
  if (trackId === "flag") return drag >= 2 && core >= 2 && hand >= 1;
  if (trackId === "mu") return drag >= 2;
  return true;
}

export default async function PassPage() {
  const [rows, progressRows] = await Promise.all([
    db.select().from(gripState).where(eq(gripState.userId, USER_ID)),
    db
      .select({
        trackId: trackProgress.trackId,
        reached: trackProgress.reached,
      })
      .from(trackProgress)
      .where(eq(trackProgress.userId, USER_ID)),
  ]);
  let grip = rows[0];
  if (!grip) {
    await db.insert(gripState).values({ userId: USER_ID }).onConflictDoNothing();
    grip = { userId: USER_ID, push: "bred", pull: "bred" };
  }

  const reachedByTrack = new Map(progressRows.map((row) => [row.trackId, row.reached]));
  const drag = reachedByTrack.get("drag") ?? 0;
  const core = reachedByTrack.get("core") ?? 0;
  const hand = reachedByTrack.get("hand") ?? 0;
  const goals = TRACKS.flatMap((track) => {
    if (!isTrackAvailable(track.id)) return [];
    if (!isReadyForTrack(track.id, reachedByTrack)) return [];

    const reached = Math.min(reachedByTrack.get(track.id) ?? 0, track.levels.length);
    const next = track.levels.find((level) => level.idx === reached + 1);
    if (!next) return [];
    const guide = levelGuide(track.id, next.idx);
    return [
      {
        id: `${track.id}:${next.idx}`,
        trackId: track.id,
        trackName: track.name,
        levelIdx: next.idx,
        title: guide?.plain ?? next.name,
        target: next.target,
        how: guide?.how ?? "",
        regression: guide?.regression,
        cue: guide?.cue,
        ready: guide?.ready,
        exercise: exerciseForLevel(track.id, next.idx),
        elite: next.elite,
      },
    ];
  });

  return (
    <Passmallar
      push={grip.push}
      pull={grip.pull}
      goals={goals}
      reached={{
        drag,
        core,
        hand,
      }}
    />
  );
}
