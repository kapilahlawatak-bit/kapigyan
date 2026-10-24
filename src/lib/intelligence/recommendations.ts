/**
 * Teaching recommendations.
 *
 * Class dashboards are good at showing that Number Sense is weak. They are bad
 * at answering the question a teacher actually has on Monday morning: *what do
 * I teach, to whom, in what order, and how will I know it worked?*
 *
 * This module answers that, and deliberately produces something runnable —
 * a 15-minute plan with the materials to put on the desk — rather than another
 * bar chart. The shape of every plan follows the Flipped Pedagogy of
 * NCF-FL 2023: concrete first, then pictorial, then abstract, with the
 * teacher asking rather than telling.
 *
 * Ranking uses four factors, each of which a teacher can argue with:
 *
 *   priority = severity × reach × leverage × evidence
 *
 *   severity  how weak the class is (0..1)
 *   reach     what share of children it affects (0..1)
 *   leverage  how much later learning depends on it (0..1)
 *   evidence  how much data we have, so we do not over-react to one question
 *
 * Products, not sums: a topic that is slightly weak but hits everyone and
 * everything else depends on it outranks a topic that is severely weak for
 * three children in a corner.
 */

import {
  MISCONCEPTION_BY_ID,
  STRAND_BY_ID,
  TOPIC_BY_ID,
  misconceptionsForTopic,
  type Misconception,
} from "@/lib/curriculum";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export type TopicStat = {
  topicId: string;
  /** Mean mastery across the class, 0..1. */
  mastery: number;
  /** How many children scored below the gap threshold. */
  studentsWeak: number;
  /** How many children were assessed on this at all. */
  studentsAssessed: number;
  /** How many questions the last test spent on this. */
  questionsOnPaper: number;
  /** Misconception id → how many children showed it. */
  misconceptionCounts?: Record<string, number>;
};

/**
 * How much later work rests on each topic. Foundational number work has to be
 * rebuilt if it fails, so a gap there costs more later than an equal gap in,
 * say, bar graphs.
 */
const LEVERAGE: Record<string, number> = {
  ns_counting: 1.0, ns_number_names: 0.95, ns_place_value: 0.95,
  as_within_20: 1.0, as_2digit: 0.98, as_3digit: 0.9,
  md_repeated_addition: 1.0, md_sharing: 0.98, md_tables: 0.9, md_remainder: 0.85,
  fr_concept: 0.9, dec_place_value: 0.8,
  al_equations: 0.7, ge_2d_shapes: 0.6, me_length: 0.75, me_money: 0.75,
  da_table: 0.5, da_chance: 0.4,
};

function leverageFor(topicId: string): number {
  if (LEVERAGE[topicId] !== undefined) return LEVERAGE[topicId];
  // Unlisted topics sit in the middle; foundational strands lean higher.
  const strand = TOPIC_BY_ID.get(topicId)?.strand;
  if (strand === "number" || strand === "addition_subtraction" || strand === "multiplication_division") return 0.85;
  if (strand === "fractions_decimals") return 0.7;
  return 0.5;
}

/* ------------------------------------------------------------------ */
/* Lesson plan                                                         */
/* ------------------------------------------------------------------ */

export type LessonStep = {
  minutes: number;
  phase: "concrete" | "pictorial" | "abstract" | "check";
  title: string;
  /** What the teacher does. */
  do: string;
  /** What the teacher says. Ask, don't tell. */
  say: string;
  materials: string;
};

export type LessonPlan = {
  minutes: number;
  steps: LessonStep[];
  /** How the teacher checks it worked, in the same lesson. */
  successCheck: string;
  /** What to do for the three groups in the room. */
  differentiation: {
    struggling: string;
    onTrack: string;
    advanced: string;
  };
};

export type Recommendation = {
  topicId: string;
  topicName: string;
  strand: string;
  strandName: string;
  priority: number;
  /** The four factors, so the ranking is explainable. */
  factors: { severity: number; reach: number; leverage: number; evidence: number };
  headline: string;
  why: string;
  dominantMisconception: Misconception | null;
  lesson: LessonPlan;
  /** Question ids from the bank that diagnose this gap best. */
  recommendedQuestionIds: string[];
};

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

export function recommendTeaching(
  stats: TopicStat[],
  opts: { maxRecommendations?: number; lessonMinutes?: number; threshold?: number } = {},
): Recommendation[] {
  const max = opts.maxRecommendations ?? 3;
  const lessonMinutes = opts.lessonMinutes ?? 15;
  const threshold = opts.threshold ?? 0.6;

  const scored = stats.map((s) => {
    const assessed = Math.max(1, s.studentsAssessed);
    const severity = Math.max(0, Math.min(1, 1 - s.mastery / Math.max(0.01, threshold)));
    const reach = Math.min(1, s.studentsWeak / assessed);
    const leverage = leverageFor(s.topicId);
    // One question is a hint; four is a pattern.
    const evidence = Math.min(1, s.questionsOnPaper / 4);
    const priority = severity * reach * leverage * evidence;
    return { s, severity, reach, leverage, evidence, priority };
  });

  const weak = scored
    .filter((x) => x.reach > 0.15 && x.priority > 0.02)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, max);

  return weak.map((x) => buildRecommendation(x.s, x, lessonMinutes));
}

