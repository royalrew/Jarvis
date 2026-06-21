import { getSql } from "../db.js";
import { upsertItemWithFacets, getModuleItems, type ItemType } from "./db.js";

/**
 * CEFR-ryggraden (A1→C2) + handplockat A1-innehåll.
 *
 * Rapporten (Geminis research) ger STRUKTUREN: nivåer, GERS-namn, studietimmar,
 * grammatisk kärna och teman. Den ger inga faktiska ord — dem handgör vi, med
 * försvenskade uttalstips (wazo). Bara A1 har riktigt innehåll i detta steg;
 * A2→C2 finns som karta så hela "0 → master"-vägen syns i /kurs.
 *
 * Progressiv upplåsning: bara första modulen är upplåst från start. Nästa modul
 * tänds när den föregående är "inlärd" (meaning-stabilitet över tröskel för de
 * flesta orden) — så det känns som en kurs, inte en lavin.
 */

export interface CurriculumItem {
  lemma: string;
  translation: string;
  wazo: string; // försvenskat uttalstips → svensk_ljudharmning
  type?: ItemType; // default 'lexeme'
  genre?: "m" | "f";
  ipa?: string;
}

export interface CurriculumModule {
  id: string; // t.ex. "A1.1"
  theme: string;
  grammar?: string;
  items: CurriculumItem[];
}

export interface CurriculumLevel {
  id: string; // "A1".."C2"
  title: string;
  gers: string; // GERS-benämning
  hours: string; // kumulativ studietid (indikativ)
  focus: string; // grammatisk kärna
  themes: string[];
  modules: CurriculumModule[];
}

/** Tröskel: meaning-stabilitet (dagar) då ett ord räknas som "på gång" (introducerat). */
const LEARN_THRESHOLD = 4;

