"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, USER_ID } from "@/db";
import { gripState, type Grip } from "@/db/schema";

/** Flippar push- eller pull-greppet och sparar det (bestående rotation). */
export async function toggleGrip(which: "push" | "pull"): Promise<Grip> {
  const rows = await db.select().from(gripState).where(eq(gripState.userId, USER_ID));
  const current = rows[0] ?? { userId: USER_ID, push: "bred" as Grip, pull: "bred" as Grip };
  const next: Grip = current[which] === "bred" ? "smal" : "bred";

  await db
    .insert(gripState)
    .values({ userId: USER_ID, push: current.push, pull: current.pull, [which]: next })
    .onConflictDoUpdate({
      target: gripState.userId,
      set: which === "push" ? { push: next } : { pull: next },
    });

  revalidatePath("/pass");
  return next;
}
