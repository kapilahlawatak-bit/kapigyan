/**
 * How a child answers "do I know this?"
 *
 * This is the most useful and most dangerous question in the app, and it is
 * dangerous for a specific reason: **children overestimate.** A Class 3 child
 * who cannot subtract across a zero reliably will say they are "good at maths"
 * with complete sincerity. Metacognitive calibration is a skill, and it
 * develops alongside the maths — it is not a personality trait and not evidence
 * of ability.
 *
 * So the instrument is designed to be faked-resistant rather than honest:
 *
 * - **Retrieval beats judgment.** A child is asked to actually do a tiny piece
 *   of the task, not to rate themselves. Rating feels like an opinion;
 *   producing an answer is not.
 * - **Prediction before proof.** The child predicts first, then tries, and the
 *   gap between the two is the finding. A child who predicts wrongly and then
 *   gets it right learned something worth knowing; a child who predicts
 *   wrongly and then gets it wrong does not know they had a gap.
 * - **No scores, no bands, no standing.** This is a private conversation with
 *   the child, and it never produces something a teacher can rank them by.
 *
 * ## What the app refuses to do with the result
 *
 * It does not lower a child's predicted mastery. Self-report is weaker
 * evidence than a test result, and the mastery model is built on test
 * evidence. This feeds the teacher conversation and the practice list; it does
 * not feed the number.
 */

import { TOPIC_BY_ID } from "@/lib/curriculum";

/** The three answers, in the words a child would actually use. */
export type Confidence = "not_yet" | "getting_there" | "got_it";

export const CONFIDENCE_WORDS: Record<Confidence, { en: string; hi: string; blurb: string }> = {
  not_yet: {
    en: "I need to learn this",
    hi: "मुझे यह सीखना है",
    blurb: "Choosing this is not giving up. It tells the teacher exactly where to start.",
  },
  getting_there: {
    en: "I can do some of it",
    hi: "मैं कुछ कर सकता हूँ",
    blurb: "The honest middle. Most children pick this, and it is usually right.",
  },
  got_it: {
    en: "I can do this on my own",
    hi: "मैं यह अकेले कर सकता हूँ",
    blurb: "Children choose this more often than they should. That is the point of asking.",
  },
};

export type Reflection = {
  topicId: string;
  topicName: string;
  /** What the child said about themselves, before trying. */
  predicted: Confidence;
  /** What actually happened when they tried. */
  outcome: "got_it" | "nearly" | "not_yet" | "skipped";
  /** The gap between the two. Null when skipped — then we know nothing. */
  calibration: "well_calibrated" | "overconfident" | "underconfident" | null;
  note: string | null;
};

/** One three-item probe. Deliberately tiny — a long one is a test, not a check. */
export type Probe = {
  stem: string;
  hint: string;
  answer: string;
  accepts: string[];
};

export const CONFIDENCE_ORDER: Record<Confidence, number> = {
  not_yet: 0,
  getting_there: 1,
  got_it: 2,
};

const OUTCOME_SCORE: Record<Reflection["outcome"], number> = {
  not_yet: 0,
  nearly: 1,
  got_it: 2,
  skipped: -1,
};

/**
 * The only honest question about a skipped item: nothing.
 *
 * A child who skips has told us nothing about their understanding, so no
 * calibration verdict is produced. Guessing "underconfident" from a blank
 * would be exactly the confident nonsense this app refuses elsewhere.
 */
export function gradeReflection(
  predicted: Confidence,
  gotIt: boolean | null,
): { outcome: Reflection["outcome"]; calibration: Reflection["calibration"] | null } {
  if (gotIt === null) return { outcome: "skipped", calibration: null };

  const outcome: Reflection["outcome"] = gotIt ? "got_it" : "not_yet";
  // "I can do some of it" is a genuine "I'm not sure", not a claim, so it is
  // calibrated either way. Penalising it would punish an honest answer.
  if (predicted === "getting_there") return { outcome, calibration: "well_calibrated" };

  // The sign is easy to get backwards, so it is worth stating: a positive gap
  // means the child did *better* than they claimed, which is underconfidence.
  const gap = OUTCOME_SCORE[outcome] - CONFIDENCE_ORDER[predicted];

  return {
    outcome,
    calibration: gap > 0 ? "underconfident" : gap < 0 ? "overconfident" : "well_calibrated",
  };
}

/**
 * What to say to a child who was overconfident.
 *
 * The failure mode to avoid is "you said you knew it". That is a gotcha, and a
 * child who feels caught will stop answering honestly. The reframe is that
 * knowing what you know *is* the skill being learned here.
 */
export function reflectBack(calibration: Reflection["calibration"] | null): string {
  switch (calibration) {
    case "overconfident":
      return "You thought this was easy and it turned out not to be. That is not a mistake — noticing is the skill. Most people find out the same way, and now you know before someone hands you the test.";
    case "underconfident":
      return "You put yourself down and then did it. Trusting what you can do matters as much as knowing what you cannot — both are learnable, and you have just proved one of them.";
    case "well_calibrated":
      return "You knew what you knew. That is the hardest thing to get right, and it is worth noticing.";
    default:
      return "Nothing to say — this one was skipped, so there is nothing to learn from it yet.";
  }
}

/**
 * Teacher-facing summary.
 *
 * The useful signal is the *pattern across topics*, not any single answer. A
 * class that is broadly overconfident needs a different conversation from one
 * that is confident in exactly the topic it finds hardest.
 */
export function summariseReflections(reflections: Reflection[]): {
  answered: number;
  skipped: number;
  overconfident: number;
  underconfident: number;
  wellCalibrated: number;
  /** Topics where the class says it can and cannot do. Worth a lesson. */
  hiddenGaps: string[];
  /** Topics the class writes off but actually does. Worth building on. */
  hiddenStrengths: string[];
  line: string;
} {
  const answeredRows = reflections.filter((r) => r.outcome !== "skipped");
  const skipped = reflections.length - answeredRows.length;
  const count = (c: Reflection["calibration"]) => answeredRows.filter((r) => r.calibration === c).length;

  const overconfident = count("overconfident");
  const underconfident = count("underconfident");
  const wellCalibrated = count("well_calibrated");

  const hiddenGaps = reflections
    .filter((r) => r.outcome === "not_yet" && r.predicted !== "not_yet")
    .map((r) => r.topicName);
  const hiddenStrengths = reflections
    .filter((r) => r.outcome === "got_it" && r.predicted === "not_yet")
    .map((r) => r.topicName);

  const total = answeredRows.length;
  const line =
    total === 0
      ? "No reflections yet. A child who skips everything has told you nothing, and that is worth knowing."
      : overconfident > total * 0.6
        ? "Most children who answered thought they knew more than they do. That is normal at this age, and it is the most useful thing on this page."
        : underconfident > total * 0.5
          ? "Most children who answered talk themselves down. Worth naming, because a child who will not try a question cannot show what they know."
          : wellCalibrated > total * 0.6
            ? "The children's judgement of themselves closely matches what they can do. That is a genuinely strong classroom habit."
            : "Mixed picture. Look at the topics where what children say and what they can do disagree — those are the interesting ones.";

  return { answered: answeredRows.length, skipped, overconfident, underconfident, wellCalibrated, hiddenGaps, hiddenStrengths, line };
}

/** Topic names for display, tolerant of an unknown id. */
export function topicName(id: string): string {
  return TOPIC_BY_ID.get(id)?.name ?? id;
}
