import { addCalendarEvent, deleteCalendarEvent, getCalendarEvents, updateCalendarEvent } from "./calendarDb.js";
import { getCalendarSmartAction } from "./llm.js";

export type CalendarEvent = {
  title: string;
  start: Date;
  end?: Date;
  location?: string;
  allDay: boolean;
};

type RawEvent = CalendarEvent & {
  rrule?: string;
};

const MS_DAY = 24 * 60 * 60 * 1000;

export async function getCalendarAgenda(rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]> {
  const urls = getCalendarUrls();
  if (urls.length === 0) {
    throw new Error("JARVIS_CALENDAR_ICS_URL saknas i .env.");
  }

  const calendars = await Promise.all(urls.map(fetchCalendar));
  return calendars
    .flatMap((ics) => expandEvents(parseIcs(ics), rangeStart, rangeEnd))
    .filter((event) => event.end ? event.end > rangeStart && event.start < rangeEnd : event.start >= rangeStart && event.start < rangeEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function getNamedRange(name: "today" | "tomorrow" | "upcoming") {
  const now = new Date();
  const start = startOfDay(now);

  if (name === "tomorrow") {
    const tomorrow = addDays(start, 1);
    return { start: tomorrow, end: addDays(tomorrow, 1), label: "imorgon" };
  }

  if (name === "upcoming") {
    return { start: now, end: addDays(start, 8), label: "kommande 7 dagarna" };
  }

  return { start, end: addDays(start, 1), label: "idag" };
}

export function formatAgenda(events: CalendarEvent[], label: string) {
  if (events.length === 0) {
    return `Kalendern ar tom ${label}.`;
  }

  return [
    `Kalender ${label}:`,
    ...events.slice(0, 12).map(formatEvent),
    events.length > 12 ? `...och ${events.length - 12} till.` : ""
  ].filter(Boolean).join("\n");
}

function getCalendarUrls() {
  const raw = process.env.JARVIS_CALENDAR_ICS_URL || process.env.JARVIS_CALENDAR_ICS_URLS || "";
  return raw.split(",").map((url) => url.trim()).filter(Boolean);
}

async function fetchCalendar(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Kalendern svarade ${response.status}.`);
  }

  return response.text();
}

function parseIcs(ics: string): RawEvent[] {
  const lines = unfoldIcsLines(ics);
  const events: RawEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (current) {
        const event = buildEvent(current);
        if (event) {
          events.push(event);
        }
      }
      current = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).split(";")[0].toUpperCase();
    current[key] = line.slice(index + 1);
  }

  return events;
}

function unfoldIcsLines(ics: string) {
  const rawLines = ics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines: string[] = [];

  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line.trimEnd());
    }
  }

  return lines;
}

function buildEvent(raw: Record<string, string>): RawEvent | null {
  const start = parseIcsDate(raw.DTSTART);
  if (!start) {
    return null;
  }

  const end = parseIcsDate(raw.DTEND);
  return {
    title: unescapeText(raw.SUMMARY || "Utan titel"),
    start: start.date,
    end: end?.date,
    location: raw.LOCATION ? unescapeText(raw.LOCATION) : undefined,
    allDay: start.allDay,
    rrule: raw.RRULE
  };
}

function expandEvents(events: RawEvent[], rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  return events.flatMap((event) => expandEvent(event, rangeStart, rangeEnd));
}

function expandEvent(event: RawEvent, rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  if (!event.rrule) {
    return [event];
  }

  const rule = parseRRule(event.rrule);
  if (!rule.freq || !["DAILY", "WEEKLY", "MONTHLY"].includes(rule.freq)) {
    return [event];
  }

  const interval = Number(rule.interval || "1");
  const maxCount = rule.count ? Number(rule.count) : 500;
  const until = rule.until ? parseIcsDate(rule.until)?.date : undefined;
  const duration = event.end ? event.end.getTime() - event.start.getTime() : 0;
  const expanded: CalendarEvent[] = [];
  let current = new Date(event.start);
  let generated = 0;

  while (generated < maxCount && current < rangeEnd) {
    if (until && current > until) {
      break;
    }

    const occurrenceEnd = duration > 0 ? new Date(current.getTime() + duration) : undefined;
    if (occurrenceEnd ? occurrenceEnd > rangeStart && current < rangeEnd : current >= rangeStart && current < rangeEnd) {
      expanded.push({ ...event, start: new Date(current), end: occurrenceEnd });
    }

    generated += 1;
    current = nextOccurrence(current, rule.freq, Number.isFinite(interval) && interval > 0 ? interval : 1);
  }

  return expanded;
}

function parseRRule(value: string) {
  return Object.fromEntries(
    value.split(";").map((part) => {
      const [key, raw] = part.split("=");
      return [key.toLowerCase(), raw];
    })
  ) as Record<string, string | undefined>;
}

function nextOccurrence(date: Date, freq: string, interval: number) {
  const next = new Date(date);
  if (freq === "DAILY") {
    next.setDate(next.getDate() + interval);
  } else if (freq === "WEEKLY") {
    next.setDate(next.getDate() + interval * 7);
  } else {
    next.setMonth(next.getMonth() + interval);
  }
  return next;
}

function parseIcsDate(value?: string): { date: Date; allDay: boolean } | null {
  if (!value) {
    return null;
  }

  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    return { date: new Date(year, month, day), allDay: true };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) {
    return null;
  }

  const [, yyyy, mm, dd, hh, min, ss, zulu] = match;
  const parts = [yyyy, mm, dd, hh, min, ss].map(Number);
  const date = zulu
    ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]))
    : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);

  return { date, allDay: false };
}

function formatEvent(event: CalendarEvent) {
  const time = event.allDay ? "heldag" : formatTimeRange(event);
  const location = event.location ? ` (${event.location})` : "";
  return `- ${time} ${event.title}${location}`;
}

function formatTimeRange(event: CalendarEvent) {
  const start = event.start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (!event.end) {
    return start;
  }
  const end = event.end.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return `${start}-${end}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_DAY);
}

function unescapeText(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

export async function handleSmartCalendar(input: string): Promise<string> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 45);
  const localEvents = await getCalendarEvents(start.toISOString(), end.toISOString());

  const eventListText = localEvents.length === 0
    ? "Inga kommande händelser i kalendern."
    : localEvents.map(e => {
        const startStr = new Date(e.startsAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
        const endStr = e.endsAt ? new Date(e.endsAt).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" }) : "Ingen sluttid";
        return `- ID #${e.id}: "${e.title}" (${startStr} till ${endStr}) ${e.location ? `Plats: ${e.location}` : ""} ${e.notes ? `Notering: ${e.notes}` : ""}`;
      }).join("\n");

  const currentLocalTime = new Date().toISOString();
  
  const systemPrompt = `
Du är Jarvis, en personlig digital kollega. Din uppgift är att hantera användarens kalenderhändelser.
Användaren kan vilja boka, avboka (ta bort), flytta (uppdatera) eller bara se sina inplanerade möten.

Här är nuvarande datum och tid: ${currentLocalTime} (Observera: om användaren säger "imorgon", "nästa tisdag" osv., utgå från detta datum).
Här är en lista över alla befintliga händelser i den lokala kalendern för de kommande 45 dagarna:
${eventListText}

Analysera användarens meddelande och bestäm vilken åtgärd som ska utföras.
Svara EXKLUSIVT med ett JSON-objekt i följande format:
{
  "action": "add" | "update" | "delete" | "list" | "none",
  "eventId": "string (UUID eller ID från listan)" | null,
  "addEvent": {
    "title": "titel på mötet",
    "startsAt": "ISO datetime string (lokal tid, t.ex. YYYY-MM-DDTHH:MM:SS)",
    "endsAt": "ISO datetime string | null",
    "location": "plats eller null",
    "notes": "notering eller null"
  } | null,
  "updateEvent": {
    "title": "ny titel eller null",
    "startsAt": "ny ISO startsAt string eller null",
    "endsAt": "ny ISO endsAt string eller null",
    "location": "ny plats eller null",
    "notes": "ny notering eller null"
  } | null,
  "explanation": "En mycket kort, trevlig och professionell förklaring på svenska av vad du har gjort eller visar."
}
  `.trim();

  try {
    const result = await getCalendarSmartAction(systemPrompt, input);

    if (result.action === "add" && result.addEvent) {
      const id = await addCalendarEvent({
        title: result.addEvent.title,
        startsAt: result.addEvent.startsAt,
        endsAt: result.addEvent.endsAt,
        location: result.addEvent.location,
        notes: result.addEvent.notes,
        source: "jarvis"
      });
      return `Bokat! Jag lade in **"${result.addEvent.title}"** i din kalender. (Id #${id})`;
    }

    if (result.action === "delete" && result.eventId) {
      await deleteCalendarEvent(result.eventId);
      return `Avbokat! Jag har tagit bort möte #${result.eventId} från kalendern.`;
    }

    if (result.action === "update" && result.eventId && result.updateEvent) {
      const updates: any = {};
      if (result.updateEvent.title !== null) updates.title = result.updateEvent.title;
      if (result.updateEvent.startsAt !== null) updates.startsAt = result.updateEvent.startsAt;
      if (result.updateEvent.endsAt !== null) updates.endsAt = result.updateEvent.endsAt;
      if (result.updateEvent.location !== null) updates.location = result.updateEvent.location;
      if (result.updateEvent.notes !== null) updates.notes = result.updateEvent.notes;

      await updateCalendarEvent(result.eventId, updates);
      return `Uppdaterat! Jag har flyttat/ändrat möte #${result.eventId}.`;
    }

    if (result.action === "list") {
      return result.explanation;
    }
  } catch (error) {
    console.error("[Smart Calendar] Error:", error);
  }

  return "Jag förstod att du ville göra något med kalendern, men jag kunde inte tyda exakt vad. Kan du förtydliga t.ex. tid eller titel?";
}
