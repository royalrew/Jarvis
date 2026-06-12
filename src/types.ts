export type Role = "user" | "assistant" | "system";

export type ConversationMessage = {
  id: number;
  role: Role;
  content: string;
  createdAt: string;
};

export type Memory = {
  id: number;
  kind: string;
  value: string;
  confidence: number;
  source: string;
  createdAt: string;
  updatedAt: string;
  embedding?: string | null;
};

export type JargonPhrase = {
  id: number;
  phrase: string;
  meaning: string;
  tone: string | null;
  useWhen: string | null;
  avoidWhen: string | null;
  strength: number;
  examples: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

export type ImprovementSuggestion = {
  id: number;
  title: string;
  problem: string;
  proposal: string;
  priority: number;
  status: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};