export const CURRICULUM: CurriculumLevel[] = [
  {
    id: "A1",
    title: "Découverte – det första mötet",
    gers: "Elementär användare · Upptäckt",
    hours: "60–100 h",
    focus: "Presens, -er-verb + être/avoir/aller/faire/venir, artiklar (le/la/un/une + partitiv), genus/numerus, ne…pas, frågeord, nasala vokaler.",
    themes: ["Hälsningar", "Presentera dig", "Siffror", "Vardag", "Frågor & negation"],
    modules: [
      {
        id: "A1.1",
        theme: "Hälsningar & artighet",
        grammar: "Fasta artighetsuttryck – ingen böjning än.",
        items: [
          { lemma: "bonjour", translation: "god dag / hej", wazo: "bonsjor", ipa: "bɔ̃ʒuʁ" },
          { lemma: "bonsoir", translation: "god kväll", wazo: "bonsoar", ipa: "bɔ̃swaʁ" },
          { lemma: "salut", translation: "hej / hejdå (informellt)", wazo: "saly", ipa: "saly" },
          { lemma: "au revoir", translation: "adjö / hej då", wazo: "o-rövoar", ipa: "o ʁəvwaʁ" },
          { lemma: "merci", translation: "tack", wazo: "mersi", ipa: "mɛʁsi" },
          { lemma: "s'il vous plaît", translation: "tack / var snäll", wazo: "sil-vu-plä", ipa: "sil vu plɛ" },
          { lemma: "de rien", translation: "ingen orsak", wazo: "dö-rjäng", ipa: "də ʁjɛ̃" },
          { lemma: "pardon", translation: "förlåt / ursäkta", wazo: "pardång", ipa: "paʁdɔ̃" },
          { lemma: "excusez-moi", translation: "ursäkta mig", wazo: "exkyse-moa", ipa: "ɛkskyze mwa" },
          { lemma: "oui", translation: "ja", wazo: "wi", ipa: "wi" },
          { lemma: "non", translation: "nej", wazo: "nång", ipa: "nɔ̃" },
          { lemma: "à bientôt", translation: "vi ses snart", wazo: "a-bjäntå", ipa: "a bjɛ̃to" }
        ]
      },
      {
        id: "A1.2",
        theme: "Presentera dig",
        grammar: "Subjektspronomen + presens av être (att vara).",
        items: [
          { lemma: "je", translation: "jag", wazo: "jö", ipa: "ʒə" },
          { lemma: "tu", translation: "du", wazo: "ty", ipa: "ty" },
          { lemma: "il", translation: "han / den", wazo: "il", ipa: "il" },
          { lemma: "elle", translation: "hon / den", wazo: "ell", ipa: "ɛl" },
          { lemma: "je m'appelle", translation: "jag heter", wazo: "jö-mapell", ipa: "ʒə mapɛl" },
          { lemma: "comment tu t'appelles ?", translation: "vad heter du?", wazo: "komang-ty-tapell", ipa: "kɔmɑ̃ ty tapɛl" },
          { lemma: "enchanté", translation: "trevligt att träffas", wazo: "angschangte", ipa: "ɑ̃ʃɑ̃te" },
          { lemma: "je suis", translation: "jag är", wazo: "jö-svi", ipa: "ʒə sɥi" },
          { lemma: "tu es", translation: "du är", wazo: "ty-e", ipa: "ty ɛ" }
        ]
      },
      {
        id: "A1.3",
        theme: "Siffror 0–10 + 20",
        grammar: "Grundtal.",
        items: [
          { lemma: "zéro", translation: "noll", wazo: "sero", ipa: "zeʁo" },
          { lemma: "un", translation: "en / ett (1)", wazo: "öng", ipa: "ɛ̃" },
          { lemma: "deux", translation: "två", wazo: "dö", ipa: "dø" },
          { lemma: "trois", translation: "tre", wazo: "troa", ipa: "tʁwa" },
          { lemma: "quatre", translation: "fyra", wazo: "katr", ipa: "katʁ" },
          { lemma: "cinq", translation: "fem", wazo: "sängk", ipa: "sɛ̃k" },
          { lemma: "six", translation: "sex", wazo: "sis", ipa: "sis" },
          { lemma: "sept", translation: "sju", wazo: "sett", ipa: "sɛt" },
          { lemma: "huit", translation: "åtta", wazo: "üitt", ipa: "ɥit" },
          { lemma: "neuf", translation: "nio", wazo: "nöf", ipa: "nœf" },
          { lemma: "dix", translation: "tio", wazo: "diss", ipa: "dis" },
          { lemma: "vingt", translation: "tjugo", wazo: "väng", ipa: "vɛ̃" }
        ]
      },
      {
        id: "A1.4",
        theme: "Nyckelverben (presens)",
        grammar: "De fem oregelbundna högfrekvensverben – språkets motor.",
        items: [
          { lemma: "être", translation: "att vara", wazo: "ätr", type: "grammar", ipa: "ɛtʁ" },
          { lemma: "avoir", translation: "att ha", wazo: "avoar", type: "grammar", ipa: "avwaʁ" },
          { lemma: "aller", translation: "att gå / att åka", wazo: "ale", type: "grammar", ipa: "ale" },
          { lemma: "faire", translation: "att göra", wazo: "fär", type: "grammar", ipa: "fɛʁ" },
          { lemma: "venir", translation: "att komma", wazo: "vönir", type: "grammar", ipa: "vəniʁ" }
        ]
      },
      {
        id: "A1.5",
        theme: "Artiklar",
        grammar: "Bestämd, obestämd och partitiv artikel – styrs av genus/antal.",
        items: [
          { lemma: "le / la / les", translation: "bestämd artikel (den/det/de)", wazo: "lö / la / le", type: "grammar" },
          { lemma: "un / une / des", translation: "obestämd artikel (en/ett/några)", wazo: "öng / yn / de", type: "grammar" },
          { lemma: "du / de la", translation: "partitiv artikel (obestämd mängd)", wazo: "dy / dö-la", type: "grammar" }
        ]
      },
      {
        id: "A1.6",
        theme: "Vardagsord",
        grammar: "Vanliga substantiv – lär in med genus (m/f).",
        items: [
          { lemma: "maison", translation: "hus", wazo: "mäsong", genre: "f", ipa: "mɛzɔ̃" },
          { lemma: "eau", translation: "vatten", wazo: "o", genre: "f", ipa: "o" },
          { lemma: "pain", translation: "bröd", wazo: "päng", genre: "m", ipa: "pɛ̃" },
          { lemma: "café", translation: "kaffe", wazo: "kafe", genre: "m", ipa: "kafe" },
          { lemma: "ami", translation: "vän", wazo: "ami", genre: "m", ipa: "ami" },
          { lemma: "jour", translation: "dag", wazo: "zjor", genre: "m", ipa: "ʒuʁ" },
          { lemma: "temps", translation: "tid / väder", wazo: "tang", genre: "m", ipa: "tɑ̃" },
          { lemma: "femme", translation: "kvinna", wazo: "famm", genre: "f", ipa: "fam" },
          { lemma: "homme", translation: "man", wazo: "omm", genre: "m", ipa: "ɔm" },
          { lemma: "enfant", translation: "barn", wazo: "angfang", genre: "m", ipa: "ɑ̃fɑ̃" },
          { lemma: "aujourd'hui", translation: "idag", wazo: "o-zjor-dwi", ipa: "oʒuʁdɥi" }
        ]
      },
      {
        id: "A1.7",
        theme: "Frågor & negation",
        grammar: "Frågeord, est-ce que och den omslutande negationen ne…pas.",
        items: [
          { lemma: "où", translation: "var / vart", wazo: "u", type: "grammar", ipa: "u" },
          { lemma: "quand", translation: "när", wazo: "kang", type: "grammar", ipa: "kɑ̃" },
          { lemma: "comment", translation: "hur", wazo: "komang", type: "grammar", ipa: "kɔmɑ̃" },
          { lemma: "pourquoi", translation: "varför", wazo: "purkoa", type: "grammar", ipa: "puʁkwa" },
          { lemma: "qui", translation: "vem", wazo: "ki", type: "grammar", ipa: "ki" },
          { lemma: "combien", translation: "hur mycket / hur många", wazo: "kombjäng", type: "grammar", ipa: "kɔ̃bjɛ̃" },
          { lemma: "ne... pas", translation: "negation (inte) – omsluter verbet", wazo: "nö … pa", type: "grammar", ipa: "nə pa" },
          { lemma: "est-ce que", translation: "frågemarkör (inleder ja/nej-fråga)", wazo: "äs-kö", type: "grammar", ipa: "ɛs kə" }
        ]
      }
    ]
  },
  {
    id: "A2",
    title: "Survie – basal autonomi",
    gers: "Elementär användare · Överlevnad",
    hours: "160–200 h",
    focus: "Passé composé vs imparfait, futur proche, objektpronomen (le/la/lui/leur), reflexiva verb, konnektorer (et/mais/parce que/donc).",
    themes: ["Det förflutna", "Resor & rutiner", "Beskriva bakgrund"],
    modules: []
  },
  {
    id: "B1",
    title: "Seuil – subjektivitet & argument",
    gers: "Självständig användare · Tröskel",
    hours: "350–400 h",
    focus: "Subjonctif présent, plus-que-parfait, Si-satser typ 2, indirekt tal, relativa pronomen (qui/que/où/dont).",
    themes: ["Åsikter & känslor", "Berätta sammanhängande", "Hypoteser"],
    modules: []
  },
  {
    id: "B2",
    title: "Indépendant – akademisk tröskel",
    gers: "Självständig användare · Oberoende",
    hours: "500–600 h",
    focus: "Passiv form, gérondif/participe présent, conditionnel passé, lequel/auquel/duquel, avancerade konnektorer.",
    themes: ["Argumenterande essä", "Abstrakta ämnen", "Debatt"],
    modules: []
  },
  {
    id: "C1",
    title: "Autonome – akademisk diskurs",
    gers: "Avancerad användare · Autonom",
    hours: "700–800 h",
    focus: "Nominalisering, stilistisk inversion, dokumentsyntes, komplexa diskursmarkörer.",
    themes: ["Vetenskap & bioetik", "Sociologi & arbetsrätt", "Ekologi", "Lingvistik & identitet"],
    modules: []
  },
  {
    id: "C2",
    title: "Maîtrise – fulländning",
    gers: "Avancerad användare · Mästare",
    hours: "1000–1200 h",
    focus: "Idiom & litterära allusioner, registerväxling, ironi & ordlekar, modersmålsliknande precision.",
    themes: ["Litterära referenser", "Retorik", "Register & verlan"],
    modules: []
  }
];

