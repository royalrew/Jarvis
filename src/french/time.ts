/** Tidshjälpare i Europe/Stockholm för fransk-tutorns schemaläggning. */

const TZ = "Europe/Stockholm";

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=söndag … 6=lördag
}

export function zonedNow(date: Date = new Date()): ZonedParts {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short"
  });
  const v = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { sön: 0, mån: 1, tis: 2, ons: 3, tor: 4, fre: 5, lör: 6 };
  const wkRaw = String(v.weekday || "").toLowerCase().slice(0, 3);
  return {
    year: Number(v.year),
    month: Number(v.month),
    day: Number(v.day),
    hour: Number(v.hour),
    minute: Number(v.minute),
    weekday: weekdayMap[wkRaw] ?? new Date(date).getDay()
  };
}

/** ISO-datum (YYYY-MM-DD) i Stockholm. */
export function todayStockholm(date: Date = new Date()): string {
  const p = zonedNow(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function isSunday(date: Date = new Date()): boolean {
  return zonedNow(date).weekday === 0;
}
