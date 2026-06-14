import postgres from "postgres";
import crypto from "node:crypto";

let sql: ReturnType<typeof postgres> | null = null;

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas i .env.");
  sql ??= postgres(url, { max: 3 });
  return sql;
}

export async function addCalendarEvent(input: {
  title: string;
  startsAt: string;
  endsAt?: string | null;
  location?: string | null;
  notes?: string | null;
  source?: string;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db()`
    insert into calendar_event (id, title, starts_at, ends_at, location, notes, source)
    values (${id}, ${input.title}, ${input.startsAt}, ${input.endsAt ?? null}, ${input.location ?? null}, ${input.notes ?? null}, ${input.source ?? "manual"})
  `;
  return id;
}

export async function getCalendarEvents(rangeStart?: string, rangeEnd?: string): Promise<any[]> {
  if (rangeStart && rangeEnd) {
    return db()`
      select id, title, starts_at as "startsAt", ends_at as "endsAt", location, notes, source, created_at as "createdAt", updated_at as "updatedAt"
      from calendar_event
      where coalesce(ends_at, starts_at) >= ${rangeStart} and starts_at < ${rangeEnd}
      order by starts_at asc
    `;
  }
  return db()`
    select id, title, starts_at as "startsAt", ends_at as "endsAt", location, notes, source, created_at as "createdAt", updated_at as "updatedAt"
    from calendar_event
    order by starts_at asc
    limit 100
  `;
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  await db()`delete from calendar_event where id = ${id}`;
}

export async function updateCalendarEvent(id: string, updates: any): Promise<void> {
  const allowedFields = ["title", "startsAt", "endsAt", "location", "notes"];
  const dbFields: Record<string, string> = {
    title: "title",
    startsAt: "starts_at",
    endsAt: "ends_at",
    location: "location",
    notes: "notes"
  };

  const payload: any = {};
  for (const key of Object.keys(updates)) {
    if (allowedFields.includes(key) && updates[key] !== undefined) {
      payload[dbFields[key]] = updates[key];
    }
  }

  if (Object.keys(payload).length === 0) return;

  const sql = db();
  await sql`
    update calendar_event
    set ${sql(payload)}, updated_at = now()
    where id = ${id}
  `;
}
