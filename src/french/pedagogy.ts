export interface LessonPedagogy {
  level: string;
  targetWords: number;
  leechWords: number;
  maxNewItems: number;
  sentenceStarters: number;
  guidance: string;
}

/** Deterministisk belastningsbudget. Längre lektion får aldrig betyda ordlavin. */
export function lessonPedagogy(levelLabel: string, firstScene = false): LessonPedagogy {
  const level = levelLabel.match(/\b(A1|A2|B1|B2|C1|C2)\b/i)?.[1].toUpperCase() ?? "A1";
  if (firstScene) {
    return {
      level,
      targetWords: 2,
      leechWords: 0,
      maxNewItems: 1,
      sentenceStarters: 3,
      guidance: "Total nybörjare: mycket svensk stöttning, mycket kort franska och omedelbart användbara fraser."
    };
  }

  const policies: Record<string, Omit<LessonPedagogy, "level">> = {
    A1: { targetWords: 3, leechWords: 1, maxNewItems: 2, sentenceStarters: 3, guidance: "Tydlig svensk stöttning; korta franska meningar och mycket återanvändning." },
    A2: { targetWords: 4, leechWords: 1, maxNewItems: 2, sentenceStarters: 2, guidance: "Franskan dominerar dialogen; svenska för nyanser och ny grammatik." },
    B1: { targetWords: 5, leechWords: 2, maxNewItems: 3, sentenceStarters: 1, guidance: "Mest franska; svenska bara för precisa förklaringar." },
    B2: { targetWords: 6, leechWords: 2, maxNewItems: 3, sentenceStarters: 1, guidance: "Naturlig franska med idiom och begränsad svensk stöttning." },
    C1: { targetWords: 7, leechWords: 2, maxNewItems: 4, sentenceStarters: 0, guidance: "Nästan full immersion med nyanserad, autentisk franska." },
    C2: { targetWords: 8, leechWords: 2, maxNewItems: 4, sentenceStarters: 0, guidance: "Full immersion och stilistisk precision." }
  };
  return { level, ...policies[level] };
}
