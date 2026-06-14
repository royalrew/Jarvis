const LEVEL_EXERCISES: Record<string, string> = {
  "hand:1": "Aktiv planka",
  "hand:2": "Väggstående handstativ",
  "hand:3": "Väggstående handstativ",
  "hand:4": "Frigående handstativ",
  "hand:5": "Frigående handstativ",
  "hand:6": "Pike push-ups",
  "hand:7": "Elevated pike push-ups",
  "hand:8": "Pike push-ups",
  "hand:9": "Pike push-ups",
  "hand:10": "Väggstående handstativ",
  "hand:11": "Frigående handstativ",

  "drag:1": "Aktivt häng",
  "drag:2": "Negativa pull-ups",
  "drag:3": "Pull-ups",
  "drag:4": "Pull-ups",
  "drag:5": "Pull-ups",
  "drag:6": "Negativa pull-ups",
  "drag:7": "Pull-ups",
  "drag:8": "Pull-ups",

  "front:1": "Scapula-pulls i stången",
  "front:2": "Skin the cat",
  "front:3": "Tuck front lever",
  "front:4": "Tuck front lever",
  "front:5": "Tuck front lever",
  "front:6": "Tuck front lever",
  "front:7": "Tuck front lever",

  "planche:1": "Armhävningar på knä",
  "planche:2": "Pseudo planche-lutning",
  "planche:3": "Frog stand",
  "planche:4": "Pseudo planche-lutning",
  "planche:5": "Pseudo planche-lutning",
  "planche:6": "Pseudo planche-lutning",
  "planche:7": "Pseudo planche-lutning",
  "planche:8": "Pseudo planche push-ups",

  "flag:1": "Side plank",
  "flag:2": "Flaggstöd",
  "flag:3": "Vertikal flagga",
  "flag:4": "Tuck-flagga",
  "flag:5": "Tuck-flagga",
  "flag:6": "Straddle-flagga",
  "flag:7": "Straddle-flagga",

  "core:1": "Liggande knälyft",
  "core:2": "Hollow hold",
  "core:3": "Hängande knälyft",
  "core:4": "Hängande benlyft",
  "core:5": "L-sit",
  "core:6": "Liggande benlyft",
  "core:7": "Liggande benlyft",
  "core:8": "Liggande benlyft",

  "mu:1": "Pull-ups",
  "mu:2": "Pull-ups",
  "mu:3": "Pull-ups",
  "mu:4": "Pull-ups",
  "mu:5": "Negativa pull-ups",
  "mu:6": "Pull-ups",
  "mu:7": "Pull-ups",

  "rings:1": "Support-hållning",
  "rings:2": "Dips",
  "rings:3": "Support-hållning",
  "rings:4": "Dips",
  "rings:5": "Support-hållning",
  "rings:6": "Support-hållning",
  "rings:7": "Support-hållning",
  "rings:8": "Support-hållning",
};

export function exerciseForLevel(trackId: string, idx: number) {
  return LEVEL_EXERCISES[`${trackId}:${idx}`] ?? null;
}

export function loggHrefForLevel(trackId: string, idx: number) {
  const exercise = exerciseForLevel(trackId, idx);
  return exercise ? `/logg?exercise=${encodeURIComponent(exercise)}` : "/logg";
}

const PASS_COVERAGE: Record<string, string[]> = {
  "Handled- & axelprep": ["Väggstående handstativ", "Frigående handstativ", "Aktiv planka"],
  "Handstativ mot vägg": ["Väggstående handstativ", "Frigående handstativ"],
  "Pseudo planche-lutning": ["Pseudo planche-lutning", "Frog stand"],
  "Armhävningar": ["Pseudo planche push-ups", "Armhävningar på knä"],
  "Pike push-ups": ["Pike push-ups", "Elevated pike push-ups"],
  "Hollow hold": ["Hollow hold", "L-sit", "Liggande knälyft"],
  "Side plank": ["Vertikal flagga", "Tuck-flagga", "Straddle-flagga", "Flaggstöd"],
  "Liggande benlyft": ["Liggande benlyft", "Liggande knälyft"],
  "Split squats / pistol-prog.": [],
  "Scapula-pulls i stången": ["Pull-ups", "Negativa pull-ups", "Aktivt häng", "Scapula-pulls i stången"],
  "Tuck front lever": ["Tuck front lever", "Skin the cat"],
  "Flagg-försök (om stolpe finns)": ["Vertikal flagga", "Tuck-flagga", "Straddle-flagga", "Flaggstöd"],
  "Pull-ups": ["Pull-ups", "Negativa pull-ups", "Aktivt häng"],
  "Australiska rows (under barren)": ["Negativa pull-ups"],
  "Dips på barren": ["Dips", "Support-hållning"],
  "Hängande knälyft": ["Hängande knälyft", "Hängande benlyft"],
};

export function passExerciseCoversLevel(passExerciseName: string, levelExerciseName: string | null) {
  if (!levelExerciseName) return false;
  if (passExerciseName === levelExerciseName) return true;
  return PASS_COVERAGE[passExerciseName]?.includes(levelExerciseName) ?? false;
}
