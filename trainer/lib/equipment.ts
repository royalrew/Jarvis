/**
 * Vilken utrustning som finns tillgänglig styr vilka spår som visas.
 *
 * Jimmy (2026-06): golv + parallettes/barr + hantlar/kettlebell hemma, stång på
 * utegymmet några gånger i veckan. Inga ringar någonstans än.
 *
 * Skaffar du ringar (eller annat): lägg till utrustningen i AVAILABLE_EQUIPMENT
 * nedan, så dyker spåret upp igen automatiskt i både Nivåer och passet.
 */
export type Equipment = "floor" | "bar" | "rings" | "parallettes" | "weights";

export const AVAILABLE_EQUIPMENT: ReadonlySet<Equipment> = new Set<Equipment>([
  "floor",
  "bar", // utegym
  "parallettes", // hemma
  "weights", // hantlar/kettlebell
]);

/**
 * Utrustning som ett spår kräver för att vara meningsfullt att träna.
 * Spår som saknas här kräver bara golv/kroppsvikt och är alltid tillgängliga.
 * Stång (drag/front/mu) gatas inte här – den finns på utegymmet, och passet
 * visar de övningarna bara i "utegym"-mallen.
 */
const TRACK_EQUIPMENT: Record<string, Equipment> = {
  rings: "rings",
};

export function isTrackAvailable(trackId: string): boolean {
  const need = TRACK_EQUIPMENT[trackId];
  if (!need) return true;
  return AVAILABLE_EQUIPMENT.has(need);
}
