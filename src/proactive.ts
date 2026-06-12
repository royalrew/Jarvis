import { getMemories } from "./db.js";

type WindowEntry = { proc: string; title: string; time: number };

type ProactiveContext = {
  minutesSinceLastInteraction: number;
  windowHistory: WindowEntry[];
};

export async function checkForProactiveInsight(ctx: ProactiveContext): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  if (ctx.minutesSinceLastInteraction < 20) return null;

  const recentMemories = getMemories(6).map((m) => m.value);
  const windowSummary = ctx.windowHistory
    .slice(0, 5)
    .map((w) => (w.title ? `${w.proc}: ${w.title}` : w.proc))
    .join(", ");

  const parts = [
    `Jimmy har inte pratat med Jarvis på ${ctx.minutesSinceLastInteraction} minuter.`,
    windowSummary ? `Han har haft uppe: ${windowSummary}.` : "",
    recentMemories.length ? `Nyliga noteringar: ${recentMemories.join("; ")}.` : "",
    `Klockan är ${new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}.`
  ].filter(Boolean).join(" ");

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.7,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content: [
              "Du är Jarvis, Jimmys personliga AI med pondus och fokus.",
              "Baserat på kontexten: finns det ETT konkret, genuint värdefullt att säga proaktivt?",
              "BRA: påminna om en specifik notering, flagga något han glömt, ge en relevant insikt om vad han jobbar med.",
              "DÅLIGT: 'Hej hur mår du?', tomt uppmuntrande, generellt chit-chat.",
              "Om inget genuint värdefullt: svara med exakt ordet null.",
              "Om ja: ett kort, rakt meddelande på 1-2 meningar på svenska med Jarvis ton — pondus, inte artig kundtjänst."
            ].join(" ")
          },
          { role: "user", content: parts }
        ]
      })
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content?.trim() ?? "";

    if (!content || content.toLowerCase() === "null" || content.length < 10) return null;
    return content;
  } catch {
    return null;
  }
}