type Scored = {
  s: TopicStat;
  severity: number;
  reach: number;
  leverage: number;
  evidence: number;
  priority: number;
};

function buildRecommendation(s: TopicStat, x: Scored, minutes: number): Recommendation {
  const meta = TOPIC_BY_ID.get(s.topicId);
  const strandMeta = meta ? STRAND_BY_ID.get(meta.strand) : undefined;

  const counts = Object.entries(s.misconceptionCounts ?? {}).sort((a, b) => b[1] - a[1]);
  const dominantId = counts[0]?.[0] ?? null;
  const dominant = dominantId ? MISCONCEPTION_BY_ID.get(dominantId) ?? null : null;

  const assessed = Math.max(1, s.studentsAssessed);
  const weakPct = Math.round((s.studentsWeak / assessed) * 100);
  const topicName = meta?.name ?? s.topicId;

  const headline = dominant
    ? `${topicName} — mostly "${dominant.name}"`
    : `${topicName} — ${weakPct}% of the class is below the bar`;

  const whyParts: string[] = [];
  whyParts.push(
    `${s.studentsWeak} of ${s.studentsAssessed} children (${weakPct}%) are below the ${Math.round(0.5 * 100)}% bar on this topic.`,
  );
  if (dominant) {
    whyParts.push(`The most common cause is "${dominant.name}" — ${dominant.belief}`);
  }
  if (x.leverage >= 0.85) {
    whyParts.push("Other topics depend on this one, so it is worth fixing before moving on.");
  }
  if (x.evidence < 0.5) {
    whyParts.push("Evidence is thin here — re-test with 3–4 questions before committing a full lesson.");
  }

  return {
    topicId: s.topicId,
    topicName,
    strand: meta?.strand ?? "number",
    strandName: strandMeta?.name ?? "",
    priority: Math.round(x.priority * 1000) / 1000,
    factors: {
      severity: Math.round(x.severity * 100) / 100,
      reach: Math.round(x.reach * 100) / 100,
      leverage: x.leverage,
      evidence: Math.round(x.evidence * 100) / 100,
    },
    headline,
    why: whyParts.join(" "),
    dominantMisconception: dominant,
    lesson: buildLesson(meta?.strand ?? "number", dominant, topicName, minutes),
    recommendedQuestionIds: [],
  };
}

/* ------------------------------------------------------------------ */
/* Building the lesson                                                 */
/* ------------------------------------------------------------------ */

/** Materials for the concrete step, chosen by what the topic is really about. */
/**
 * What the lesson needs on the table.
 *
 * Exported so the printable materials can pair every item with a version made
 * of paper — see `lib/intelligence/materials.ts`, which is useless without
 * this list.
 */
export function materialsFor(strand: string, misconception: Misconception | null): string {
  if (misconception?.id === "mc_mult_add_confusion" || misconception?.id === "mc_remainder_meaning") {
    return "Counters or beans, and the counting mat";
  }
  if (misconception?.id === "mc_perimeter_area" || misconception?.id === "mc_area") {
    return "Unit squares on card, a 30 cm thread, and a 1×6 paper strip";
  }
  if (misconception?.id === "mc_denominator_bigger_bigger" || misconception?.id === "mc_numerator_rule") {
    return "Two identical paper circles cut into halves and quarters, plus a 0–1 number line strip";
  }
  if (misconception?.id === "mc_unit_scale" || strand === "measurement") {
    return "A 1 m strip, a metre rule, a 100 g weight, and a 1 kg bag of rice";
  }
  if (misconception?.id === "mc_clock_reading") {
    return "A clock with movable hands, and a chalkboard circle divided into 60";
  }
  if (misconception?.id === "mc_digit_reversal") {
    return "Place-value mats with hundreds, tens and ones columns, and a set of digit cards";
  }
  if (misconception?.id === "mc_carry_loss" || strand === "addition_subtraction") {
    return "Bundles of ten in rubber bands, and a 0–20 number line";
  }
  if (strand === "geometry") {
    return "Cut-out shapes, a mirror, and squared paper";
  }
  if (strand === "data_probability") {
    return "Class data about favourite games, drawn as tally marks on the board";
  }
  return "Counters, a 0–20 number line, and squared paper";
}

/**
 * Build a runnable lesson.
 * The misconception's own remediation steps are the spine when we have one,
 * because they were written for exactly this moment.
 */
