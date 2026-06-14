import { eq } from "drizzle-orm";
import Link from "next/link";
import { CoachingTips } from "@/components/CoachingTips";
import { PageHeader } from "@/components/PageHeader";
import { isTrackAvailable } from "@/lib/equipment";
import { db, USER_ID } from "@/db";
import { trackProgress } from "@/db/schema";
import { TRACKS } from "@/db/seed-content";
import { loggHrefForLevel } from "@/lib/level-integration";
import { levelGuide } from "@/lib/level-guides";
import { resetTrack, setTrackReached } from "./actions";

export const dynamic = "force-dynamic";

const TRACK_META: Record<
  string,
  { mark: string; note: string; priority: number; accent: string }
> = {
  hand: {
    mark: "HS",
    note: "Balans, axelkontroll och press upp och ner.",
    priority: 3,
    accent: "from-blue-50 to-white",
  },
  drag: {
    mark: "DR",
    note: "Din rena dragstyrka. Basen för muscle-up och enarmsdrag.",
    priority: 1,
    accent: "from-cyan-50 to-white",
  },
  front: {
    mark: "FL",
    note: "Raka armar, lats och bål i en lång linje.",
    priority: 4,
    accent: "from-indigo-50 to-white",
  },
  planche: {
    mark: "PL",
    note: "Rakarmsstyrka och framåtlutad press.",
    priority: 6,
    accent: "from-sky-50 to-white",
  },
  flag: {
    mark: "FG",
    note: "Sidobål, skuldror och tryck/dra mot stolpe.",
    priority: 5,
    accent: "from-teal-50 to-white",
  },
  core: {
    mark: "BÅ",
    note: "Bålen som håller allt annat på plats.",
    priority: 2,
    accent: "from-emerald-50 to-white",
  },
  mu: {
    mark: "MU",
    note: "Explosivt drag och övergången över stången.",
    priority: 7,
    accent: "from-violet-50 to-white",
  },
  rings: {
    mark: "RG",
    note: "Stabilitet i ringar, dips och långsiktig elitstyrka.",
    priority: 8,
    accent: "from-slate-50 to-white",
  },
};

