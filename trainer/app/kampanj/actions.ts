"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, USER_ID } from "@/db";
import { campaignProgress, user } from "@/db/schema";

async function ensureUser() {
  await db.insert(user).values({ id: USER_ID }).onConflictDoNothing();
}

export async function setCampaignCleared(formData: FormData) {
  await ensureUser();

  const itemId = String(formData.get("itemId") || "");
  const cleared = String(formData.get("cleared") || "") === "true";
  if (!itemId) return;

  await db
    .insert(campaignProgress)
    .values({ userId: USER_ID, itemId, cleared })
    .onConflictDoUpdate({
      target: [campaignProgress.userId, campaignProgress.itemId],
      set: { cleared },
    });

  revalidatePath("/kampanj");
}

export async function clearCampaignItem(formData: FormData) {
  const itemId = String(formData.get("itemId") || "");
  if (!itemId) return;

  await db
    .delete(campaignProgress)
    .where(and(eq(campaignProgress.userId, USER_ID), eq(campaignProgress.itemId, itemId)));

  revalidatePath("/kampanj");
}
