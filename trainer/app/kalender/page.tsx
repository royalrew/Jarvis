import { asc, gte } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";
import { db } from "@/db";
import { calendarEvent } from "@/db/schema";
import { addCalendarEntry, deleteCalendarEntry } from "./actions";

export const dynamic = "force-dynamic";

type LocalEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  notes: string | null;
  source: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function defaultStartTime() {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return now.toTimeString().slice(0, 5);
}

function formatDateHeading(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatEventTime(event: LocalEvent) {
  const start = new Date(event.startsAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (!event.endsAt) return start;
  const end = new Date(event.endsAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return `${start}-${end}`;
}

function groupByDate(rows: LocalEvent[]) {
  const groups: { date: string; rows: LocalEvent[] }[] = [];
  for (const row of rows) {
    const dateKey = new Date(row.startsAt).toISOString().slice(0, 10);
    let group = groups.find(g => g.date === dateKey);
    if (!group) {
      group = { date: dateKey, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups.sort((a, b) => a.date.localeCompare(b.date));
}

export default async function KalenderPage() {
  const startLimit = new Date();
  startLimit.setHours(0, 0, 0, 0);

  const rows = (await db
    .select()
    .from(calendarEvent)
    .where(gte(calendarEvent.startsAt, startLimit.toISOString()))
    .orderBy(asc(calendarEvent.startsAt))) as LocalEvent[];

  const sessions = groupByDate(rows);

  return (
    <main>
      <PageHeader eyebrow="Planering" title="Kalender">
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Kommande händelser" value={rows.length} />
          <Stat label="Dagar planerade" value={sessions.length} />
        </div>
      </PageHeader>

      <section className="px-4">
        <form action={addCalendarEntry} className="card space-y-3 p-4">
          <label className="block">
            <span className="eyebrow">Titel</span>
            <input
              name="title"
              required
              placeholder="Ex: Träna med Jimmy"
              className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-sm font-bold text-text placeholder:text-faint"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="eyebrow">Datum</span>
              <input
                name="date"
                type="date"
                defaultValue={todayIso()}
                className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-xs font-bold text-text"
              />
            </label>

            <label className="block">
              <span className="eyebrow">Start</span>
              <input
                name="start"
                type="time"
                defaultValue={defaultStartTime()}
                className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-xs font-bold text-text"
              />
            </label>

            <label className="block">
              <span className="eyebrow">Slut</span>
              <input
                name="end"
                type="time"
                className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-xs font-bold text-text"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="eyebrow">Plats</span>
              <input
                name="location"
                placeholder="Valfritt"
                className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-xs font-bold text-text placeholder:text-faint"
              />
            </label>

            <label className="block">
              <span className="eyebrow">Notering</span>
              <input
                name="notes"
                placeholder="Valfritt"
                className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-xs font-bold text-text placeholder:text-faint"
              />
            </label>
          </div>

          <button
            type="submit"
            className="w-full rounded-[10px] bg-ember px-4 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-gold"
          >
            Boka händelse
          </button>
        </form>
      </section>

      <section className="mt-5 px-4">
        <p className="eyebrow mb-2">Schema</p>
        {sessions.length === 0 ? (
          <div className="card p-4 text-sm leading-relaxed text-muted text-center">
            Inga kalenderhändelser planerade.
          </div>
        ) : (
          <div className="space-y-4">
            {sessions.map((day) => (
              <div key={day.date} className="border-l-2 border-ember/30 pl-4 ml-2">
                <p className="font-black text-ember text-sm uppercase tracking-wide mb-2">
                  {formatDateHeading(day.date)}
                </p>
                <div className="space-y-2">
                  {day.rows.map((row) => (
                    <div key={row.id} className="card grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-3">
                      <div className="text-xs font-black text-gold font-mono bg-surface2 px-2 py-1 rounded">
                        {formatEventTime(row)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-bold text-text">{row.title}</p>
                        {(row.location || row.notes) && (
                          <p className="truncate text-xs text-muted mt-0.5">
                            {[row.location, row.notes].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        <span className="inline-block mt-1 text-[9px] font-black uppercase text-faint bg-surface px-1.5 py-0.5 rounded">
                          {row.source === "jarvis" ? "Jarvis" : "Manuell"}
                        </span>
                      </div>
                      <form action={deleteCalendarEntry}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          className="rounded-[8px] border border-line px-2.5 py-1 text-xs font-black text-muted hover:border-ember hover:text-white hover:bg-ember/10"
                        >
                          ×
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
      <p className="tnum text-lg font-black text-text">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-eyebrow text-faint">{label}</p>
    </div>
  );
}
