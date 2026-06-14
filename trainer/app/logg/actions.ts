"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, USER_ID } from "@/db";
import { entry, session, user } from "@/db/schema";
import { modeFor } from "@/lib/exercises";

function parseSets(raw: FormDataEntryValue | null) {
  const sets = String(raw ?? "")
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (sets.length === 0) {
    throw new Error("Skriv minst ett set, till exempel 5 5 4.");
  }

  return sets;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function ensureUser() {
  await db.insert(user).values({ id: USER_ID }).onConflictDoNothing();
}

export async function addLogEntry(formData: FormData) {
  await ensureUser();

  const date = String(formData.get("date") || todayIso());
  const name = String(formData.get("name") || "").trim();
  if (!name) throw new Error("Välj en övning.");

  const sets = parseSets(formData.get("sets"));
  const mode = modeFor(name);
  const existing = await db
    .select()
    .from(session)
    .where(and(eq(session.userId, USER_ID), eq(session.date, date)))
    .limit(1);

  const sessionId = existing[0]?.id ?? crypto.randomUUID();
  if (!existing[0]) {
    await db.insert(session).values({ id: sessionId, userId: USER_ID, date });
  }

  const weightVal = formData.get("weight");
  const weightParsed = weightVal ? parseInt(String(weightVal), 10) : null;
  const weight = (weightParsed !== null && !isNaN(weightParsed) && weightParsed > 0) ? weightParsed : null;

  await db.insert(entry).values({
    id: crypto.randomUUID(),
    sessionId,
    name,
    mode,
    sets,
    weight,
  });

  revalidatePath("/logg");
}

export async function deleteLogEntry(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;

  await db.delete(entry).where(eq(entry.id, id));
  revalidatePath("/logg");
}
