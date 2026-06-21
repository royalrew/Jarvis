import { getSql } from "../db.js";

export type MysteryLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface MysteryClue {
  id: string;
  minLevel: MysteryLevel;
  revealSeed: string;
  publicNote: string;
  secretMeaning: string;
}

export interface MysteryBible {
  title: string;
  hook: string;
  truth: string;
  finalProof: string[];
  clues: MysteryClue[];
}

export interface MysteryLedgerEntry {
  clueId: string;
  note: string;
  discoveredAt: string;
}

export interface MysteryPublicState {
  revealedClueIds: string[];
  ledger: MysteryLedgerEntry[];
  theories: string[];
  scenesSinceClue: number;
  resolutionSv?: string;
}

export interface MysteryLessonContext {
  title: string;
  hook: string;
  knownClues: MysteryLedgerEntry[];
  eligibleClue: Pick<MysteryClue, "id" | "revealSeed" | "publicNote"> | null;
  mustReveal: boolean;
  finaleUnlocked: boolean;
}

export interface MysteryLessonResult {
  clue_id: string;
  discovery_sv: string;
}

const LEVEL_RANK: Record<MysteryLevel, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

export function parseMysteryLevel(levelLabel: string): MysteryLevel {
  return (levelLabel.match(/\b(A1|A2|B1|B2|C1|C2)\b/i)?.[1].toUpperCase() as MysteryLevel | undefined) ?? "A1";
}