// --------------------------------------------------------------------------
// Seed
// --------------------------------------------------------------------------

/** Seedar hela läroplanens innehåll (idempotent) och kör progressiv upplåsning. */
export async function seedCurriculum(): Promise<{ items: number; modules: number }> {
  const sql = getSql();
  let itemCount = 0;
  let moduleCount = 0;
  let seq = 0;

  const firstModule = CURRICULUM[0]?.modules[0]?.id;

  for (const level of CURRICULUM) {
    for (const mod of level.modules) {
      moduleCount++;
      for (const it of mod.items) {
        seq++;
        itemCount++;
        const itemId = await upsertItemWithFacets(
          it.lemma,
          {
            translation: it.translation,
            svensk_ljudharmning: it.wazo,
            genre: it.genre,
            ipa: it.ipa
          },
          it.type ?? "lexeme"
        );
        await sql`
          UPDATE fr_items SET level = ${level.id}, module = ${mod.id}, seq = ${seq}
          WHERE id = ${itemId}
        `;
        // Lås bara orörda kursord utanför första modulen (skyddar redan påbörjad progress).
        if (mod.id !== firstModule) {
          await sql`
            UPDATE fr_items SET unlocked = false
            WHERE id = ${itemId}
              AND NOT EXISTS (SELECT 1 FROM fr_facets f WHERE f.item_id = ${itemId} AND f.reps > 0)
          `;
        }
      }
    }
  }

  await advanceCurriculum();
  return { items: itemCount, modules: moduleCount };
}

