import { eq } from "drizzle-orm";
import { PageHeader } from "@/components/PageHeader";
import { db, USER_ID } from "@/db";
import { campaignProgress } from "@/db/schema";
import { TIERS } from "@/db/seed-content";
import { CampaignItem } from "@/components/CampaignItem";

export const dynamic = "force-dynamic";

export default async function KampanjPage() {
  const progressRows = await db
    .select()
    .from(campaignProgress)
    .where(eq(campaignProgress.userId, USER_ID));

  const cleared = new Set(progressRows.filter((row) => row.cleared).map((row) => row.itemId));
  const totalItems = TIERS.reduce((sum, item) => sum + item.weeks.length + 1, 0);
  const clearedItems = cleared.size;
  const activeLabel = getActiveLabel(cleared);

  let previousBossCleared = true;

  return (
    <main>
      <PageHeader eyebrow="Världskarta" title="Kampanj">
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Rensat" value={`${clearedItems}/${totalItems}`} />
          <Stat label="Tiers" value={String(TIERS.length)} />
          <Stat label="Aktivt" value={activeLabel} />
        </div>
      </PageHeader>

      <section className="space-y-5 px-4">
        {TIERS.map((item) => {
          const unlocked = previousBossCleared;
          const allWeeksCleared = item.weeks.every((week) => cleared.has(week.id));
          const bossCleared = cleared.has(item.endboss.id);
          const firstOpenWeek = item.weeks.find((week) => !cleared.has(week.id));
          const activeWeekId = unlocked ? firstOpenWeek?.id : undefined;
          const bossUnlocked = unlocked && allWeeksCleared;
          const completedCount = item.weeks.filter((week) => cleared.has(week.id)).length + (bossCleared ? 1 : 0);
          const totalCount = item.weeks.length + 1;
          const percent = Math.round((completedCount / totalCount) * 100);

          const rendered = (
            <article key={item.id} className={`card overflow-hidden transition-all duration-300 ${
              unlocked 
                ? "border-line shadow-sm" 
                : "opacity-55 border-line/40 shadow-none bg-surface/50"
            }`}>
              <div className="border-b border-line/60 px-4 py-4 bg-surface2/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow">Tier {item.idx}</p>
                    <h2 className="mt-1 text-lg font-black text-text">{item.name}</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{item.theme}</p>
                  </div>
                  <p
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider ${
                      bossCleared
                        ? "bg-green text-white"
                        : unlocked
                          ? "bg-ember text-white"
                          : "border border-line text-faint bg-bg"
                    }`}
                  >
                    {bossCleared ? "klar" : unlocked ? "öppen" : "låst"}
                  </p>
                </div>

                {/* Progress Bar */}
                {unlocked && (
                  <div className="mt-3.5">
                    <div className="flex justify-between items-center text-[10px] font-bold text-muted mb-1">
                      <span>Framsteg i nivån</span>
                      <span className="font-mono text-text">{percent}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-line/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-ember to-green transition-all duration-500 ease-out"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Vertical Timeline container */}
              <div className="relative py-2">
                {unlocked && (
                  <div className="absolute left-[29px] top-4 bottom-4 w-0.5 bg-line/60 pointer-events-none" />
                )}
                {item.weeks.map((week) => {
                  const done = cleared.has(week.id);
                  const active = week.id === activeWeekId;
                  const previousWeeksDone = item.weeks
                    .slice(0, week.idx - 1)
                    .every((prev) => cleared.has(prev.id));
                  const available = unlocked && (done || active || previousWeeksDone);
                  return (
                    <CampaignItem
                      key={week.id}
                      id={week.id}
                      title={week.boss}
                      label={`Vecka ${week.idx}`}
                      body={week.focus}
                      criteria={[week.criteria]}
                      done={done}
                      active={active}
                      available={available}
                    />
                  );
                })}

                <CampaignItem
                  id={item.endboss.id}
                  title={item.endboss.name}
                  label="End boss"
                  body="Besegra slutbossen för att låsa upp nästa Tier!"
                  criteria={item.endboss.criteria}
                  done={bossCleared}
                  active={bossUnlocked && !bossCleared}
                  available={bossUnlocked || bossCleared}
                  isBoss={true}
                />
              </div>
            </article>
          );

          previousBossCleared = bossCleared;
          return rendered;
        })}
      </section>
    </main>
  );
}

function getActiveLabel(cleared: Set<string>) {
  let previousBossCleared = true;
  for (const item of TIERS) {
    if (!previousBossCleared) break;
    const firstOpenWeek = item.weeks.find((week) => !cleared.has(week.id));
    if (firstOpenWeek) return firstOpenWeek.boss;
    if (!cleared.has(item.endboss.id)) return item.endboss.name;
    previousBossCleared = true;
  }
  return "Alla klara";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
      <p className="truncate text-sm font-black text-text">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-eyebrow text-faint">{label}</p>
    </div>
  );
}
