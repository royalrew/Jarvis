import {
  addConversation,
  addMemory,
  closeImprovementSuggestion,
  getJargon,
  getImprovementSuggestions,
  getMemories,
  getRecentConversation,
  upsertImprovementSuggestion,
  upsertJargon
} from "./db.js";
import { addCalendarEvent, getCalendarEvents } from "./calendarDb.js";
import type { ImprovementSuggestion } from "./types.js";
import { getJarvisReply } from "./llm.js";
import { classifyIntent } from "./intent.js";
import { findRelevantMemories, extractAndStoreMemories, embedAndStoreMemory } from "./memory.js";
import { buildSystemPrompt, buildCodeSystemPrompt, buildCoachSystemPrompt } from "./prompts.js";
import { formatAgenda, getCalendarAgenda, getNamedRange, handleSmartCalendar } from "./calendar.js";
import { getCoachContext, handleTrainingCommand, parseTrainingCommand } from "./training.js";
import fs from "node:fs";
import path from "node:path";

export type JarvisInputResult = {
  reply: string;
  shouldContinue: boolean;
  intent?: string;
};

export async function handleJarvisInput(line: string, imageBase64?: string, windowContext?: string | null): Promise<JarvisInputResult> {
  if (!line) {
    return { reply: "", shouldContinue: true };
  }

  if (line === "/exit") {
    return {
      reply: "Bra. Stäng loopen innan den börjar låtsas vara en livsstil.",
      shouldContinue: false
    };
  }

  if (line.startsWith("/remember ")) {
    const value = line.replace("/remember ", "").trim();
    const id = await addMemory(value);
    embedAndStoreMemory(id, value).catch(() => {});
    return { reply: "Sparat. Det där slipper du förklara igen.", shouldContinue: true };
  }

  const trainingCommand = parseTrainingCommand(line);
  if (trainingCommand) {
    try {
      const reply = await handleTrainingCommand(trainingCommand);
      if (reply !== null) {
        await addConversation("user", line);
        await addConversation("assistant", reply);
        return { reply, shouldContinue: true, intent: "training" };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        reply: `Träningsdelen är inte redo: ${message}`,
        shouldContinue: true,
        intent: "training"
      };
    }
  }

  if (line === "/memories") {
    const memories = await getMemories();
    return {
      reply: formatList("Jarvis minns", memories.map((memory) => memory.value)),
      shouldContinue: true
    };
  }

  const calendarCreate = parseCalendarCreate(line);
  if (calendarCreate) {
    const id = await addCalendarEvent({ ...calendarCreate, source: "jarvis" });
    const reply = `Inlagt i kalendern: ${calendarCreate.title} ${formatCalendarCreateTime(calendarCreate.startsAt, calendarCreate.endsAt)}. Id #${id}.`;
    await addConversation("user", line);
    await addConversation("assistant", reply);
    return { reply, shouldContinue: true, intent: "note" };
  }

  const calendarRange = getCalendarRangeFromInput(line);
  if (calendarRange) {
    try {
      const [remoteEvents, localEvents] = await Promise.all([
        getCalendarAgenda(calendarRange.start, calendarRange.end).catch(() => []),
        getCalendarEvents(calendarRange.start.toISOString(), calendarRange.end.toISOString())
      ]);
      const reply = formatAgenda([...remoteEvents, ...localEvents.map((event) => ({
        title: event.title,
        start: new Date(event.startsAt),
        end: event.endsAt ? new Date(event.endsAt) : undefined,
        location: event.location ?? undefined,
        allDay: false
      }))], calendarRange.label);
      await addConversation("user", line);
      await addConversation("assistant", reply);
      return { reply, shouldContinue: true, intent: "chat" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        reply: `Kalendern ar inte redo: ${message}`,
        shouldContinue: true,
        intent: "chat"
      };
    }
  }

  if (line === "/reflect") {
    await logRuntimeImprovementSuggestions();
    return {
      reply: await buildReflectionReply(),
      shouldContinue: true
    };
  }

  if (line === "/improvements") {
    return {
      reply: formatImprovements(await getImprovementSuggestions(8)),
      shouldContinue: true
    };
  }

  if (line.startsWith("/improve ")) {
    const entry = line.replace("/improve ", "").trim();
    const [title, rest] = entry.split("=").map((part) => part?.trim());
    const [problem, proposal] = (rest || "").split("->").map((part) => part?.trim());

    if (!title || !problem || !proposal) {
      return {
        reply:
          "Formatet är `/improve titel = problem -> förslag`. Lite byråkrati, ja. Men ordning slår kaos med eyeliner.",
        shouldContinue: true
      };
    }

    await upsertImprovementSuggestion(title, problem, proposal, 4, "jimmy");
    return {
      reply: "Inlagt i förbättringsbackloggen. Den där kan vi ge till Codex när det är dags att skruva.",
      shouldContinue: true
    };
  }

  if (line.startsWith("/done ")) {
    const id = Number(line.replace("/done ", "").trim());

    if (!Number.isInteger(id)) {
      return { reply: "Ge mig ett id. `/done 3`. Inte poesi.", shouldContinue: true };
    }

    await closeImprovementSuggestion(id);
    return { reply: "Markerad som klar. Snyggt. En loop mindre som ligger och skaver.", shouldContinue: true };
  }

  if (line === "/handoff") {
    await logRuntimeImprovementSuggestions();
    return {
      reply: await buildHandoffPrompt(),
      shouldContinue: true
    };
  }

  if (line.startsWith("/jargon ")) {
    const entry = line.replace("/jargon ", "").trim();
    const [phrase, meaning] = entry.split("=").map((part) => part?.trim());

    if (!phrase || !meaning) {
      return {
        reply: "Formatet är `/jargon fras = betydelse`. Nära, men nej.",
        shouldContinue: true
      };
    }

    await upsertJargon(phrase, meaning);
    return {
      reply: "Inlagt. Jag ska inte missbruka den. Jag är kaxig, inte desperat.",
      shouldContinue: true
    };
  }

  if (line === "/jargon") {
    const jargon = await getJargon();
    return {
      reply: formatList("Jarvis jargong", jargon.map((item) => `"${item.phrase}" = ${item.meaning}`)),
      shouldContinue: true
    };
  }

  await addConversation("user", line);

  try {
    const [{ intent }, relevantMemories] = await Promise.all([
      classifyIntent(line),
      findRelevantMemories(line)
    ]);
    console.log(`[Jarvis intent] ${intent}, minnen: ${relevantMemories.length}`);

    if (intent === "note") {
      return await handleNoteIntent(line);
    }

    if (intent === "calendar") {
      const reply = await handleSmartCalendar(line);
      await addConversation("assistant", reply);
      return { reply, shouldContinue: true, intent };
    }

    if (intent === "training") {
      try {
        const reply = await handleTrainingCommand({ type: "today" });
        if (reply) {
          await addConversation("assistant", reply);
          return { reply, shouldContinue: true, intent };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { reply: `Träningsdelen är inte redo: ${message}`, shouldContinue: true, intent };
      }
    }

    if (intent === "coaching") {
      const trainingContext = await getCoachContext().catch(() => "");
      const coachPrompt = buildCoachSystemPrompt(relevantMemories, await getJargon(), trainingContext);
      const reply = await getJarvisReply(coachPrompt, await getRecentConversation(), imageBase64);
      await addConversation("assistant", reply);
      extractAndStoreMemories(line, reply).catch(() => {});
      return { reply, shouldContinue: true, intent };
    }

    const jargon = await getJargon();
    const systemPrompt =
      intent === "code"
        ? buildCodeSystemPrompt(relevantMemories, jargon, windowContext)
        : buildSystemPrompt(relevantMemories, jargon, await getImprovementSuggestions(5), windowContext);

    const reply = await getJarvisReply(systemPrompt, await getRecentConversation(), imageBase64);
    await addConversation("assistant", reply);

    extractAndStoreMemories(line, reply).catch(() => {});

    return { reply, shouldContinue: true, intent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await upsertImprovementSuggestion(
      "Tydligare felhantering i Jarvis-svar",
      `Jarvis fångade ett tekniskt fel och visade det nästan rått: ${message}`,
      "Bygg ett felhanteringslager som skiljer på saknad konfiguration, nätverksfel, modellfel och interna buggar, och föreslår nästa steg.",
      4,
      "runtime-error"
    );
    return { reply: `Något small: ${message}`, shouldContinue: true };
  }
}

async function handleNoteIntent(line: string): Promise<JarvisInputResult> {
  await addMemory(line);

  const notesDir = process.env.JARVIS_NOTES_PATH;
  if (notesDir) {
    try {
      fs.mkdirSync(notesDir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const file = path.join(notesDir, `${date}.md`);
      const timestamp = new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
      fs.appendFileSync(file, `\n- ${timestamp} ${line}\n`, "utf8");
    } catch {
      // spara i minnet räcker
    }
  }

  await addConversation("assistant", "Sparat.");
  return { reply: "Sparat.", shouldContinue: true, intent: "note" };
}

function getCalendarRangeFromInput(line: string) {
  const normalized = line.trim().toLowerCase();

  if (normalized === "/today" || normalized === "/kalender idag" || normalized === "/calendar today") {
    return getNamedRange("today");
  }

  if (normalized === "/tomorrow" || normalized === "/kalender imorgon" || normalized === "/calendar tomorrow") {
    return getNamedRange("tomorrow");
  }

  if (normalized === "/calendar" || normalized === "/kalender" || normalized === "/agenda") {
    return getNamedRange("upcoming");
  }

  const asksForCalendar =
    normalized.includes("kalender") ||
    normalized.includes("agenda") ||
    normalized.includes("schema") ||
    normalized.includes("vad hander") ||
    normalized.includes("vad händer");

  if (!asksForCalendar) {
    return null;
  }

  if (normalized.includes("imorgon")) {
    return getNamedRange("tomorrow");
  }

  if (normalized.includes("idag")) {
    return getNamedRange("today");
  }

  return getNamedRange("upcoming");
}

function parseCalendarCreate(line: string) {
  const trimmed = line.trim();
  const match = trimmed.match(/^(?:\/addcal|\/kalender\s+lägg|lägg\s+(?:in\s+)?(?:i\s+)?kalendern?|boka)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?:-(\d{2}:\d{2}))?\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const [, date, startTime, endTime, title] = match;
  const startsAt = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  const endsAt = endTime ? new Date(`${date}T${endTime}:00`) : null;
  return {
    title: title.trim(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null
  };
}

function formatCalendarCreateTime(startsAt: string, endsAt?: string | null) {
  const start = new Date(startsAt);
  const date = start.toLocaleDateString("sv-SE");
  const startTime = start.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (!endsAt) {
    return `${date} ${startTime}`;
  }

  const end = new Date(endsAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${startTime}-${end}`;
}

function formatList(title: string, items: string[]) {
  if (items.length === 0) {
    return `${title}: tomt. Rent bord. Ovanligt vuxet.`;
  }

  return [`${title}:`, ...items.map((item) => `- ${item}`)].join("\n");
}

async function logRuntimeImprovementSuggestions() {
  if (!process.env.OPENAI_API_KEY) {
    await upsertImprovementSuggestion(
      "Tydlig onboarding för scroll-knappens röstläge",
      "Push-to-talk via scroll-knappen kräver OPENAI_API_KEY, men appen har ingen tydlig onboarding som säger exakt vad som saknas innan användaren testar.",
      "Lägg till en statuspanel som visar om mikrofon, OpenAI-transkribering och Jarvis-modell är redo.",
      5,
      "runtime-reflection"
    );
  }

  const provider = (process.env.JARVIS_PROVIDER || "auto").toLowerCase();
  const isMock =
    provider === "mock" ||
    (provider === "auto" && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY);

  if (isMock) {
    await upsertImprovementSuggestion(
      "Synlig mock-mode varning",
      "Jarvis kan köras i mock-läge och kännas levande, men då är hon inte kopplad till riktig modell. Det bör synas tydligt.",
      "Visa en diskret men tydlig modellstatus i UI:t och låt Jarvis säga när hon bara kör mock.",
      4,
      "runtime-reflection"
    );
  }
}

async function buildReflectionReply() {
  const suggestions = await getImprovementSuggestions(6);

  return [
    "Självdiagnos, utan att låtsas vara fulländad:",
    "",
    ...suggestions.map(
      (item) =>
        `#${item.id} ${item.title}\nBrister: ${item.problem}\nFörslag: ${item.proposal}`
    ),
    "",
    "Min rekommendation: ta högsta prio först. Jag ska inte börja operera i min egen hjärna utan att du säger kör. Lite självbevarelsedrift har jag ändå."
  ].join("\n");
}

async function buildHandoffPrompt() {
  const suggestions = await getImprovementSuggestions(5);

  if (suggestions.length === 0) {
    return "Det finns inga öppna förbättringar. Misstänkt moget. Nästan obehagligt.";
  }

  return [
    "Ge detta till Codex:",
    "",
    "Uppgift: förbättra Jarvis utifrån följande prioriterade backlog. Håll ändringar små, verifiera med npm run check och bygg om .exe med npm run dist:win.",
    "",
    ...suggestions.map(
      (item) =>
        `#${item.id} ${item.title}\nProblem: ${item.problem}\nFörslag: ${item.proposal}\nPrioritet: ${item.priority}`
    )
  ].join("\n");
}

function formatImprovements(items: ImprovementSuggestion[]) {
  if (items.length === 0) {
    return "Förbättringsbackloggen är tom. Antingen är jag perfekt, eller så har vi inte tittat tillräckligt noga. Jag vet vilket jag tror.";
  }

  return [
    "Öppna förbättringar:",
    ...items.map(
      (item) =>
        `#${item.id} [prio ${item.priority}] ${item.title}\nBrister: ${item.problem}\nFörslag: ${item.proposal}`
    )
  ].join("\n\n");
}