export async function initMysteryIfNeeded(): Promise<void> {
  const sql = getSql();
  const existing = await sql`SELECT 1 FROM fr_mystery WHERE id = 1`;
  if (existing.length) return;
  const bible = await generateMysteryBible();
  const publicState: MysteryPublicState = { revealedClueIds: [], ledger: [], theories: [], scenesSinceClue: 2 };
  await sql`
    INSERT INTO fr_mystery (id, bible, public_state, status)
    VALUES (1, ${sql.json(bible as never)}, ${sql.json(publicState as never)}, 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

export async function resetMystery(): Promise<void> {
  await getSql()`DELETE FROM fr_mystery WHERE id = 1`;
}

export async function getMysteryLessonContext(levelLabel: string, storyDay: number): Promise<MysteryLessonContext> {
  await initMysteryIfNeeded();
  const state = await readMystery();
  if (!state) throw new Error("Mysteriet kunde inte initieras.");
  const level = parseMysteryLevel(levelLabel);
  const next = state.bible.clues.find((clue) =>
    !state.publicState.revealedClueIds.includes(clue.id) && LEVEL_RANK[clue.minLevel] <= LEVEL_RANK[level]
  );
  const mayReveal = storyDay >= 1 && state.publicState.scenesSinceClue >= 2;
  const allCluesKnown = state.bible.clues.every((clue) => state.publicState.revealedClueIds.includes(clue.id));
  return {
    title: state.bible.title,
    hook: state.bible.hook,
    knownClues: state.publicState.ledger.slice(-8),
    eligibleClue: mayReveal && next ? { id: next.id, revealSeed: next.revealSeed, publicNote: next.publicNote } : null,
    mustReveal: Boolean(next && state.publicState.scenesSinceClue >= 5),
    finaleUnlocked: level === "C2" && allCluesKnown
  };
}

export async function recordMysteryScene(result?: MysteryLessonResult | null, eligibleClueId?: string): Promise<void> {
  const state = await readMystery();
  if (!state || state.status === "solved") return;
  const publicState = state.publicState;
  const planned = result && result.clue_id === eligibleClueId
    ? state.bible.clues.find((clue) => clue.id === result.clue_id && !publicState.revealedClueIds.includes(clue.id))
    : null;
  if (planned) {
    publicState.revealedClueIds.push(planned.id);
    publicState.ledger.push({
      clueId: planned.id,
      note: result?.discovery_sv?.trim() || planned.publicNote,
      discoveredAt: new Date().toISOString()
    });
    publicState.scenesSinceClue = 0;
  } else {
    publicState.scenesSinceClue += 1;
  }
  await savePublicState(publicState);
}

export async function addMysteryTheory(theory: string): Promise<void> {
  await initMysteryIfNeeded();
  const state = await readMystery();
  if (!state) return;
  state.publicState.theories = [...state.publicState.theories, theory.trim()].filter(Boolean).slice(-12);
  await savePublicState(state.publicState);
}

export async function solveMystery(summarySv: string): Promise<void> {
  const sql = getSql();
  const state = await readMystery();
  if (!state) return;
  state.publicState.resolutionSv = summarySv;
  await sql`
    UPDATE fr_mystery
    SET public_state = ${sql.json(state.publicState as never)}, status = 'solved', updated_at = now()
    WHERE id = 1
  `;
}

export async function renderMystery(): Promise<string> {
  await initMysteryIfNeeded();
  const state = await readMystery();
  if (!state) return "Mysteriet kunde inte öppnas.";
  const lines = [`🔎 *${state.bible.title}*`, "", `_${state.bible.hook}_`];
  if (!state.publicState.ledger.length) {
    lines.push("", "Du har ännu inte upptäckt den första riktiga ledtråden. Fortsätt resan.");
  } else {
    lines.push("", "*Detektivboken:*", ...state.publicState.ledger.map((entry, i) => `${i + 1}. ${entry.note}`));
  }
  if (state.publicState.theories.length) {
    lines.push("", "*Dina senaste teorier:*", ...state.publicState.theories.slice(-5).map((theory) => `• ${theory}`));
  }
  if (state.status === "solved") lines.push("", `✅ *Löst:* ${state.publicState.resolutionSv ?? "Du fann sanningen."}`);
  else {
    const { getLearnerLevel } = await import("./curriculum.js");
    const finaleUnlocked = (await getLearnerLevel()) === "C2" && state.bible.clues.every((clue) => state.publicState.revealedClueIds.includes(clue.id));
    lines.push("", "Skriv _min teori är …_ när du vill spara en tanke. Lösningen kräver språk, resor och bevis från hela berättelsen.");
    if (finaleUnlocked) lines.push("", "🔓 *Finalen är upplåst.* Presentera hela beviskedjan på franska med _Ma théorie est…_");
  }
  return lines.join("\n");
}

export async function getMysteryTutorContext(levelLabel: string): Promise<string> {
  const state = await readMystery();
  if (!state) return "";
  const level = parseMysteryLevel(levelLabel);
  const allCluesKnown = state.bible.clues.every((clue) => state.publicState.revealedClueIds.includes(clue.id));
  const finaleUnlocked = level === "C2" && allCluesKnown && state.status !== "solved";
  const publicLines = state.publicState.ledger.map((entry) => `- ${entry.note}`).join("\n") || "(inga ledtrådar ännu)";
  return [
    `MYSTERIUM: ${state.bible.title}`,
    `Kända ledtrådar:\n${publicLines}`,
    state.publicState.theories.length ? `Jimmys teorier:\n${state.publicState.theories.slice(-5).map((t) => `- ${t}`).join("\n")}` : "",
    finaleUnlocked
      ? "FINALEN ÄR UPPLÅST, men du känner inte den hemliga lösningen. Be Jimmy lämna sin fullständiga teori med frasen « Ma théorie est… »; en separat domare bedömer den."
      : "Finalen är låst. Bekräfta teorier utan att avslöja eller slutbedöma dem."
  ].filter(Boolean).join("\n")
}

/** Isolerad finaldomare. Den hemliga bibeln lämnar aldrig denna funktion. */
export async function judgeFinalTheory(theory: string): Promise<{ unlocked: boolean; solved: boolean; feedbackSv: string }> {
  const state = await readMystery();
  if (!state) return { unlocked: false, solved: false, feedbackSv: "Mysteriet har inte börjat." };
  const { getLearnerLevel } = await import("./curriculum.js");
  const allCluesKnown = state.bible.clues.every((clue) => state.publicState.revealedClueIds.includes(clue.id));
  const unlocked = (await getLearnerLevel()) === "C2" && allCluesKnown && state.status !== "solved";
  if (!unlocked) return { unlocked: false, solved: false, feedbackSv: "Slutteorin är ännu låst. Fler språksteg och ledtrådar återstår." };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { unlocked: true, solved: false, feedbackSv: "Slutdomaren kräver en aktiv språkmodell." };
  const model = process.env.FRENCH_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Du är en strikt mysteriedomare. Hemlig sanning: ${state.bible.truth}\nNödvändiga bevis: ${state.bible.finalProof.join("; ")}\nGodkänn bara om teorin identifierar kärnsanningen, motivet och den avgörande beviskedjan. Svara JSON {solved:boolean,feedback_sv:string}. Ge vid underkänt bara vilken sorts bevislucka som finns, aldrig lösningen.`
        },
        { role: "user", content: theory }
      ]
    })
  });
  if (!response.ok) return { unlocked: true, solved: false, feedbackSv: "Slutdomaren kunde inte nås just nu." };
  try {
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const verdict = JSON.parse(data.choices?.[0]?.message?.content || "{}") as { solved?: unknown; feedback_sv?: unknown };
    const solved = verdict.solved === true;
    const feedbackSv = typeof verdict.feedback_sv === "string" ? verdict.feedback_sv : "Beviskedjan kunde inte bedömas.";
    if (solved) await solveMystery(feedbackSv);
    return { unlocked: true, solved, feedbackSv };
  } catch {
    return { unlocked: true, solved: false, feedbackSv: "Slutdomarens svar kunde inte tolkas." };
  }
}

async function readMystery(): Promise<{ bible: MysteryBible; publicState: MysteryPublicState; status: "active" | "solved" } | null> {
  const rows = await getSql()`SELECT bible, public_state, status FROM fr_mystery WHERE id = 1 LIMIT 1`;
  if (!rows[0]) return null;
  return {
    bible: rows[0].bible as MysteryBible,
    publicState: rows[0].public_state as MysteryPublicState,
    status: rows[0].status as "active" | "solved"
  };
}

