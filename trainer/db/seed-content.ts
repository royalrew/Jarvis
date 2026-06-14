/**
 * Seed-innehåll för Nivåer (tracks) och Kampanj (tiers).
 * Källa: Jimmys svenska seed-JSON ("Vägen till flaggan").
 * Tiers låses sekventiellt: tier i öppnas när tier (i-1).endboss är besegrad.
 */

export type TrackSeed = {
  id: string;
  name: string;
  goalLabel: string;
  levels: { idx: number; name: string; target: string; elite?: boolean }[];
};

export type TierSeed = {
  id: string;
  idx: number;
  name: string;
  theme: string;
  weeks: { id: string; idx: number; boss: string; focus: string; criteria: string }[];
  endboss: { id: string; name: string; criteria: string[] };
};

export const TRACKS: TrackSeed[] = [
  {
    id: "hand",
    name: "Handstativ",
    goalLabel: "One-arm handstand",
    levels: [
      { idx: 1, name: "Aktiv planka", target: "45s stabil" },
      { idx: 2, name: "Mage mot vägg", target: "30s stabil" },
      { idx: 3, name: "Väggstående (rygg mot vägg)", target: "60s" },
      { idx: 4, name: "Frigående handstativ", target: "10s" },
      { idx: 5, name: "Frigående + förflyttning", target: "30s / småsteg" },
      { idx: 6, name: "Pike push-ups", target: "3×10" },
      { idx: 7, name: "Elevated pike push-ups", target: "3×8" },
      { idx: 8, name: "HSPU mot vägg", target: "4×5" },
      { idx: 9, name: "Frigående HSPU", target: "1 ren" },
      { idx: 10, name: "En-arm assisterad (vägg)", target: "10s" },
      { idx: 11, name: "One-arm handstand", target: "håll", elite: true },
    ],
  },
  {
    id: "drag",
    name: "Drag",
    goalLabel: "One-arm pull-up",
    levels: [
      { idx: 1, name: "Aktivt häng", target: "30s häng" },
      { idx: 2, name: "Negativa pull-ups / rows", target: "4×5" },
      { idx: 3, name: "Pull-ups strikt", target: "4×8" },
      { idx: 4, name: "Viktade pull-ups", target: "4×5 +10kg" },
      { idx: 5, name: "Archer pull-ups", target: "4×4/sida" },
      { idx: 6, name: "En-arms negativ", target: "5×5s sänk" },
      { idx: 7, name: "En-arms assisterad (finger/handduk)", target: "3×3" },
      { idx: 8, name: "One-arm pull-up", target: "1 ren (viktväst/extravikt ok)", elite: true },
    ],
  },
  {
    id: "front",
    name: "Front Lever",
    goalLabel: "Full front lever",
    levels: [
      { idx: 1, name: "Scapula-pulls", target: "3×10" },
      { idx: 2, name: "Skin the cat", target: "3×3" },
      { idx: 3, name: "Tuck front lever", target: "4×10s" },
      { idx: 4, name: "Advanced tuck", target: "4×8s" },
      { idx: 5, name: "Ett ben utsträckt", target: "4×6s" },
      { idx: 6, name: "Straddle front lever", target: "4×5s" },
      { idx: 7, name: "Full front lever", target: "3×5s (viktväst ok)", elite: true },
    ],
  },
  {
    id: "planche",
    name: "Planche",
    goalLabel: "Planche → Maltese",
    levels: [
      { idx: 1, name: "Armhävningar på knä", target: "3×10" },
      { idx: 2, name: "Planche-lutning", target: "4×20s" },
      { idx: 3, name: "Frog stand", target: "30s" },
      { idx: 4, name: "Tuck planche", target: "4×10s" },
      { idx: 5, name: "Advanced tuck planche", target: "4×8s" },
      { idx: 6, name: "Straddle planche", target: "3×5s" },
      { idx: 7, name: "Full planche", target: "3×3s" },
      { idx: 8, name: "Planche push-ups", target: "3×3 (viktväst ok)", elite: true },
    ],
  },
  {
    id: "flag",
    name: "Människoflaggan",
    goalLabel: "Full flagga",
    levels: [
      { idx: 1, name: "Sidoplanka", target: "45s/sida" },
      { idx: 2, name: "Flaggstöd", target: "30s/sida" },
      { idx: 3, name: "Vertikal chamber-flagga", target: "5×10s" },
      { idx: 4, name: "Tuck-flagga", target: "5×8s" },
      { idx: 5, name: "Ett ben utsträckt", target: "4×6s" },
      { idx: 6, name: "Straddle-flagga", target: "4×5s" },
      { idx: 7, name: "Full flagga", target: "3×5s (viktväst ok)", elite: true },
    ],
  },
  {
    id: "core",
    name: "Bål",
    goalLabel: "Dragon flag",
    levels: [
      { idx: 1, name: "Liggande knälyft", target: "3×10" },
      { idx: 2, name: "Hollow hold", target: "40s" },
      { idx: 3, name: "Hängande knälyft", target: "3×12" },
      { idx: 4, name: "Hängande raka benlyft", target: "3×8" },
      { idx: 5, name: "L-sit", target: "10s" },
      { idx: 6, name: "Negativ dragon flag", target: "5×5s sänk" },
      { idx: 7, name: "Tuck dragon flag", target: "4×8" },
      { idx: 8, name: "Full dragon flag", target: "3×6 (viktväst ok)", elite: true },
    ],
  },
  {
    id: "mu",
    name: "Muscle-up",
    goalLabel: "Strikt muscle-up",
    levels: [
      { idx: 1, name: "Vanliga pull-ups", target: "3 reps" },
      { idx: 2, name: "Strikta pull-ups", target: "8 reps" },
      { idx: 3, name: "Explosiva pull-ups till bröstet", target: "5×3" },
      { idx: 4, name: "Höga pull-ups (mot midjan)", target: "5×3" },
      { idx: 5, name: "Negativ muscle-up", target: "4×3" },
      { idx: 6, name: "Muscle-up med band", target: "4×3" },
      { idx: 7, name: "Strikt bar muscle-up", target: "1 ren (viktväst/extravikt ok)", elite: true },
    ],
  },
  {
    id: "rings",
    name: "Ringar",
    goalLabel: "Iron cross",
    levels: [
      { idx: 1, name: "Support assisterad", target: "30s" },
      { idx: 2, name: "Dips på barren", target: "3×8" },
      { idx: 3, name: "Support-hållning på ringar", target: "30s" },
      { idx: 4, name: "Ring dips", target: "4×8" },
      { idx: 5, name: "RTO support (utåtvridna)", target: "20s" },
      { idx: 6, name: "Ring-fly negativ", target: "5×5s" },
      { idx: 7, name: "Iron cross med band", target: "3×5s" },
      { idx: 8, name: "Iron cross", target: "håll", elite: true },
    ],
  },
];

