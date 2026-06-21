import { fsrs, createEmptyCard, Rating, State, type Card, type Grade } from "ts-fsrs";
import {
  getItemByLemma,
  getFacet,
  saveFacetCard,
  type Channel,
  type FacetKind
} from "./db.js";

/**
 * FSRS-lagret: deterministisk schemaläggning + den hårda regeln för
 * källstyrd mastery.
 *
 * Den enda meningen som styr allt: LLM:en bedömer och klassificerar, det här
 * lagret äger sanningen och schemalägger. Här lever den regeln konkret:
 * inmatningsmetoden avgör vilka facetter som ÖVER HUVUD TAGET får uppdateras.
 */

const f = fsrs();

/** Stabilitet (dagar) då en facett räknas som behärskad. */
export const MASTERY_STABILITY = 21;

/** Antal lapses innan en facett pinnas som leech (envis svaghet). */
const LEECH_LAPSES = 4;

/**
 * Källstyrd mastery — den hårda regeln.
 *
 * - Text-input ökar endast `meaning` och `production` (stavning).
 * - Voice-input ökar endast `meaning` och `pronunciation` (uttal).
 *
 * Ett `production`-betyg från en röstkanal (eller `pronunciation` från text)
 * släpps alltså aldrig in — kanalen kan helt enkelt inte bevisa den facetten.
 */
export function allowedKinds(channel: Channel): FacetKind[] {
  return channel === "text"
    ? ["meaning", "production"]
    : ["meaning", "pronunciation"];
}

export function isKindAllowed(channel: Channel, kind: FacetKind): boolean {
  return allowedKinds(channel).includes(kind);
}

export interface GradeOutcome {
  lemma: string;
  kind: FacetKind;
  applied: boolean;
  reason?: string;
  stability?: number;
  due?: Date;
  becameLeech?: boolean;
  mastered?: boolean;
}

/**
 * Graderar en enskild facett via FSRS — men bara om kanalen får röra den kinden.
 * Returnerar utfall för loggning/feedback. grade 1–4 mappar direkt till FSRS
 * Rating (1=Again … 4=Easy).
 */
export async function gradeFacet(
  lemma: string,
  kind: FacetKind,
  grade: number,
  channel: Channel,
  now: Date = new Date()
): Promise<GradeOutcome> {
  if (!isKindAllowed(channel, kind)) {
    return {
      lemma,
      kind,
      applied: false,
      reason: `${kind} kan inte bedömas via ${channel === "text" ? "text" : "röst"}`
    };
  }

  const item = await getItemByLemma(lemma);
  if (!item) {
    return { lemma, kind, applied: false, reason: "okänt item" };
  }

  const facet = await getFacet(item.id, kind);
  if (!facet) {
    return { lemma, kind, applied: false, reason: "facett saknas" };
  }

  const rating = clampRating(grade);
  const { card } = f.next(facet.card, now, rating);

  const becameLeech = card.lapses >= LEECH_LAPSES;
  await saveFacetCard(facet.id, card, becameLeech ? true : undefined);

  return {
    lemma,
    kind,
    applied: true,
    stability: card.stability,
    due: card.due,
    becameLeech,
    mastered: card.stability >= MASTERY_STABILITY && card.state === State.Review
  };
}

/** Ett tomt FSRS-kort (för nya facetter som skapas utanför db.ts). */
export function freshCard(now: Date = new Date()): Card {
  return createEmptyCard(now);
}

function clampRating(grade: number): Grade {
  const g = Math.round(grade);
  if (g <= 1) return Rating.Again;
  if (g === 2) return Rating.Hard;
  if (g === 3) return Rating.Good;
  return Rating.Easy;
}