/** Seedar bara om läroplanen saknas (för boot). */
export async function seedCurriculumIfNeeded(): Promise<void> {
  const sql = getSql();
  const rows = await sql`SELECT 1 FROM fr_items WHERE level IS NOT NULL LIMIT 1`;
  if (rows.length === 0) {
    const { items, modules } = await seedCurriculum();
    console.log(`[Français] Läroplan seedad: ${items} ord i ${modules} moduler.`);
  } else {
    // Säkerställ ändå att upplåsningen är i synk vid boot.
    await advanceCurriculum();
  }
}

// --------------------------------------------------------------------------
// Progressiv upplåsning
// --------------------------------------------------------------------------

interface ModuleStat {
  module: string;
  seq: number;
  total: number;
  learned: number; // meaning-stabilitet >= LEARN_THRESHOLD
  mastered: number; // production+pronunciation båda >= MASTERY_STABILITY
  unlocked: boolean;
}

async function getModuleStats(): Promise<ModuleStat[]> {
  const sql = getSql();
  const rows = await sql`
    WITH per_item AS (
      SELECT i.id, i.module, i.seq, i.unlocked, i.mastered,
        MAX(CASE WHEN f.kind = 'meaning' THEN f.stability END) AS mean_s
      FROM fr_items i JOIN fr_facets f ON f.item_id = i.id
      WHERE i.module IS NOT NULL
      GROUP BY i.id, i.module, i.seq, i.unlocked, i.mastered
    )
    SELECT module,
      MIN(seq) AS seq,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE COALESCE(mean_s,0) >= ${LEARN_THRESHOLD})::int AS learned,
      COUNT(*) FILTER (WHERE mastered)::int AS mastered,
      BOOL_OR(unlocked) AS unlocked
    FROM per_item
    GROUP BY module
    ORDER BY MIN(seq) ASC
  `;
  return rows.map((r) => ({
    module: r.module as string,
    seq: Number(r.seq),
    total: Number(r.total),
    learned: Number(r.learned),
    mastered: Number(r.mastered),
    unlocked: Boolean(r.unlocked)
  }));
}