export const TIERS: TierSeed[] = [
  {
    id: "t1",
    idx: 1,
    name: "Nybörjare",
    theme: "Bygg grundstyrkan och första kontrollen",
    weeks: [
      { id: "t1w1", idx: 1, boss: "Formväktaren", focus: "Lär kroppen spänna rätt och hänga fullt ut", criteria: "3 strikta pull-ups · 20s hollow hold · 20s handstativ mage mot vägg" },
      { id: "t1w2", idx: 2, boss: "Pressporten", focus: "Väck pressen — dipp och armhävning", criteria: "8 raka armhävningar · 20s support-hållning i toppen av dippen" },
      { id: "t1w3", idx: 3, boss: "Hänget", focus: "Greppstyrka och bålen i hängande läge", criteria: "8 hängande knälyft · 40s aktiv häng" },
      { id: "t1w4", idx: 4, boss: "Sidan", focus: "Lateral bål — flaggans fundament", criteria: "30s side plank/sida · 5 dips (band ok)" },
      { id: "t1w5", idx: 5, boss: "Lutaren", focus: "Rakarmsstyrka — planche- och handstativlinjen", criteria: "20s pseudo planche-lutning · 40s handstativ rygg mot vägg" },
      { id: "t1w6", idx: 6, boss: "Krafttaget", focus: "Samla ihop — rent och starkt", criteria: "6 strikta pull-ups · 5 rena dips utan band" },
    ],
    endboss: {
      id: "t1boss",
      name: "Grundvakten",
      criteria: ["8 strikta pull-ups", "8 dips utan band", "45s side plank/sida", "10s tuck front lever", "40s väggstående handstativ", "20s pseudo planche-lutning"],
    },
  },
  {
    id: "t2",
    idx: 2,
    name: "Medel",
    theme: "Dina första riktiga skills tar form",
    weeks: [
      { id: "t2w1", idx: 1, boss: "Hängbron", focus: "Förläng front lever-hållet", criteria: "tuck front lever 4×12s · advanced tuck 3×6s" },
      { id: "t2w2", idx: 2, boss: "Väggsläppet", focus: "Bort från väggen i handstativ", criteria: "frigående handstativ 5s · väggstående 60s" },
      { id: "t2w3", idx: 3, boss: "Flaggviskaren", focus: "Första flaggkänslan", criteria: "vertikal chamber-flagga 5×10s · tuck-flagga 3×5s" },
      { id: "t2w4", idx: 4, boss: "Explosionen", focus: "Bygg muscle-up-drivet", criteria: "explosiva pull-ups till bröstet 5×3 · 1 negativ muscle-up" },
      { id: "t2w5", idx: 5, boss: "Enbenständaren", focus: "Benstyrka och balans", criteria: "assisterad pistol 3×6/ben · split squats 3×10" },
      { id: "t2w6", idx: 6, boss: "Lutarna II", focus: "Planche-progression", criteria: "tuck planche 3×8s · pseudo planche-lutning 30s" },
    ],
    endboss: {
      id: "t2boss",
      name: "Skillväktaren",
      criteria: ["20s tuck front lever", "10s frigående handstativ", "8s tuck-flagga", "1 negativ muscle-up", "5 assisterade pistols/ben"],
    },
  },
  {
    id: "t3",
    idx: 3,
    name: "Avancerad",
    theme: "Straddle-nivå och muscle-up",
    weeks: [
      { id: "t3w1", idx: 1, boss: "Benutsträckaren", focus: "Ett ben ut i lever och flagga", criteria: "front lever ett ben 4×6s · flagga ett ben 4×5s" },
      { id: "t3w2", idx: 2, boss: "Muscle-up-porten", focus: "Första rena muscle-up", criteria: "muscle-up med band 4×3 · 1 strikt muscle-up" },
      { id: "t3w3", idx: 3, boss: "Straddlestarten", focus: "Öppna upp till straddle", criteria: "straddle front lever 4×4s · straddle-flagga 3×4s" },
      { id: "t3w4", idx: 4, boss: "Upp och ner", focus: "Press i handstativ", criteria: "HSPU mot vägg 4×5 · frigående handstativ 20s" },
      { id: "t3w5", idx: 5, boss: "Draken", focus: "Full dragon flag", criteria: "tuck dragon flag 4×8 · full dragon flag 3×4" },
      { id: "t3w6", idx: 6, boss: "Planchejägaren", focus: "Advanced tuck → straddle planche", criteria: "advanced tuck planche 4×8s · straddle planche 2×4s" },
    ],
    endboss: {
      id: "t3boss",
      name: "Vågmästaren",
      criteria: ["5s straddle front lever", "1 strikt muscle-up", "HSPU mot vägg 5×", "5s straddle-flagga", "full dragon flag 6×"],
    },
  },
  {
    id: "t4",
    idx: 4,
    name: "Elit",
    theme: "De stenhårda bossarna — livslånga mål",
    weeks: [
      { id: "t4w1", idx: 1, boss: "Flaggan reser sig", focus: "Människoflaggan", criteria: "straddle-flagga 4×5s · full flagga 3×3s" },
      { id: "t4w2", idx: 2, boss: "Levern låser", focus: "Full front lever", criteria: "straddle front lever 4×6s · full front lever 3×5s" },
      { id: "t4w3", idx: 3, boss: "Planschen", focus: "Full planche", criteria: "straddle planche 3×5s · full planche 3×3s" },
      { id: "t4w4", idx: 4, boss: "Enarmsdraget", focus: "One-arm pull-up", criteria: "en-arms negativ 5×5s · en-arms assisterad 3×3" },
      { id: "t4w5", idx: 5, boss: "Korset", focus: "Iron cross", criteria: "iron cross med band 3×5s · iron cross håll" },
      { id: "t4w6", idx: 6, boss: "Enarmsståndet", focus: "One-arm handstand", criteria: "en-arm assisterad 15s · one-arm handstand håll" },
    ],
    endboss: {
      id: "t4boss",
      name: "Eliten",
      criteria: ["Full front lever", "Människoflaggan", "Full planche", "One-arm pull-up", "Iron cross", "One-arm handstand"],
    },
  },
];
