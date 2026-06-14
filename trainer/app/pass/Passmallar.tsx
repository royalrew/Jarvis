"use client";

import { useOptimistic, useState, useTransition, useEffect } from "react";
import { CoachingTips } from "@/components/CoachingTips";
import { PageHeader } from "@/components/PageHeader";
import type { Grip } from "@/db/schema";
import { exerciseGuide } from "@/lib/exercise-guides";
import { exerciseImagePath } from "@/lib/exercise-visuals";
import { passExerciseCoversLevel } from "@/lib/level-integration";
import {
  GRIPS,
  TEMPLATES,
  WEEKLY_LOGIC,
  groupByBlock,
  type GripKind,
  type TemplateRow,
} from "@/lib/passmallar";
import { toggleGrip } from "./actions";

type Grips = { push: Grip; pull: Grip };
type SkillGoal = {
  id: string;
  trackName: string;
  levelIdx: number;
  title: string;
  target: string;
  how: string;
  regression?: string;
  cue?: string;
  ready?: string;
  exercise: string | null;
  elite?: boolean;
};

export function Passmallar({
  push,
  pull,
  goals,
  reached,
}: Grips & {
  goals: SkillGoal[];
  reached: { drag: number; core: number; hand: number };
}) {
  const [active, setActive] = useState<"hemma" | "utegym">("utegym");
  const [doneByPass, setDoneByPass] = useState<Record<string, Record<string, boolean>>>({});
  const [expandedByPass, setExpandedByPass] = useState<Record<string, Record<string, boolean>>>({});
  const [grips, setOptimistic] = useOptimistic<Grips, Grips>({ push, pull }, (_, next) => next);
  const [pending, startTransition] = useTransition();

  // Rest Timer States
  const [timerLeft, setTimerLeft] = useState<number>(0);
  const [timerDuration, setTimerDuration] = useState<number>(0);
  const [timerRunning, setTimerRunning] = useState<boolean>(false);
  const [timerExercise, setTimerExercise] = useState<string>("");
  const [timerVisible, setTimerVisible] = useState<boolean>(false);
  const [timerSetKey, setTimerSetKey] = useState<string>("");
  const [warmups, setWarmups] = useState<TemplateRow[]>([]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    setWarmups(getWarmupsForDate(today, active === "hemma"));
  }, [active]);

  useEffect(() => {
    if (!timerRunning || !timerVisible || timerLeft <= 0) return;

    const interval = setInterval(() => {
      setTimerLeft((prev) => {
        if (prev <= 1) {
          playTimerEndSound();
          setTimerVisible(false);
          setTimerRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [timerRunning, timerVisible]);

  const template = TEMPLATES[active];

  const dragReached = reached?.drag ?? 0;
  const coreReached = reached?.core ?? 0;
  const handReached = reached?.hand ?? 0;

  const isReadyForFront = dragReached >= 1 && coreReached >= 1;
  const isReadyForFlag = dragReached >= 2 && coreReached >= 2 && handReached >= 1;

  const filteredStatic = template.exercises.filter((row) => {
    if (row.block === "Uppvärmning") return false;
    if (row.name === "Tuck front lever") return isReadyForFront;
    if (row.name === "Flagg-försök (om stolpe finns)") return isReadyForFlag;
    return true;
  });

  const exercises = [...warmups, ...filteredStatic];

  const done = doneByPass[active] ?? {};
  const expanded = expandedByPass[active] ?? {};
  const completed = exercises.filter((row) => isRowDone(row, done)).length;
  const total = exercises.length;
  const progress = Math.round((completed / total) * 100);
  const visibleGoals = goals
    .filter((goal) => exercises.some((row) => passExerciseCoversLevel(row.name, goal.exercise)))
    .slice(0, 3);
  const completedGoals = visibleGoals.filter((goal) =>
    exercises.some((row) => isRowDone(row, done) && passExerciseCoversLevel(row.name, goal.exercise)),
  );

  function toggleDone(row: TemplateRow) {
    const checked = isRowDone(row, done);
    const nextChecked = !checked;
    setDoneByPass((current) => ({
      ...current,
      [active]: {
        ...(current[active] ?? {}),
        ...Object.fromEntries(setTargets(row.sets).map((_, index) => [setKey(row.name, index), nextChecked])),
      },
    }));

    if (!nextChecked) {
      const targets = setTargets(row.sets);
      const matchingKeys = targets.map((_, index) => setKey(row.name, index));
      if (matchingKeys.includes(timerSetKey)) {
        setTimerVisible(false);
        setTimerRunning(false);
        setTimerSetKey("");
      }
    }
  }

  function toggleSet(name: string, index: number) {
    const key = setKey(name, index);
    const wasChecked = doneByPass[active]?.[key] ?? false;
    const isChecking = !wasChecked;

    setDoneByPass((current) => ({
      ...current,
      [active]: {
        ...(current[active] ?? {}),
        [key]: isChecking,
      },
    }));

    if (isChecking) {
      const row = exercises.find((r) => r.name === name);
      if (row && row.rest) {
        const seconds = parseRestToSeconds(row.rest);
        setTimerDuration(seconds);
        setTimerLeft(seconds);
        setTimerExercise(`${name} (Set ${index + 1})`);
        setTimerSetKey(key);
        setTimerRunning(true);
        setTimerVisible(true);
      }
    } else {
      if (timerSetKey === key) {
        setTimerVisible(false);
        setTimerRunning(false);
        setTimerSetKey("");
      }
    }
  }

  function toggleExpanded(name: string) {
    setExpandedByPass((current) => ({
      ...current,
      [active]: {
        ...(current[active] ?? {}),
        [name]: !(current[active]?.[name] ?? false),
      },
    }));
  }

  function clearDone() {
    setDoneByPass((current) => ({ ...current, [active]: {} }));
    setTimerVisible(false);
    setTimerRunning(false);
    setTimerSetKey("");
  }

  function flip(which: GripKind) {
    const next: Grip = grips[which] === "bred" ? "smal" : "bred";
    startTransition(async () => {
      setOptimistic(which === "push" ? { ...grips, push: next } : { ...grips, pull: next });
      await toggleGrip(which);
    });
  }

  return (
    <main>
      <PageHeader eyebrow="Dagens pass" title="Passmallar" />

      <div className="px-4">
        <div className="flex rounded-card border border-line bg-surface p-1">
          {(["hemma", "utegym"] as const).map((id) => {
            const tab = TEMPLATES[id];
            const on = active === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActive(id)}
                aria-pressed={on}
                className={`flex flex-1 items-center justify-center gap-2 rounded-[10px] py-2.5 text-sm font-extrabold transition-colors ${
                  on ? "bg-ember text-white shadow-sm" : "text-muted hover:text-text"
                }`}
              >
                <span aria-hidden>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </div>

        <p className="mt-2 text-xs leading-relaxed text-muted">{WEEKLY_LOGIC}</p>
        <p className="mt-3 flex items-center gap-2 text-sm text-faint">
          <span className="text-text">{template.sub}</span>
          {template.id === "utegym" && (
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
              Kräver stång
            </span>
          )}
        </p>

        <div className="mt-4 rounded-card border border-line bg-surface px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="tnum text-xl font-black text-text">
                {completed}/{total}
              </p>
              <p className="text-xs font-bold uppercase tracking-eyebrow text-muted">Övningar klara</p>
            </div>
            {completed > 0 && (
              <button
                type="button"
                onClick={clearDone}
                className="rounded-[10px] border border-line px-3 py-1.5 text-xs font-black text-muted hover:border-ember hover:text-ember"
              >
                Nollställ
              </button>
            )}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
            <div className="h-full rounded-full bg-green transition-all" style={{ width: `${progress}%` }} />
          </div>
          {completed === total && (
            <div className="mt-3 rounded-[10px] border border-green/40 bg-green/10 px-3 py-2">
              <p className="font-black text-green">Bra jobbat. Passet är klart.</p>
              <p className="mt-0.5 text-sm text-muted">
                Nu kan du logga nyckelövningarna om du vill följa styrkan över tid.
              </p>
            </div>
          )}
        </div>

        {visibleGoals.length > 0 && (
          <div className="mt-4 rounded-card border border-ember/20 bg-surface px-4 py-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-eyebrow text-ember">Inbakat skillfokus</p>
                <p className="mt-1 text-sm font-bold text-muted">
                  Dessa räknas när du bockar av matchande övningar i passet.
                </p>
              </div>
              <p className="tnum shrink-0 text-sm font-black text-gold">
                {completedGoals.length}/{visibleGoals.length}
              </p>
            </div>
            <div className="mt-3 space-y-2">
              {visibleGoals.map((goal) => {
                const covered = exercises.find((row) => passExerciseCoversLevel(row.name, goal.exercise));
                const checked = Boolean(
                  covered && isRowDone(covered, done) && passExerciseCoversLevel(covered.name, goal.exercise),
                );
                return (
                  <div
                    key={goal.id}
                    className={`rounded-[10px] border px-3 py-2 ${
                      checked ? "border-green/40 bg-green/10" : "border-line bg-bg/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-black ${checked ? "text-green" : "text-text"}`}>{goal.title}</p>
                        <p className="mt-0.5 text-xs font-bold text-muted">
                          {goal.trackName} nivå {goal.levelIdx} · test {goal.target}
                        </p>
                        {covered && <p className="mt-1 text-xs text-faint">Bockas av via: {covered.name}</p>}
                        {goal.elite && (
                          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-black text-gold bg-gold/5 border border-gold/10 rounded-[6px] px-2 py-0.5 w-fit">
                            <span>🏋️‍♂️ Elitnivå: Viktväst/extravikt rekommenderas!</span>
                          </div>
                        )}
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${
                          checked ? "bg-green text-white" : "border border-line text-faint"
                        }`}
                      >
                        {checked ? "klar" : "väntar"}
                      </span>
                    </div>
                    {!checked && (
                      <CoachingTips
                        guide={{ regression: goal.regression, cue: goal.cue, ready: goal.ready }}
                        className="mt-2"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-2">
        {groupByBlock(exercises).map((block) => (
          <section key={block.title} className="mt-5 px-4">
            <p className="eyebrow mb-2">{block.title}</p>
            <div className="card divide-y divide-line overflow-hidden">
              {block.rows.map((row) =>
                row.gripVaries ? (
                  <GripRow
                    key={row.name}
                    row={row}
                    kind={template.gripKind}
                    grip={grips[template.gripKind]}
                    pending={pending}
                    onFlip={flip}
                    checked={isRowDone(row, done)}
                    done={done}
                    expanded={expanded[row.name] ?? false}
                    onToggle={toggleDone}
                    onToggleSet={toggleSet}
                    onExpand={toggleExpanded}
                  />
                ) : (
                  <ExerciseRow
                    key={row.name}
                    row={row}
                    checked={isRowDone(row, done)}
                    done={done}
                    expanded={expanded[row.name] ?? false}
                    onToggle={toggleDone}
                    onToggleSet={toggleSet}
                    onExpand={toggleExpanded}
                  />
                ),
              )}
            </div>
          </section>
        ))}
      </div>

      <p className="mx-4 mt-5 rounded-card border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-muted">
        {template.tip}
      </p>

      {/* Rest Timer Widget */}
      {timerVisible && (
        <div className="fixed bottom-[76px] left-1/2 z-30 w-[calc(100%-2rem)] max-w-[28rem] -translate-x-1/2 rounded-card border border-line/60 bg-surface/90 p-3.5 shadow-[0_-8px_30px_rgba(0,0,0,0.12)] backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-bottom-5">
          {/* Progress bar at the top edge */}
          <div className="absolute top-0 inset-x-0 h-1 overflow-hidden rounded-t-card bg-bg/50">
            <div 
              className="h-full bg-ember transition-all duration-1000 ease-linear" 
              style={{ width: `${timerDuration > 0 ? (timerLeft / timerDuration) * 100 : 0}%` }} 
            />
          </div>
          
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-eyebrow text-muted">Vila efter</p>
              <p className="truncate text-xs font-bold text-text mt-0.5">{timerExercise}</p>
            </div>
            
            <div className="flex items-center gap-1.5">
              {/* Large timer display */}
              <span className="tnum text-2xl font-black text-ember pr-1">
                {formatTime(timerLeft)}
              </span>
              
              {/* Play/Pause */}
              <button
                type="button"
                onClick={() => setTimerRunning(!timerRunning)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg hover:border-ember text-text hover:text-ember transition-colors"
                title={timerRunning ? "Pausa" : "Starta"}
              >
                {timerRunning ? "⏸" : "▶"}
              </button>
              
              {/* +15s */}
              <button
                type="button"
                onClick={() => {
                  setTimerLeft(prev => prev + 15);
                  setTimerDuration(prev => prev + 15);
                }}
                className="flex h-9 px-2.5 items-center justify-center rounded-full border border-line bg-bg hover:border-ember text-xs font-bold text-text hover:text-ember transition-colors"
                title="Lägg till 15 sekunder"
              >
                +15s
              </button>
              
              {/* Skip / Stäng */}
              <button
                type="button"
                onClick={() => {
                  setTimerVisible(false);
                  setTimerRunning(false);
                }}
                className="flex h-9 px-3 items-center justify-center rounded-full border border-line bg-bg hover:border-ember text-xs font-bold text-muted hover:text-ember transition-colors"
              >
                Hoppa
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function ExerciseRow({
  row,
  checked,
  done,
  expanded,
  onToggle,
  onToggleSet,
  onExpand,
}: {
  row: TemplateRow;
  checked: boolean;
  done: Record<string, boolean>;
  expanded: boolean;
  onToggle: (row: TemplateRow) => void;
  onToggleSet: (name: string, index: number) => void;
  onExpand: (name: string) => void;
}) {
  return (
    <div className={`px-3 py-3 ${checked ? "bg-green/10" : ""}`}>
      <ExerciseHeader row={row} checked={checked} expanded={expanded} onToggle={onToggle} onExpand={onExpand} />
      {expanded && <WorkoutParts row={row} done={done} onToggleSet={onToggleSet} />}
    </div>
  );
}

function GripRow({
  row,
  kind,
  grip,
  pending,
  onFlip,
  checked,
  done,
  expanded,
  onToggle,
  onToggleSet,
  onExpand,
}: {
  row: TemplateRow;
  kind: GripKind;
  grip: Grip;
  pending: boolean;
  onFlip: (which: GripKind) => void;
  checked: boolean;
  done: Record<string, boolean>;
  expanded: boolean;
  onToggle: (row: TemplateRow) => void;
  onToggleSet: (name: string, index: number) => void;
  onExpand: (name: string) => void;
}) {
  const opt = GRIPS[kind].options[grip];
  return (
    <div className={`${checked ? "bg-green/10" : "bg-surface2/40"} px-3 py-3`}>
      <ExerciseHeader row={row} checked={checked} expanded={expanded} onToggle={onToggle} onExpand={onExpand} />
      {expanded && (
        <>
          <WorkoutParts row={row} done={done} onToggleSet={onToggleSet} />
          <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[10px] border border-line bg-bg/40 px-2.5 py-2">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-eyebrow text-faint">Grepp</span>
                <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-extrabold text-gold">
                  {opt.label}
                </span>
              </span>
              <p className="mt-0.5 truncate text-xs text-muted">{opt.note}</p>
            </div>
            <button
              type="button"
              onClick={onFlip.bind(null, kind)}
              disabled={pending}
              className="shrink-0 rounded-[10px] border border-ember/60 px-3 py-1.5 text-sm font-extrabold text-ember transition-colors hover:bg-ember hover:text-white disabled:opacity-50"
            >
              Växla
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ExerciseHeader({
  row,
  checked,
  expanded,
  onToggle,
  onExpand,
}: {
  row: TemplateRow;
  checked: boolean;
  expanded: boolean;
  onToggle: (row: TemplateRow) => void;
  onExpand: (name: string) => void;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-3">
      <DoneButton checked={checked} label={row.name} onToggle={() => onToggle(row)} />
      <button
        type="button"
        onClick={() => onExpand(row.name)}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[6rem_1fr_auto] items-center gap-3 text-left"
      >
        <ExerciseThumb name={row.name} />
        <div className="min-w-0">
          <p className={`font-bold ${checked ? "text-green line-through decoration-green/60" : "text-text"}`}>
            {row.name}
          </p>
          <p className="mt-1 text-xs font-bold uppercase tracking-eyebrow text-faint">{summaryLabel(row)}</p>
        </div>
        <span className="text-lg font-black text-faint">{expanded ? "−" : "+"}</span>
      </button>
    </div>
  );
}

function WorkoutParts({
  row,
  done,
  onToggleSet,
}: {
  row: TemplateRow;
  done: Record<string, boolean>;
  onToggleSet: (name: string, index: number) => void;
}) {
  const targets = setTargets(row.sets);
  return (
    <div className="mt-3 grid gap-2">
      <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
        <p className="text-[10px] font-black uppercase tracking-eyebrow text-faint">Gör så här</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{exerciseGuide(row.name)}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {targets.map((target, index) => {
          const checked = done[setKey(row.name, index)] ?? false;
          return (
            <button
              key={`${row.name}-${index}`}
              type="button"
              aria-pressed={checked}
              onClick={() => onToggleSet(row.name, index)}
              className={`min-h-14 rounded-[10px] border px-3 py-2 text-left transition-colors ${
                checked ? "border-green bg-green/10 text-green" : "border-line bg-white text-text hover:border-ember"
              }`}
            >
              <span className="block text-[10px] font-black uppercase tracking-eyebrow text-faint">
                {targets.length === 1 ? "Del" : `Set ${index + 1}`}
              </span>
              <span className="tnum mt-1 block text-sm font-black">{target}</span>
            </button>
          );
        })}
      </div>
      <RestCard rest={row.rest} />
    </div>
  );
}

function RestCard({ rest }: { rest: string | null }) {
  if (!rest) return null;
  return (
    <div className="rounded-[10px] border border-line bg-surface px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-eyebrow text-faint">Vila mellan set</p>
      <p className="tnum mt-1 text-sm font-black text-ember">{rest}</p>
    </div>
  );
}

function DoneButton({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={checked ? `Markera ${label} som ej klar` : `Markera ${label} som klar`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-base font-black transition-colors ${
        checked ? "border-green bg-green text-white" : "border-line bg-bg text-faint hover:border-ember hover:text-ember"
      }`}
    >
      {checked ? "✓" : ""}
    </button>
  );
}

function ExerciseThumb({ name }: { name: string }) {
  const src = exerciseImagePath(name);
  const [missing, setMissing] = useState(false);

  return (
    <div className="h-20 w-24 overflow-hidden rounded-[8px] border border-line bg-bg">
      {src && !missing ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setMissing(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase tracking-eyebrow text-faint">
          Bild
        </div>
      )}
    </div>
  );
}

function setKey(name: string, index: number) {
  return `${name}::set:${index}`;
}

function setTargets(sets: string) {
  const match = sets.match(/^(\d+)\s*[×x]\s*(.+)$/i);
  if (!match) return [sets];

  const count = Number.parseInt(match[1] ?? "1", 10);
  const target = match[2]?.trim() || sets;
  if (!Number.isFinite(count) || count < 1 || count > 12) return [sets];

  return Array.from({ length: count }, () => target);
}

function isRowDone(row: TemplateRow, done: Record<string, boolean>) {
  return setTargets(row.sets).every((_, index) => done[setKey(row.name, index)]);
}

function summaryLabel(row: TemplateRow) {
  const targets = setTargets(row.sets);
  const setText = targets.length === 1 ? row.sets : `${targets.length} set · ${targets[0]}`;
  return row.rest ? `${setText} · vila ${row.rest}` : setText;
}

function parseRestToSeconds(restStr: string | null): number {
  if (!restStr) return 90;
  const cleaned = restStr.trim().toLowerCase();
  
  const secMatch = cleaned.match(/^(\d+)\s*(s|sek|seconds?)$/);
  if (secMatch && secMatch[1]) {
    return parseInt(secMatch[1], 10);
  }
  
  const minMatch = cleaned.match(/^([\d.]+)\s*(m|min|minut|minuter)$/);
  if (minMatch && minMatch[1]) {
    return Math.round(parseFloat(minMatch[1]) * 60);
  }
  
  const numMatch = cleaned.match(/([\d.]+)/);
  if (numMatch && numMatch[1]) {
    const val = parseFloat(numMatch[1]);
    if (val <= 5) {
      return Math.round(val * 60);
    }
    return Math.round(val);
  }
  
  return 90;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function playTimerEndSound() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    const playBeep = (time: number, freq: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);
      
      gain.gain.setValueAtTime(0.1, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.05);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(time);
      osc.stop(time + duration);
    };
    
    if (ctx.state === "suspended") {
      ctx.resume().then(() => {
        const now = ctx.currentTime;
        playBeep(now, 880, 0.25);
        playBeep(now + 0.35, 880, 0.25);
      });
    } else {
      const now = ctx.currentTime;
      playBeep(now, 880, 0.25);
      playBeep(now + 0.35, 880, 0.25);
    }
  } catch (e) {
    console.error("Failed to play audio beep", e);
  }
}

function getWarmupsForDate(dateStr: string, isHome: boolean): TemplateRow[] {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const pool = [
    { block: "Uppvärmning", name: "Jumping jacks", sets: "3×30", rest: "30s" },
    { block: "Uppvärmning", name: "Mountain climbers", sets: "3×20", rest: "30s" },
    { block: "Uppvärmning", name: "High knees", sets: "3×30", rest: "30s" },
    { block: "Uppvärmning", name: "Armcirklar & axelprep", sets: "10 fram/bak", rest: null },
    { block: "Uppvärmning", name: "Handleds-stretch & prep", sets: "2 min", rest: null },
    { block: "Uppvärmning", name: "Benböj (uppvärmning)", sets: "3×10", rest: "30s" },
    { block: "Uppvärmning", name: "Burpees (lågt tempo)", sets: "3×5", rest: "45s" }
  ];
  
  if (!isHome) {
    pool.push({ block: "Uppvärmning", name: "Scapula-pulls i stången", sets: "2×8", rest: "30s" });
  }
  
  const selected: TemplateRow[] = [];
  const indices = new Set<number>();
  let attempts = 0;
  
  while (selected.length < 3 && attempts < 100) {
    const idx = Math.abs((hash + selected.length * 7 + attempts * 31) % pool.length);
    if (!indices.has(idx)) {
      indices.add(idx);
      const exercise = pool[idx];
      if (exercise) selected.push(exercise);
    }
    attempts++;
  }
  
  return selected;
}
