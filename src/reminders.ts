type DailyReminderOptions = {
  hour: number;
  minute: number;
  timeZone: string;
  message: string | (() => string | Promise<string>);
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
          const message = typeof options.message === "function" ? await options.message() : options.message;
          await options.onReminder(message);
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
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export async function getBrakReminderMessage(timeZone = "Europe/Stockholm") {
  const today = formatZonedDate(new Date(), timeZone);
  const motivation = await getDailyMotivation(today);
  return [BRAK_REMINDER_BASE, "", "Dagens puff:", motivation].join("\n");
}

const BRAK_REMINDER_BASE = [
  "BRAK nu.",
  "Buk, rygg, axlar och knän:",
  "- Armhävningar",
  "- Ryggresningar",
  "- Jägarvila",
  "- Knäböj"
].join("\n");

const FALLBACK_MOTIVATIONS = [
  "Du behöver inte känna dig redo. Du behöver bara börja innan hjärnan hinner förhandla bort det.",
  "Fem minuter disciplin nu slår en hel dag av ursäkter. Kör första repetitionen.",
  "Det här är inte stort och dramatiskt. Det är bara du som håller standarden.",
  "Gör det enkelt: ner på golvet, första setet, inget möte med latheten.",
  "Kroppen fattar efteråt. Starta ändå.",
  "Styrka byggs inte när det passar perfekt. Den byggs när du gör jobbet ändå.",
  "Dagens seger är liten, konkret och svår att snacka bort. BRAK först.",
  "Du behöver inte maxa. Du behöver visa kroppen vem som bestämmer riktningen.",
  "Inga förhandlingar kl. 05. Bara rörelse, kontroll och nästa repetition.",
  "Det här är kvittot på att du menar allvar även när ingen tittar.",
  "Börja fult om du måste, men börja. Formen skärper du medan du jobbar.",
  "En stark rygg, stabil bål och fungerande knän kommer inte av planer. De kommer av det här.",
  "Låt morgonen få en tydlig signal: kroppen är med i matchen.",
  "Gör passet kort, men gör det på riktigt. Halv fart är okej, halv närvaro är det inte.",
  "Det är inte motivationen som ska bära dig. Det är rutinen."
];

async function getDailyMotivation(today: string) {
  const fallback = getFallbackMotivation(today);

  if (!process.env.OPENAI_API_KEY) {
    return fallback;
  }

  try {
    const model = process.env.OPENAI_REMINDER_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.9,
        max_tokens: 80,
        messages: [
          {
            role: "system",
            content: [
              "Du är Jarvis, Jimmys raka AI-coach.",
              "Skriv en unik motiverande morgonpuff på svenska för BRAK-träning.",
              "Ton: kort, pondus, varm men inte klämkäck.",
              "Max två meningar. Inga emojis. Inga listor. Nämn inte datumet."
            ].join(" ")
          },
          {
            role: "user",
            content: `Dagens datum är ${today}. Träningen är BRAK: buk, rygg, axlar och knän med armhävningar, ryggresningar, jägarvila och knäböj.`
          }
        ]
      })
    });

    if (!response.ok) {
      console.error(`[Reminder] OpenAI motivation misslyckades: ${response.status}`, await response.text());
      return fallback;
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = sanitizeMotivation(data.choices?.[0]?.message?.content);
    return text || fallback;
  } catch (error) {
    console.error("[Reminder] OpenAI motivation misslyckades:", error);
    return fallback;
  }
}

function getFallbackMotivation(today: string) {
  const index = Math.abs(hashString(today)) % FALLBACK_MOTIVATIONS.length;
  return FALLBACK_MOTIVATIONS[index];
}

function sanitizeMotivation(value?: string) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.replace(/^["'“”]+|["'“”]+$/g, "").slice(0, 280);
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