export default async function NivaerPage() {
  const progressRows = await db
    .select({
      trackId: trackProgress.trackId,
      reached: trackProgress.reached,
    })
    .from(trackProgress)
    .where(eq(trackProgress.userId, USER_ID));
  const reachedByTrack = new Map(progressRows.map((row) => [row.trackId, row.reached]));
  const tracks = TRACKS.filter((item) => isTrackAvailable(item.id));

  const totalLevels = tracks.reduce((sum, item) => sum + item.levels.length, 0);
  const clearedLevels = tracks.reduce(
    (sum, item) => sum + Math.min(reachedByTrack.get(item.id) ?? 0, item.levels.length),
    0,
  );
  const strongest = [...tracks].sort(
    (a, b) => (reachedByTrack.get(b.id) ?? 0) - (reachedByTrack.get(a.id) ?? 0),
  )[0];
  const focus = [...tracks]
    .filter((item) => (reachedByTrack.get(item.id) ?? 0) < item.levels.length)
    .sort((a, b) => {
      const aReached = reachedByTrack.get(a.id) ?? 0;
      const bReached = reachedByTrack.get(b.id) ?? 0;
      if (aReached !== bReached) return bReached - aReached;
      return (TRACK_META[a.id]?.priority ?? 99) - (TRACK_META[b.id]?.priority ?? 99);
    })[0];
  const focusReached = focus ? reachedByTrack.get(focus.id) ?? 0 : 0;
  const focusNext = focus?.levels.find((level) => level.idx === focusReached + 1);
  const focusGuide = focus && focusNext ? levelGuide(focus.id, focusNext.idx) : null;

  return (
    <main>
      <PageHeader eyebrow="Skill tree" title="Nivåer">
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Klarat" value={`${clearedLevels}/${totalLevels}`} />
          <Stat label="Spår" value={String(tracks.length)} />
          <Stat
            label="Starkast"
            value={strongest && (reachedByTrack.get(strongest.id) ?? 0) > 0 ? strongest.name : "Start"}
          />
        </div>
      </PageHeader>

      {focus && focusNext && (
        <section className="px-4 pb-4">
          <div className="rounded-card border border-ember/20 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <TrackMark id={focus.id} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-eyebrow text-ember">
                  Nästa bästa steg
                </p>
                <h2 className="mt-1 text-lg font-black leading-tight text-text">
                  {focusGuide?.plain ?? focusNext.name}
                </h2>
                <p className="mt-1 text-sm font-bold text-muted">
                  {focus.name} · nivå {focusNext.idx} av {focus.levels.length} · test {focusNext.target}
                </p>
                {focusGuide && (
                  <p className="mt-2 text-sm leading-relaxed text-muted">{focusGuide.how}</p>
                )}
                <CoachingTips guide={focusGuide} className="mt-3" />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    href={loggHrefForLevel(focus.id, focusNext.idx)}
                    className="rounded-[10px] bg-ember px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-gold"
                  >
                    Logga försök
                  </Link>
                  <Link
                    href="/pass"
                    className="rounded-[10px] border border-line px-3 py-2 text-xs font-black text-muted hover:border-ember hover:text-ember"
                  >
                    Öppna pass
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-4 px-4">
        {tracks.map((item) => {
          const meta = TRACK_META[item.id];
          const reached = Math.min(reachedByTrack.get(item.id) ?? 0, item.levels.length);
          const next = item.levels.find((level) => level.idx === reached + 1);
          const nextGuide = next ? levelGuide(item.id, next.idx) : null;
          const pct = item.levels.length === 0 ? 0 : Math.round((reached / item.levels.length) * 100);

          return (
            <article key={item.id} className="card overflow-hidden">
              <div className={`border-b border-line bg-gradient-to-br ${meta?.accent ?? "from-surface to-surface"} px-4 py-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <TrackMark id={item.id} />
                    <div className="min-w-0">
                      <p className="font-black text-text">{item.name}</p>
                      <p className="mt-0.5 text-sm text-muted">{meta?.note ?? item.goalLabel}</p>
                      <p className="mt-1 text-xs font-bold text-faint">Mål: {item.goalLabel}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tnum text-sm font-black text-gold">{pct}%</p>
                    <p className="tnum text-[10px] font-bold uppercase tracking-eyebrow text-faint">
                      {reached}/{item.levels.length}
                    </p>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-ember" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-2 text-xs text-faint">
                  {next
                    ? `Nästa test: ${nextGuide?.plain ?? next.name} · ${next.target}`
                    : "Spåret är helt klart."}
                </p>
                <div className="mt-3 flex gap-2">
                  {reached > 0 && (
                    <form action={setTrackReached}>
                      <input type="hidden" name="trackId" value={item.id} />
                      <input type="hidden" name="reached" value={reached - 1} />
                      <button
                        type="submit"
                        className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-black text-muted hover:border-ember hover:text-ember"
                      >
                        Backa
                      </button>
                    </form>
                  )}
                  {reached < item.levels.length && (
                    <form action={setTrackReached}>
                      <input type="hidden" name="trackId" value={item.id} />
                      <input type="hidden" name="reached" value={reached + 1} />
                      <button
                        type="submit"
                        className="rounded-[10px] bg-ember px-3 py-1.5 text-xs font-black text-white shadow-sm hover:bg-gold"
                      >
                        Markera nästa
                      </button>
                    </form>
                  )}
                  {reached > 0 && (
                    <form action={resetTrack}>
                      <input type="hidden" name="trackId" value={item.id} />
                      <button
                        type="submit"
                        className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-black text-faint hover:text-ember"
                      >
                        Nollställ
                      </button>
                    </form>
                  )}
                </div>
              </div>

              <div className="divide-y divide-line">
                {item.levels.map((level) => {
                  const done = level.idx <= reached;
                  const active = level.idx === reached + 1;
                  const guide = levelGuide(item.id, level.idx);
                  return (
                    <div
                      key={`${item.id}-${level.idx}`}
                      className={`grid grid-cols-[auto_1fr_auto] items-start gap-3 px-4 py-3 ${
                        active ? "border-l-4 border-ember bg-surface2/60 pl-3" : ""
                      }`}
                    >
                      <span
                        className={`tnum flex h-7 w-7 items-center justify-center rounded-full border text-xs font-black ${
                          done
                            ? "border-green bg-green text-white"
                            : active
                              ? "border-ember text-ember"
                              : "border-line text-faint"
                        }`}
                      >
                        {level.idx}
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold text-text">{guide?.plain ?? level.name}</p>
                        <p className="mt-0.5 text-sm font-bold text-muted">
                          Test: {level.target}
                          {level.elite ? " · elitnivå" : ""}
                        </p>
                        {guide && (
                          <p className="mt-1 text-sm leading-relaxed text-muted">
                            {guide.how}
                          </p>
                        )}
                        {level.elite && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs font-black text-gold bg-gold/5 border border-gold/10 rounded-[8px] px-2.5 py-1 w-fit">
                            <span>🏋️‍♂️ Viktväst / extravikt rekommenderas för ökad intensitet!</span>
                          </div>
                        )}
                        {guide?.plain !== level.name && (
                          <p className="mt-1 text-xs text-faint">
                            Intern nivå: {level.name}
                          </p>
                        )}
                        {active && <CoachingTips guide={guide} className="mt-2" />}
                        {active && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Link
                              href={loggHrefForLevel(item.id, level.idx)}
                              className="rounded-[10px] border border-line bg-white px-3 py-1.5 text-xs font-black text-muted hover:border-ember hover:text-ember"
                            >
                              Logga försök
                            </Link>
                            <Link
                              href="/pass"
                              className="rounded-[10px] border border-line bg-white px-3 py-1.5 text-xs font-black text-muted hover:border-ember hover:text-ember"
                            >
                              Träna i pass
                            </Link>
                          </div>
                        )}
                      </div>
                      <p
                        className={`pt-1 text-xs font-black ${
                          done ? "text-green" : active ? "text-ember" : "text-faint"
                        }`}
                      >
                        {done ? "Klar" : active ? "Nästa" : "Låst"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
      <p className="truncate text-sm font-black text-text">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-eyebrow text-faint">{label}</p>
    </div>
  );
}

function TrackMark({ id }: { id: string }) {
  const meta = TRACK_META[id];
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-line bg-white text-xs font-black text-ember shadow-sm">
      {meta?.mark ?? id.slice(0, 2).toUpperCase()}
    </span>
  );
}
