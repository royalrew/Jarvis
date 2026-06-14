import postgres from "postgres";
import type {
  ConversationMessage,
  ImprovementSuggestion,
  JargonPhrase,
  Memory,
  Role
} from "./types.js";

/**
 * Postgres-backat datalager för Jarvis-boten (Railway-deploy).
 *
 * Kalenderhändelser bor i src/calendarDb.ts (tabell calendar_event) och delas
 * med trainer-appen. Här ligger konversation, minnen, jargong och
 * förbättringsbacklogg. Allt är async eftersom postgres-drivern är det.
 */
let sql: ReturnType<typeof postgres> | null = null;

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL saknas i .env.");
  sql ??= postgres(url, { max: 5 });
  return sql;
}

export async function initDb() {
  const q = db();

  await q`
    CREATE TABLE IF NOT EXISTS conversations (
      id BIGSERIAL PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await q`
    CREATE TABLE IF NOT EXISTS memories (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'manual',
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL DEFAULT 'manual',
      embedding TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await q`
    CREATE TABLE IF NOT EXISTS jargon_phrases (
      id BIGSERIAL PRIMARY KEY,
      phrase TEXT NOT NULL UNIQUE,
      meaning TEXT NOT NULL,
      tone TEXT,
      use_when TEXT,
      avoid_when TEXT,
      strength INTEGER NOT NULL DEFAULT 3,
      examples TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_used_at TIMESTAMPTZ
    )
  `;

  await q`
    CREATE TABLE IF NOT EXISTS style_feedback (
      id BIGSERIAL PRIMARY KEY,
      phrase_id BIGINT REFERENCES jargon_phrases(id),
      reaction TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await q`
    CREATE TABLE IF NOT EXISTS improvement_suggestions (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL UNIQUE,
      problem TEXT NOT NULL,
      proposal TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await seedKnownImprovementSuggestions();
}

export async function addConversation(role: Role, content: string) {
  await db()`INSERT INTO conversations (role, content) VALUES (${role}, ${content})`;
}

export async function getRecentConversation(limit = 20): Promise<ConversationMessage[]> {
  const rows = await db()`
    SELECT id, role, content, created_at AS "createdAt"
    FROM conversations
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return (rows as unknown as ConversationMessage[]).reverse();
}

export async function addMemory(value: string, kind = "manual", source = "manual"): Promise<number> {
  const rows = await db()`
    INSERT INTO memories (kind, value, source, updated_at)
    VALUES (${kind}, ${value}, ${source}, now())
    RETURNING id
  `;
  return Number(rows[0]?.id);
}

export async function setMemoryEmbedding(id: number, embedding: string) {
  await db()`UPDATE memories SET embedding = ${embedding} WHERE id = ${id}`;
}

export async function getMemories(limit = 20): Promise<Memory[]> {
  const rows = await db()`
    SELECT id, kind, value, confidence, source,
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM memories
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as Memory[];
}

export async function getAllMemoriesWithEmbeddings(): Promise<Memory[]> {
  const rows = await db()`
    SELECT id, kind, value, confidence, source,
           created_at AS "createdAt", updated_at AS "updatedAt", embedding
    FROM memories
    ORDER BY updated_at DESC
  `;
  return rows as unknown as Memory[];
}

export async function upsertJargon(phrase: string, meaning: string) {
  await db()`
    INSERT INTO jargon_phrases (phrase, meaning, tone, use_when, strength)
    VALUES (${phrase}, ${meaning}, 'kaxig med värme', 'när Jimmy tappar fokus, överbygger eller behöver en rak puff', 3)
    ON CONFLICT (phrase) DO UPDATE SET
      meaning = EXCLUDED.meaning,
      last_used_at = now()
  `;
}

export async function getJargon(limit = 20): Promise<JargonPhrase[]> {
  const rows = await db()`
    SELECT
      id, phrase, meaning, tone,
      use_when AS "useWhen",
      avoid_when AS "avoidWhen",
      strength, examples,
      created_at AS "createdAt",
      last_used_at AS "lastUsedAt"
    FROM jargon_phrases
    ORDER BY COALESCE(last_used_at, created_at) DESC
    LIMIT ${limit}
  `;
  return rows as unknown as JargonPhrase[];
}

export async function upsertImprovementSuggestion(
  title: string,
  problem: string,
  proposal: string,
  priority = 3,
  source = "manual"
) {
  await db()`
    INSERT INTO improvement_suggestions (title, problem, proposal, priority, source, updated_at)
    VALUES (${title}, ${problem}, ${proposal}, ${priority}, ${source}, now())
    ON CONFLICT (title) DO UPDATE SET
      problem = EXCLUDED.problem,
      proposal = EXCLUDED.proposal,
      priority = EXCLUDED.priority,
      source = EXCLUDED.source,
      updated_at = now()
  `;
}

export async function getImprovementSuggestions(limit = 10): Promise<ImprovementSuggestion[]> {
  const rows = await db()`
    SELECT
      id, title, problem, proposal, priority, status, source,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM improvement_suggestions
    WHERE status = 'open'
    ORDER BY priority DESC, updated_at DESC
    LIMIT ${limit}
  `;
  return rows as unknown as ImprovementSuggestion[];
}

export async function closeImprovementSuggestion(id: number, status = "done") {
  await db()`
    UPDATE improvement_suggestions
    SET status = ${status}, updated_at = now()
    WHERE id = ${id}
  `;
}

async function seedKnownImprovementSuggestions() {
  const suggestions = [
    {
      title: "Approval-gated self coding",
      problem:
        "Jarvis kan ännu inte förbättra sin egen kod på ett säkert sätt. Fri självmodifiering vore snabbt, men också ett bra sätt att såga av grenen hon sitter på.",
      proposal:
        "Bygg ett godkännandeflöde där Jarvis skapar en patch-plan, visar diffen, väntar på Jimmy, och först därefter låter Codex eller en lokal worker ändra kod.",
      priority: 5
    },
    {
      title: "Bättre setup-status för API-nycklar",
      problem:
        "Om OpenAI- eller modellnycklar saknas märks det först när funktionen används. Det är onödigt friktionigt.",
      proposal:
        "Visa en tydlig statusrad i appen: modell, transkribering, TTS och minne. Grönt när klart, gult när mock/fallback används.",
      priority: 4
    },
    {
      title: "Feedbackknappar på Jarvis svar",
      problem:
        "Jarvis kan inte enkelt se om ett svar var för långt, fel ton, för mesigt, för kaxigt eller faktiskt bra.",
      proposal:
        "Lägg till snabbfeedback: bra, för långt, fel ton, spara som minne, gör till förbättring.",
      priority: 4
    },
    {
      title: "Röstkalibrering",
      problem:
        "Inbyggd TTS fungerar, men rösten är inte Jarvis på riktigt. Hon låter fortfarande mer maskin än pondus.",
      proposal:
        "Lägg till valbar TTS-provider och en liten röstkalibrering: tempo, pitch, röst, samt exempel på hur Jarvis ska låta.",
      priority: 3
    }
  ];

  for (const suggestion of suggestions) {
    await upsertImprovementSuggestion(
      suggestion.title,
      suggestion.problem,
      suggestion.proposal,
      suggestion.priority,
      "bootstrap"
    );
  }
}
