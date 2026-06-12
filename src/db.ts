import { DatabaseSync } from "node:sqlite";
import type {
  ConversationMessage,
  ImprovementSuggestion,
  JargonPhrase,
  Memory,
  Role
} from "./types.js";

const db = new DatabaseSync(process.env.JARVIS_DB_PATH || "db.sqlite");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'manual',
      value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jargon_phrases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phrase TEXT NOT NULL UNIQUE,
      meaning TEXT NOT NULL,
      tone TEXT,
      use_when TEXT,
      avoid_when TEXT,
      strength INTEGER NOT NULL DEFAULT 3,
      examples TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT
    );

    CREATE TABLE IF NOT EXISTS style_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phrase_id INTEGER,
      reaction TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (phrase_id) REFERENCES jargon_phrases(id)
    );

    CREATE TABLE IF NOT EXISTS improvement_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      problem TEXT NOT NULL,
      proposal TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL DEFAULT 'open',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try {
    db.exec("ALTER TABLE memories ADD COLUMN embedding TEXT");
  } catch {}

  seedKnownImprovementSuggestions();
}

export function addConversation(role: Role, content: string) {
  db.prepare("INSERT INTO conversations (role, content) VALUES (?, ?)").run(role, content);
}

export function getRecentConversation(limit = 20): ConversationMessage[] {
  const rows = db
    .prepare(
      `SELECT id, role, content, created_at as createdAt
       FROM conversations
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(limit) as ConversationMessage[];

  return rows.reverse();
}

export function addMemory(value: string, kind = "manual", source = "manual"): number {
  const result = db.prepare(
    `INSERT INTO memories (kind, value, source, updated_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(kind, value, source);
  return Number(result.lastInsertRowid);
}

export function setMemoryEmbedding(id: number, embedding: string) {
  db.prepare("UPDATE memories SET embedding = ? WHERE id = ?").run(embedding, id);
}

export function getMemories(limit = 20): Memory[] {
  return db
    .prepare(
      `SELECT id, kind, value, confidence, source, created_at as createdAt, updated_at as updatedAt
       FROM memories
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(limit) as Memory[];
}

export function getAllMemoriesWithEmbeddings(): Memory[] {
  return db
    .prepare(
      `SELECT id, kind, value, confidence, source, created_at as createdAt, updated_at as updatedAt, embedding
       FROM memories
       ORDER BY updated_at DESC`
    )
    .all() as Memory[];
}

export function upsertJargon(phrase: string, meaning: string) {
  db.prepare(
    `INSERT INTO jargon_phrases (phrase, meaning, tone, use_when, strength)
     VALUES (?, ?, 'kaxig med värme', 'när Jimmy tappar fokus, överbygger eller behöver en rak puff', 3)
     ON CONFLICT(phrase) DO UPDATE SET
       meaning = excluded.meaning,
       last_used_at = datetime('now')`
  ).run(phrase, meaning);
}

export function getJargon(limit = 20): JargonPhrase[] {
  return db
    .prepare(
      `SELECT
        id,
        phrase,
        meaning,
        tone,
        use_when as useWhen,
        avoid_when as avoidWhen,
        strength,
        examples,
        created_at as createdAt,
        last_used_at as lastUsedAt
       FROM jargon_phrases
       ORDER BY COALESCE(last_used_at, created_at) DESC
       LIMIT ?`
    )
    .all(limit) as JargonPhrase[];
}

export function upsertImprovementSuggestion(
  title: string,
  problem: string,
  proposal: string,
  priority = 3,
  source = "manual"
) {
  db.prepare(
    `INSERT INTO improvement_suggestions (title, problem, proposal, priority, source, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(title) DO UPDATE SET
       problem = excluded.problem,
       proposal = excluded.proposal,
       priority = excluded.priority,
       source = excluded.source,
       updated_at = datetime('now')`
  ).run(title, problem, proposal, priority, source);
}

export function getImprovementSuggestions(limit = 10): ImprovementSuggestion[] {
  return db
    .prepare(
      `SELECT
        id,
        title,
        problem,
        proposal,
        priority,
        status,
        source,
        created_at as createdAt,
        updated_at as updatedAt
       FROM improvement_suggestions
       WHERE status = 'open'
       ORDER BY priority DESC, updated_at DESC
       LIMIT ?`
    )
    .all(limit) as ImprovementSuggestion[];
}

export function closeImprovementSuggestion(id: number, status = "done") {
  db.prepare(
    `UPDATE improvement_suggestions
     SET status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(status, id);
}

function seedKnownImprovementSuggestions() {
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
    upsertImprovementSuggestion(
      suggestion.title,
      suggestion.problem,
      suggestion.proposal,
      suggestion.priority,
      "bootstrap"
    );
  }
}