/**
 * Tänder första modulen + varje modul vars föregångare läraren godkänt
 * (ALLA ord behärskade — mastered). Stannar vid första icke-godkända modulen
 * — hoppar aldrig över. Idempotent.
 */
export async function advanceCurriculum(): Promise<string[]> {
  const sql = getSql();
  const stats = await getModuleStats();
  if (stats.length === 0) return [];

  const toUnlock: string[] = [];
  let prevPassed = true; // första modulen ska alltid vara öppen

  for (const mod of stats) {
    if (prevPassed && !mod.unlocked) toUnlock.push(mod.module);
    const passed = mod.total > 0 && mod.mastered === mod.total;
    prevPassed = (mod.unlocked || prevPassed) && passed;
  }

  for (const module of toUnlock) {
    await sql`UPDATE fr_items SET unlocked = true WHERE module = ${module}`;
  }
  return toUnlock;
}

/** Lägsta upplåsta modul som ännu inte är helt godkänd (lärarens "nuvarande del"). */
export async function getCurrentModule(): Promise<{ module: string; theme: string } | null> {
  const stats = await getModuleStats();
  const current = stats.find((m) => m.unlocked && m.mastered < m.total);
  if (!current) return null;
  for (const level of CURRICULUM) {
    const mod = level.modules.find((m) => m.id === current.module);
    if (mod) return { module: mod.id, theme: mod.theme };
  }
  return { module: current.module, theme: "" };
}

// --------------------------------------------------------------------------
// /kurs – kartan med din position
// --------------------------------------------------------------------------

export async function renderCourseMap(): Promise<string> {
  const stats = await getModuleStats();
  const statByModule = new Map(stats.map((s) => [s.module, s]));
  const current = await getCurrentModule();

  const lines: string[] = ["🇫🇷 *Din franska resa — 0 → master*", ""];

  for (const level of CURRICULUM) {
    const levelModules = level.modules.map((m) => statByModule.get(m.id)).filter(Boolean) as ModuleStat[];
    const hasContent = level.modules.length > 0;
    const total = levelModules.reduce((s, m) => s + m.total, 0);
    const mastered = levelModules.reduce((s, m) => s + m.mastered, 0);
    const anyUnlocked = levelModules.some((m) => m.unlocked);

    const badge = !hasContent ? "🗺️" : anyUnlocked ? "▶️" : "🔒";
    const prog = hasContent ? ` — ${mastered}/${total} behärskade` : "";
    lines.push(`${badge} *${level.id} · ${level.title}* (${level.hours})${prog}`);

    if (hasContent && anyUnlocked) {
      for (const m of level.modules) {
        const st = statByModule.get(m.id);
        if (!st) continue;
        const done = st.mastered === st.total;
        const mark = !st.unlocked ? "🔒" : done ? "✅" : "▶️";
        lines.push(`   ${mark} ${m.id} ${m.theme} — ${st.mastered}/${st.total} JA`);
      }
    } else if (!hasContent) {
      lines.push(`   _${level.focus}_`);
    }
    lines.push("");
  }

  // Per-ord-status för den del du står på just nu (lärarens fokus).
  if (current) {
    const items = await getModuleItems(current.module);
    lines.push(`📍 *Nu: ${current.module} ${current.theme}* — behärskar du orden?`);
    for (const it of items) {
      const mark = it.mastered ? "✅ JA" : "⬜ inte än";
      lines.push(`   ${mark} · ${it.lemma} = ${it.meta.translation}`);
    }
    lines.push("", "Redo? Skriv /avstämning så prövar läraren dig (stavning + uttal).");
  } else {
    lines.push("Skriv /lektion för att öva, eller prata bara franska med mig.");
  }

  return lines.join("\n").trim();
}
