import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";
import { db, USER_ID } from "@/db";
import { entry, session } from "@/db/schema";
import { EXERCISES } from "@/lib/exercises";
import { addLogEntry, deleteLogEntry } from "./actions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  date: string;
  name: string;
  mode: "reps" | "hold";
  sets: number[];
  weight?: number | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatSets(row: Row) {
  const suffix = row.mode === "hold" ? "s" : "";
  const base = row.sets.map((set) => `${set}${suffix}`).join(" / ");
  return row.weight ? `${base} (+${row.weight}kg)` : base;
}

function total(row: Row) {
  return row.sets.reduce((sum, value) => sum + value, 0);
}

function bestSet(row: Row) {
  return Math.max(...row.sets);
}

function groupByDate(rows: Row[]) {
  const groups: { date: string; rows: Row[] }[] = [];
  for (const row of rows) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== row.date) {
      group = { date: row.date, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

export default async function LoggPage({
  searchParams,
}: {
  searchParams?: Promise<{ exercise?: string }>;
}) {
  const params = await searchParams;
  const requestedExercise = params?.exercise ? decodeURIComponent(params.exercise) : "Pull-ups";
  const defaultExercise = EXERCISES.some((exercise) => exercise.name === requestedExercise)
    ? requestedExercise
    : "Pull-ups";

  const rows = (await db
    .select({
      id: entry.id,
      date: session.date,
      name: entry.name,
      mode: entry.mode,
      sets: entry.sets,
      weight: entry.weight,
    })
    .from(entry)
    .innerJoin(session, eq(entry.sessionId, session.id))
    .where(eq(session.userId, USER_ID))
    .orderBy(desc(session.date))) as Row[];

  const sessions = groupByDate(rows);
  const loggedSets = rows.reduce((sum, row) => sum + row.sets.length, 0);
  const loggedVolume = rows.reduce((sum, row) => sum + total(row), 0);

  return (
    <main>
      <PageHeader eyebrow="Träningsdagbok" title="Logg">
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Pass" value={sessions.length} />
          <Stat label="Rader" value={rows.length} />
          <Stat label="Set" value={loggedSets} />
        </div>
      </PageHeader>

      <section className="px-4">
        {params?.exercise && (
          <div className="mb-3 rounded-card border border-ember/20 bg-surface px-4 py-3 text-sm text-muted shadow-sm">
            <span className="font-black text-ember">Nivåkoppling:</span> loggar försök för{" "}
            <span className="font-black text-text">{defaultExercise}</span>.
          </div>
        )}
        <form action={addLogEntry} className="card space-y-3 p-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <label className="block">
              <span className="eyebrow">Datum</span>
              <input
                name="date"
                type="date"
                defaultValue={todayIso()}
                className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-sm font-bold text-text"
              />
            </label>
            <div className="min-w-20">
              <span className="eyebrow">Volym</span>
              <p className="tnum mt-2 text-right text-lg font-black text-gold">{loggedVolume}</p>
            </div>
          </div>

          <label className="block">
            <span className="eyebrow">Övning</span>
            <select
              name="name"
              defaultValue={defaultExercise}
              className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-sm font-bold text-text"
            >
              {EXERCISES.map((exercise) => (
                <option key={exercise.name} value={exercise.name}>
                  {exercise.group} · {exercise.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="eyebrow">Set</span>
            <input
              name="sets"
              inputMode="numeric"
              placeholder="Ex: 5 5 4 eller 30 25 20"
              className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-sm font-bold text-text placeholder:text-faint"
            />
          </label>

          <label className="block">
            <span className="eyebrow">Viktväst / Extravikt (kg)</span>
            <input
              name="weight"
              type="number"
              min="0"
              placeholder="0 (kroppsvikt)"
              className="mt-1 w-full rounded-[10px] border border-line bg-bg px-3 py-2 text-sm font-bold text-text placeholder:text-faint"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-[10px] bg-ember px-4 py-3 text-sm font-black text-white shadow-sm transition-colors hover:bg-gold"
          >
            Spara rad
          </button>
        </form>
      </section>

      <section className="mt-5 px-4">
        <p className="eyebrow mb-2">Historik</p>
        {sessions.length === 0 ? (
          <div className="card p-4 text-sm leading-relaxed text-muted">
            Inga pass loggade än. Börja med dagens viktigaste övning och skriv seten som siffror.
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((day) => (
              <div key={day.date} className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <p className="font-black text-text">{day.date}</p>
                  <p className="tnum text-xs font-bold text-muted">
                    {day.rows.length} rader · {day.rows.reduce((sum, row) => sum + row.sets.length, 0)} set
                  </p>
                </div>
                <div className="divide-y divide-line">
                  {day.rows.map((row) => (
                    <div key={row.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-text">{row.name}</p>
                        <p className="tnum mt-0.5 text-sm text-muted">{formatSets(row)}</p>
                        <p className="tnum mt-1 text-xs text-faint">
                          Bästa {bestSet(row)}
                          {row.mode === "hold" ? "s" : ""} · total {total(row)}
                          {row.mode === "hold" ? "s" : " reps"}
                        </p>
                      </div>
                      <form action={deleteLogEntry}>
                        <input type="hidden" name="id" value={row.id} />
                        <button
                          type="submit"
                          className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-black text-muted hover:border-ember hover:text-ember"
                        >
                          Ta bort
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
