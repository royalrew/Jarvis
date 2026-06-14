import type { Grip } from "@/db/schema";

/** Push styr armhävningar (hemma), pull styr pull-ups (utegym). */
export type GripKind = "push" | "pull";

export type TemplateRow = {
  block: string;
  name: string;
  sets: string;
  rest: string | null;
  /** Raden vars grepp roterar (matchar template.gripExercise). */
  gripVaries?: boolean;
};

export type SessionTemplate = {
  id: "hemma" | "utegym";
  label: string;
  icon: string;
  sub: string;
  gripExercise: string;
  gripKind: GripKind;
  exercises: TemplateRow[];
  tip: string;
};

export const TEMPLATES: Record<"hemma" | "utegym", SessionTemplate> = {
  hemma: {
    id: "hemma",
    label: "Hemma",
    icon: "🏠",
    sub: "Push · bål · ben",
    gripExercise: "Armhävningar",
    gripKind: "push",
    exercises: [
      { block: "Uppvärmning", name: "Handled- & axelprep", sets: "5 min", rest: null },
      { block: "Skill", name: "Handstativ mot vägg", sets: "3×20–40s", rest: "60s" },
      { block: "Skill", name: "Pseudo planche-lutning", sets: "3×15s", rest: "60s" },
      { block: "Press", name: "Armhävningar", sets: "4×8–15", rest: "90s", gripVaries: true },
      { block: "Press", name: "Pike push-ups", sets: "3×5–8", rest: "90s" },
      { block: "Bål", name: "Hollow hold", sets: "3×30s", rest: "45s" },
      { block: "Bål", name: "Side plank", sets: "3×30s/sida", rest: "45s" },
      { block: "Bål", name: "Liggande benlyft", sets: "3×10", rest: "45s" },
      { block: "Ben", name: "Split squats / pistol-prog.", sets: "3×8", rest: "90s" },
    ],
    tip: "Draget vilar idag — spara det till baren. Pressen är din svaga sida, så hemmapassen är där du tjänar mest.",
  },
  utegym: {
    id: "utegym",
    label: "Utegym",
    icon: "🏋️",
    sub: "Pull · dips · skills",
    gripExercise: "Pull-ups",
    gripKind: "pull",
    exercises: [
      { block: "Uppvärmning", name: "Scapula-pulls i stången", sets: "2×8", rest: "30s" },
      { block: "Skill", name: "Tuck front lever", sets: "4×8s", rest: "90s" },
      { block: "Skill", name: "Flagg-försök (om stolpe finns)", sets: "4×5–10s", rest: "90s" },
      { block: "Drag", name: "Pull-ups", sets: "4×3–8", rest: "2 min", gripVaries: true },
      { block: "Drag", name: "Australiska rows (under barren)", sets: "3×8–12", rest: "90s" },
      { block: "Press", name: "Dips på barren", sets: "4×3–8", rest: "2 min" },
      { block: "Bål", name: "Hängande knälyft", sets: "3×8–12", rest: "60s" },
    ],
    tip: "Ta vara på baren: pull-ups, dips och front lever går bara här. Sikta minst ett sånt här pass i veckan.",
  },
};

export const WEEKLY_LOGIC =
  "Vid baren → utegym-passet. Hemma → push-passet. Minst ett utegym-pass i veckan så draget får sitt.";

/** Vad varje grepp tränar – visas på grepp-raden. */
export const GRIPS: Record<GripKind, { default: Grip; options: Record<Grip, { label: string; note: string }> }> = {
  push: {
    default: "bred",
    options: {
      bred: { label: "Breda", note: "bröst & yttre — mer ytanvändning" },
      smal: { label: "Smala / diamond", note: "triceps & lockout — matar dips, planche, HSPU" },
    },
  },
  pull: {
    default: "bred",
    options: {
      bred: { label: "Breda overhand", note: "ryggbredd — guld för flaggan & front lever" },
      smal: { label: "Smala / chin (underhand)", note: "ren dragstyrka & biceps — matar muscle-up" },
    },
  },
};

/** Grupperar en mall i block i ursprunglig ordning. */
export function groupByBlock(rows: TemplateRow[]): { title: string; rows: TemplateRow[] }[] {
  const out: { title: string; rows: TemplateRow[] }[] = [];
  for (const row of rows) {
    let group = out[out.length - 1];
    if (!group || group.title !== row.block) {
      group = { title: row.block, rows: [] };
      out.push(group);
    }
    group.rows.push(row);
  }
  return out;
}
