"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { calendarEvent } from "@/db/schema";

export async function addCalendarEntry(formData: FormData) {
  const title = String(formData.get("title") || "").trim();
  const date = String(formData.get("date") || "").trim();
  const start = String(formData.get("start") || "").trim();
  const end = String(formData.get("end") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!title || !date || !start) {
    throw new Error("Titel, datum och starttid krävs.");
  }

  const startsAt = `${date}T${start}:00`;
  const endsAt = end ? `${date}T${end}:00` : null;

  await db.insert(calendarEvent).values({
    id: crypto.randomUUID(),
    title,
    startsAt,
    endsAt,
    location: location || null,
    notes: notes || null,
    source: "manual",
  });

  revalidatePath("/kalender");
}

export async function deleteCalendarEntry(formData: FormData) {
  const id = String(formData.get("id") || "");
  if (!id) return;

  await db.delete(calendarEvent).where(eq(calendarEvent.id, id));
  revalidatePath("/kalender");
}
