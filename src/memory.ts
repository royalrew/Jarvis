import { addMemory, getAllMemoriesWithEmbeddings, setMemoryEmbedding } from "./db.js";
import type { Memory } from "./types.js";

async function getEmbedding(text: string): Promise<number[] | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text })
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    return data.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export async function findRelevantMemories(query: string, limit = 10): Promise<Memory[]> {
  const all = getAllMemoriesWithEmbeddings();
  if (all.length === 0) return [];

  const queryEmbedding = await getEmbedding(query);

  if (!queryEmbedding) {
    return all.slice(0, limit);
  }

  const withEmbedding: Array<{ memory: Memory; score: number }> = [];
  const withoutEmbedding: Memory[] = [];

  for (const m of all) {
    if (!m.embedding) {
      withoutEmbedding.push(m);
      continue;
    }
    try {
      const vec = JSON.parse(m.embedding) as number[];
      withEmbedding.push({ memory: m, score: cosineSimilarity(queryEmbedding, vec) });
    } catch {
      withoutEmbedding.push(m);
    }
  }

  withEmbedding.sort((a, b) => b.score - a.score);

  const topSemantic = withEmbedding.slice(0, limit).map((x) => x.memory);
  const topRecent = withoutEmbedding.slice(0, Math.max(0, limit - topSemantic.length));

  return [...topSemantic, ...topRecent];
}

export async function embedAndStoreMemory(id: number, value: string) {
  const embedding = await getEmbedding(value);
  if (embedding) {
    setMemoryEmbedding(id, JSON.stringify(embedding));
  }
}

export async function extractAndStoreMemories(userMessage: string, jarvisReply: string) {
  if (!process.env.OPENAI_API_KEY) return;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              'Extrahera 0-3 specifika fakta värda att minnas om Jimmy (användaren) från detta konversationsutdrag.',
              'Fokusera på: personlig kontext, pågående projekt, preferenser, beslut, viktiga påminnelser.',
              'Ignorera trivialt allmänprat och engångsfrågor.',
              'Svara med JSON: {"facts":["..."]}. Tom array om inget minnesvärtt sades.'
            ].join(" ")
          },
          {
            role: "user",
            content: `Jimmy: ${userMessage}\nJarvis: ${jarvisReply}`
          }
        ]
      })
    });

    if (!response.ok) return;

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content) as { facts?: unknown };
    const facts = Array.isArray(parsed.facts) ? (parsed.facts as unknown[]) : [];

    for (const fact of facts) {
      if (typeof fact === "string" && fact.length > 8) {
        const id = addMemory(fact, "auto", "extraction");
        embedAndStoreMemory(id, fact).catch(() => {});
        console.log(`[Jarvis minne] Auto-sparat: "${fact}"`);
      }
    }
  } catch (error) {
    console.error("[Jarvis auto-memory]", error);
  }
}
