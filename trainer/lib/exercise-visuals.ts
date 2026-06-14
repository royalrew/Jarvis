export type ExerciseVisual = {
  slug: string;
  prompt: string;
};

const STYLE =
  "Clear instructional fitness photo, one athletic adult demonstrating the exercise with correct form, neutral gym or outdoor calisthenics setting, full body visible, clean composition, no text, no watermark, no logos, realistic lighting.";

export const EXERCISE_VISUALS: Record<string, ExerciseVisual> = {
  "Handled- & axelprep": visual(
    "wrist-shoulder-prep",
    "An athlete doing wrist circles and shoulder mobility preparation before calisthenics.",
  ),
  "Handstativ mot vägg": visual(
    "wall-handstand",
    "Side view of an athlete in a strict wall handstand, hands on floor, arms straight, full head and body visible, feet lightly touching the wall, no missing body parts.",
  ),
  "Pseudo planche-lutning": visual(
    "pseudo-planche-lean",
    "An athlete in a pseudo planche lean on the floor, shoulders forward past hands, straight arms.",
  ),
  "Armhävningar": visual(
    "push-ups",
    "An athlete at the bottom position of a strict push-up, straight body line, hands on floor.",
  ),
  "Pike push-ups": visual(
    "pike-push-ups",
    "An athlete performing a pike push-up with hips high and head moving toward the floor.",
  ),
  "Hollow hold": visual(
    "hollow-hold",
    "An athlete holding a hollow body position on the floor, lower back pressed down, arms overhead.",
  ),
  "Side plank": visual(
    "side-plank",
    "An athlete holding a side plank, elbow under shoulder, body in a straight line.",
  ),
  "Liggande benlyft": visual(
    "lying-leg-raises",
    "An athlete doing lying leg raises on the floor, legs straight and core tight.",
  ),
  "Split squats / pistol-prog.": visual(
    "split-squat",
    "An athlete performing a split squat with controlled posture.",
  ),
  "Scapula-pulls i stången": visual(
    "scapula-pulls",
    "An athlete hanging from a pull-up bar doing scapular pulls with straight arms.",
  ),
  "Tuck front lever": visual(
    "tuck-front-lever",
    "Simple flat instructional fitness illustration, side view. A horizontal pull-up bar at the top, athlete hangs below it with straight locked arms, shoulders engaged, torso leaning back nearly horizontal, knees tucked tightly to chest, hips high. Clearly a tuck front lever hold, not a pull-up. Clean anatomy, no extra limbs.",
  ),
  "Flagg-försök (om stolpe finns)": visual(
    "human-flag-attempt",
    "Minimal black silhouette pictogram on a plain white background. Vertical pole on the left. Athlete holds the pole with both hands and body extends sideways horizontally like a flag, knees tucked toward chest, feet off the ground. No climbing pose, no standing, no arrows, no text.",
  ),
  "Pull-ups": visual(
    "pull-ups",
    "An athlete at the top of a strict pull-up on a straight bar, elbows bent, chin clearly above the bar, shoulders down, no swinging, full bar and upper body visible.",
  ),
  "Australiska rows (under barren)": visual(
    "australian-rows",
    "An athlete doing an Australian row under low parallel bars, straight body line.",
  ),
  "Dips på barren": visual(
    "parallel-bar-dips",
    "Simple flat instructional fitness illustration, front three-quarter view. Athlete between two parallel bars performing a strict dip, hands on bars at hip level, torso upright, elbows bent about 90 degrees, shoulders controlled, legs hanging downward. Not an L-sit, not sitting on bars, no pull-up bar.",
  ),
  "Hängande knälyft": visual(
    "hanging-knee-raises",
    "An athlete hanging from a pull-up bar doing controlled hanging knee raises.",
  ),
};

export function exerciseImagePath(name: string) {
  if (name === "Flagg-försök (om stolpe finns)") return null;

  const visual = EXERCISE_VISUALS[name];
  return visual ? `/exercise-images/${visual.slug}.jpg` : null;
}

function visual(slug: string, subject: string): ExerciseVisual {
  return {
    slug,
    prompt: `${STYLE} Subject: ${subject}`,
  };
}