function buildLesson(
  strand: string,
  misconception: Misconception | null,
  topicName: string,
  minutes: number,
): LessonPlan {
  // Split the time: roughly 40 / 25 / 25 / 10 across the four phases.
  const concrete = Math.round(minutes * 0.4);
  const pictorial = Math.round(minutes * 0.25);
  const abstract = Math.round(minutes * 0.25);
  const check = Math.max(2, minutes - concrete - pictorial - abstract);

  const materials = materialsFor(strand, misconception);

  const steps: LessonStep[] = [
    {
      minutes: concrete,
      phase: "concrete",
      title: misconception ? `Confront "${misconception.name}"` : `Build ${topicName} with objects`,
      do: misconception
        ? misconception.remediation[0] ?? `Handle objects to rebuild the idea of ${topicName}.`
        : `Let children build ${topicName} with objects before any writing.`,
      say: misconception
        ? `Ask: "What is ${misconception.belief.replace(/\.$/, "")}? Show me with your hands." Take the misconception seriously, then let the objects disprove it.`
        : `"Show me with your fingers, not your pencil."`,
      materials,
    },
    {
      minutes: pictorial,
      phase: "pictorial",
      title: "Draw it",
      do: misconception
        ? misconception.remediation[1] ?? "Every child draws the same idea in their own way."
        : "Every child draws the same idea, so two children's drawings can be compared.",
      say: `"Two of you drew it differently — come and show me. Which one matches what we did with the objects?"`,
      materials: "Squared paper, the same objects still on the desk",
    },
    {
      minutes: abstract,
      phase: "abstract",
      title: misconception ? "Now the written method" : "Now write it",
      do: misconception
        ? misconception.remediation[2] ?? "Move to the written form only once the picture agrees with the objects."
        : "Move to symbols and the column method, now that the picture is agreed.",
      say: `"Use the picture in your head. What do you write?"`, // guided, not recited
      materials: "Exercise books, the number line on the wall",
    },
    {
      minutes: check,
      phase: "check",
      title: "Find out who has got it",
      do: "Three quick questions on the board, one step harder than the lesson, hands up for each.",
      say: `"Thumbs up, sideways, or down — be honest, I need to know who to help next."`,
      materials: "Board, mini-whiteboards if the class has them",
    },
  ];

  return {
    minutes,
    steps,
    successCheck: misconception
      ? `At least 80% of the class answers all three check questions correctly. If not, the misconception is still active — repeat this with new numbers in the next lesson, do not move on.`
      : `At least 80% answer the three check questions correctly. Record who did not, and group those children for the next practice set.`,
    differentiation: {
      struggling: misconception
        ? `Stay at the objects only. Give the child the counters and the same question with smaller numbers; do not introduce the written form.`
        : `Work with the smallest numbers and the physical objects. Pair with a partner who can explain, not do it for them.`,
      onTrack: `Complete the written form and then explain the method to a partner in their own words.`,
      advanced: misconception
        ? `Ask them to find the rule: "When does this go wrong? Write a number that makes the mistake obvious." This is the Proficient level of the CBSE scale.`
        : `Ask them to invent a question of their own that this method would solve, and one it would not.`,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Per-student practice plan                                           */
/* ------------------------------------------------------------------ */

export type PracticePlan = {
  studentName: string;
  /** Ordered by priority. */
  items: {
    topicId: string;
    topicName: string;
    misconceptionId: string | null;
    misconceptionName: string | null;
    why: string;
    whatToDo: string[];
  }[];
  message: string;
};

/**
 * A short, honest plan for one child. Deliberately capped: a Class 5 child
 * with fifteen gaps is a teaching problem, not a practice problem.
 */
export function planForStudent(
  studentName: string,
  gaps: { topicId: string; mastery: number; misconceptionId: string | null; trend: string }[],
  maxItems = 3,
): PracticePlan {
  const ranked = [...gaps]
    .sort((a, b) => a.mastery * leverageFor(a.topicId) - b.mastery * leverageFor(b.topicId))
    .slice(0, maxItems);

  const items = ranked.map((g) => {
    const meta = TOPIC_BY_ID.get(g.topicId);
    const m = g.misconceptionId ? MISCONCEPTION_BY_ID.get(g.misconceptionId) : null;
    return {
      topicId: g.topicId,
      topicName: meta?.name ?? g.topicId,
      misconceptionId: g.misconceptionId,
      misconceptionName: m?.name ?? null,
      why: m ? m.belief : `Only ${Math.round(g.mastery * 100)}% secure on this topic.`,
      whatToDo: m ? m.remediation : misconceptionsForTopic(g.topicId)[0]?.remediation ?? [
        `Five minutes of daily practice on ${meta?.name ?? g.topicId}.`,
      ],
    };
  });

  const message =
    items.length === 0
      ? `${studentName} is secure on everything tested so far. Move to harder material.`
      : items.length === 1
        ? `One thing to work on: ${items[0].topicName}. Fifteen minutes, five days a week, for two weeks.`
        : `Work on these in order, about fifteen minutes a day: ${items.map((i) => i.topicName).join(", then ")}. Do not start the next until the first feels easy.`;

  return { studentName, items, message };
}
