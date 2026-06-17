type DailyReminderOptions = {
  hour: number;
  minute: number;
  timeZone: string;
  message: string;
  label: string;
  onReminder: (message: string) => void | Promise<void>;
};

export function startDailyReminder(options: DailyReminderOptions) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSentDate = "";

  const scheduleNext = () => {
    if (stopped) return;

    const now = new Date();
    const next = getNextZonedTime(now, options.timeZone, options.hour, options.minute);

    const delayMs = next.getTime() - now.getTime();
    timer = setTimeout(async () => {
      const sentDate = formatZonedDate(new Date(), options.timeZone);
      if (sentDate !== lastSentDate) {
        lastSentDate = sentDate;
        try {
          await options.onReminder(options.message);
        } catch (error) {
          console.error(`[Reminder] ${options.label} misslyckades:`, error);
        }
      }
      scheduleNext();
    }, delayMs);
  };

  scheduleNext();

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

function getNextZonedTime(now: Date, timeZone: string, hour: number, minute: number) {
  const parts = getZonedParts(now, timeZone);
  let next = zonedTimeToDate(timeZone, parts.year, parts.month, parts.day, hour, minute);

  if (next <= now) {
    const tomorrow = addZonedDays(parts.year, parts.month, parts.day, 1);
    next = zonedTimeToDate(timeZone, tomorrow.year, tomorrow.month, tomorrow.day, hour, minute);
  }

  return next;
}

function getZonedParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function zonedTimeToDate(timeZone: string, year: number, month: number, day: number, hour: number, minute: number) {
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let utcMs = targetUtcMs;

  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(utcMs), timeZone);
    const actualUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
    utcMs += targetUtcMs - actualUtcMs;
  }

  return new Date(utcMs);
}

function addZonedDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function formatZonedDate(date: Date, timeZone: string) {
  const { year, month, day } = getZonedParts(date, timeZone);
  return `${year}-${month}-${day}`;
}

export const BRAK_REMINDER_MESSAGE = [
  "BRAK nu.",
  "Buk, rygg, axlar och knän:",
  "- Armhävningar",
  "- Ryggresningar",
  "- Jägarvila",
  "- Knäböj"
].join("\n");
