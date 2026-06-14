"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, USER_ID } from "@/db";
import { trackProgress, user } from "@/db/schema";

async function ensureUser() {
  await db.insert(user).values({ id: USER_ID }).onConflictDoNothing();
}

export async function setTrackReached(formData: FormData) {
  await ensureUser();

  const trackId = String(formData.get("trackId") || "");
  const reached = Number.parseInt(String(formData.get("reached") || "0"), 10);
  if (!trackId || !Number.isFinite(reached)) return;

  await db
    .insert(trackProgress)
    .values({ userId: USER_ID, trackId, reached: Math.max(0, reached) })
    .onConflictDoUpdate({
      target: [trackProgress.userId, trackProgress.trackId],
      set: { reached: Math.max(0, reached) },
    });

  revalidatePath("/nivaer");
}

export async function resetTrack(formData: FormData) {
  const trackId = String(formData.get("trackId") || "");
  if (!trackId) return;

  await db
    .update(trackProgress)
    .set({ reached: 0 })
    .where(and(eq(trackProgress.userId, USER_ID), eq(trackProgress.trackId, trackId)));

  revalidatePath("/nivaer");
}
