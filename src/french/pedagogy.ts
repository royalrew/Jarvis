export interface LessonPedagogy {
  level: string;
  gentleStart: boolean;
  targetWords: number;
  leechWords: number;
  maxNewItems: number;
  sentenceStarters: number;
  frenchMinLines: number;
  frenchMaxLines: number;
  frenchMaxWords: number;
  wordBankMax: number;
  responseMaxWords: number;
  translateAllFrench: boolean;
  guidance: string;
}

export interface PracticeEvidence {
  meaningStability: number;
  productionStability: number;
  pronunciationStability: number;
}

/** Mjukstarten släpper först när tre hälsningsuttryck har förståtts och producerats. */
export function needsGentleStart(moduleId: string | null, items: PracticeEvidence[]): boolean {
  if (moduleId !== "A1.1") return false;
  const demonstrated = items.filter((item) =>
    item.meaningStability >= 0.5 && Math.max(item.productionStability, item.pronunciationStability) >= 0.5
  ).length;
  return demonstrated < 3;
}

/** Deterministisk belastningsbudget. Längre lektion får aldrig betyda ordlavin. */
export function lessonPedagogy(levelLabel: string, gentleStart = false): LessonPedagogy {
  const level = levelLabel.match(/\b(A1|A2|B1|B2|C1|C2)\b/i)?.[1].toUpperCase() ?? "A1";
  if (gentleStart) {
    return {
      level,
      gentleStart: true,
      targetWords: 1,
      leechWords: 0,
      maxNewItems: 0,
      sentenceStarters: 1,
      frenchMinLines: 2,
      frenchMaxLines: 3,
      frenchMaxWords: 12,
      wordBankMax: 1,
      responseMaxWords: 4,
      translateAllFrench: true,
      guidance: "Absolut nybörjare: berättelsen får vara rik på svenska men franskan är en mikrodos. Eleven ska förstå varje franskt ord innan han svarar."
    };
  }

  const policies: Record<string, Omit<LessonPedagogy, "level">> = {
    A1: { gentleStart: false, targetWords: 3, leechWords: 1, maxNewItems: 2, sentenceStarters: 3, frenchMinLines: 4, frenchMaxLines: 7, frenchMaxWords: 70, wordBankMax: 5, responseMaxWords: 10, translateAllFrench: true, guidance: "Tydlig svensk stöttning; korta franska meningar och mycket återanvändning." },
    A2: { gentleStart: false, targetWords: 4, leechWords: 1, maxNewItems: 2, sentenceStarters: 2, frenchMinLines: 6, frenchMaxLines: 9, frenchMaxWords: 120, wordBankMax: 6, responseMaxWords: 20, translateAllFrench: false, guidance: "Franskan dominerar dialogen; svenska för nyanser och ny grammatik." },
    B1: { gentleStart: false, targetWords: 5, leechWords: 2, maxNewItems: 3, sentenceStarters: 1, frenchMinLines: 7, frenchMaxLines: 11, frenchMaxWords: 180, wordBankMax: 6, responseMaxWords: 40, translateAllFrench: false, guidance: "Mest franska; svenska bara för precisa förklaringar." },
    B2: { gentleStart: false, targetWords: 6, leechWords: 2, maxNewItems: 3, sentenceStarters: 1, frenchMinLines: 8, frenchMaxLines: 12, frenchMaxWords: 240, wordBankMax: 6, responseMaxWords: 60, translateAllFrench: false, guidance: "Naturlig franska med idiom och begränsad svensk stöttning." },
    C1: { gentleStart: false, targetWords: 7, leechWords: 2, maxNewItems: 4, sentenceStarters: 0, frenchMinLines: 9, frenchMaxLines: 14, frenchMaxWords: 320, wordBankMax: 4, responseMaxWords: 100, translateAllFrench: false, guidance: "Nästan full immersion med nyanserad, autentisk franska." },
    C2: { gentleStart: false, targetWords: 8, leechWords: 2, maxNewItems: 4, sentenceStarters: 0, frenchMinLines: 10, frenchMaxLines: 16, frenchMaxWords: 420, wordBankMax: 3, responseMaxWords: 160, translateAllFrench: false, guidance: "Full immersion och stilistisk precision." }
  };
  return { level, ...policies[level] };
}