async function savePublicState(publicState: MysteryPublicState): Promise<void> {
  const sql = getSql();
  await sql`UPDATE fr_mystery SET public_state = ${sql.json(publicState as never)}, updated_at = now() WHERE id = 1`;
}

async function generateMysteryBible(): Promise<MysteryBible> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallbackBible();
  const model = process.env.FRENCH_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      max_tokens: 2600,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Skapa den hemliga bibeln till ett långsiktigt franskt mysterium kallat Le Carnet Bleu.",
            "Det börjar med en sliten blå anteckningsbok och väver samman vardagsliv, slott, regional kultur och spår från första/andra världskriget.",
            "Mysteriet ska handla om en mänsklig, bortglömd historia och beviskedja — inte magi eller en banal skatt.",
            "Lösningen ska vara fast, rättvis och möjlig att bevisa först med alla ledtrådar. Skapa falska tolkningar men inga falska ledtrådar.",
            "Skapa exakt 14 ledtrådar i ordning: 3 A1, 3 A2, 3 B1, 2 B2, 2 C1 och 1 C2. Varje ledtråd ska kunna dyka upp naturligt i många olika dynamiska scener.",
            "Svara JSON: {title,hook,truth,finalProof:string[],clues:[{id,minLevel,revealSeed,publicNote,secretMeaning}]}"
          ].join("\n")
        }
      ]
    })
  });
  if (!response.ok) return fallbackBible();
  try {
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return normalizeBible(JSON.parse(data.choices?.[0]?.message?.content || "{}"));
  } catch {
    return fallbackBible();
  }
}

function normalizeBible(value: unknown): MysteryBible {
  const o = (value ?? {}) as Record<string, unknown>;
  const clues = Array.isArray(o.clues) ? o.clues : [];
  const valid = clues.map((raw, index) => {
    const clue = raw as Record<string, unknown>;
    const minLevel = parseMysteryLevel(String(clue.minLevel ?? "A1"));
    return {
      id: typeof clue.id === "string" ? clue.id : `clue-${index + 1}`,
      minLevel,
      revealSeed: String(clue.revealSeed ?? "Ett nytt spår i den blå anteckningsboken blir synligt."),
      publicNote: String(clue.publicNote ?? "Ett nytt spår upptäcktes."),
      secretMeaning: String(clue.secretMeaning ?? "Spåret får betydelse tillsammans med senare bevis.")
    } satisfies MysteryClue;
  });
  const expectedCounts: Record<MysteryLevel, number> = { A1: 3, A2: 3, B1: 3, B2: 2, C1: 2, C2: 1 };
  const actualCounts = valid.reduce<Record<MysteryLevel, number>>(
    (counts, clue) => ({ ...counts, [clue.minLevel]: counts[clue.minLevel] + 1 }),
    { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 }
  );
  const uniqueIds = new Set(valid.map((clue) => clue.id));
  if (
    valid.length !== 14 ||
    uniqueIds.size !== valid.length ||
    !Array.isArray(o.finalProof) || o.finalProof.filter((item) => typeof item === "string").length < 3 ||
    Object.entries(expectedCounts).some(([level, count]) => actualCounts[level as MysteryLevel] !== count)
  ) return fallbackBible();
  return {
    title: typeof o.title === "string" ? o.title : "Le Carnet Bleu",
    hook: typeof o.hook === "string" ? o.hook : "En blå anteckningsbok bär på en glömd fransk historia.",
    truth: typeof o.truth === "string" ? o.truth : "Anteckningsboken bevarar en historia som avsiktligt splittrades mellan flera vittnen.",
    finalProof: Array.isArray(o.finalProof) ? o.finalProof.filter((x): x is string => typeof x === "string") : [],
    clues: valid
  };
}

function fallbackBible(): MysteryBible {
  const levels: MysteryLevel[] = ["A1","A1","A1","A2","A2","A2","B1","B1","B1","B2","B2","C1","C1","C2"];
  return {
    title: "Le Carnet Bleu",
    hook: "En sliten blå anteckningsbok verkar binda samman människor och platser som officiellt aldrig hörde ihop.",
    truth: "Boken skapades av motståndskuriren Élise Moreau för att återförena berättelsen om civila som räddade flyktingar och konstverk; namnen splittrades för att skydda de överlevande, inte för att gömma en skatt.",
    finalProof: ["identifiera Élises kodnyckel", "koppla vittnesmålen till rätt platser", "förklara varför namnen splittrades", "avfärda skatt-teorin"],
    clues: levels.map((minLevel, index) => ({
      id: `bleu-${String(index + 1).padStart(2, "0")}`,
      minLevel,
      revealSeed: `Ett nytt daterat fragment, symbol eller namn från den blå anteckningsboken blir begripligt (del ${index + 1}).`,
      publicNote: `Fragment ${index + 1} visar att anteckningsbokens platser och namn bildar en avsiktlig kedja.`,
      secretMeaning: `Del ${index + 1} stödjer beviskedjan kring Élise Moreaus skyddade vittnesmål.`
    }))
  };
}
