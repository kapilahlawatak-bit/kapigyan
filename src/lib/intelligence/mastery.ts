/**
 * Mastery tracking and at-risk prediction.
 *
 * A child's percentage score is a poor summary: it hides *what* they can do,
 * it moves on every test, and it says nothing about direction. What a teacher
 * actually needs is "where is this child secure, where is it slipping, and who
 * is about to fall behind before it shows up in a grade".
 *
 * The model here is deliberately small and explainable rather than clever.
 * A primary teacher has to be able to say out loud why the app thinks a child
 * is weak, and be right. So:
 *
 *   mastery = (weighted evidence + prior × class mean) / (weight + prior)
 *
 * - **Weighted** by how recent the evidence is (earlier tests count for less)
 *   and how hard each question was (getting a hard one right proves more).
 * - **Shrunk** toward the class mean, so a child with one bad test is not
 *   labelled weak and a child with no data is not labelled strong.
 *
 * Everything returns a reason string alongside the number, for the same reason.
 */

import { TOPIC_BY_ID, TOPIC_GAP_THRESHOLD, STRAND_GAP_THRESHOLD } from "@/lib/curriculum";

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

export type Evidence = {
  /** Marks scored. */
  score: number;
  /** Marks available. */
  maxScore: number;
  /** 1 (easy) .. 5 (hard). */
  difficulty: number;
  /** ISO date of the test. */
  at: Date | string;
};

/** One earlier test is worth half as much after this many tests. */
const HALF_LIFE_TESTS = 2.5;
/**
 * "Virtual" answers worth of class average. With K=2, a child who has answered
 * two questions perfectly and the class average is 60% lands at ~77% — already
 * pulled down by the thin evidence, and visibly so.
 */
const PRIOR_WEIGHT = 2;

/** Getting a harder item right is stronger evidence of mastery. */
function difficultyWeight(difficulty: number): number {
  return 0.6 + 0.2 * clamp(difficulty, 1, 5);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function toTime(at: Date | string): number {
  return at instanceof Date ? at.getTime() : new Date(at).getTime();
}

export type MasteryResult = {
  /** 0..1, shrunk toward the class mean. */
  mastery: number;
  /** 0..1, purely from the child's own answers, before shrinkage. */
  raw: number;
  /** How much evidence exists, in "question equivalents". */
  confidence: number;
  /** "improving" | "steady" | "declining" | "unknown". */
  trend: "improving" | "steady" | "declining" | "unknown";
  /** Percentage point change between the older and newer half of the evidence. */
  delta: number;
  attempts: number;
  /** The class mean this was shrunk toward, for transparency. */
  classMean: number;
};

/**
 * Mastery for one student on one topic.
 * Evidence must be ordered oldest → newest.
 */
export function computeMastery(evidence: Evidence[], classMean = 0.6): MasteryResult {
  const usable = evidence.filter((e) => e.maxScore > 0);
  if (usable.length === 0) {
    return { mastery: classMean, raw: classMean, confidence: 0, trend: "unknown", delta: 0, attempts: 0, classMean };
  }

  const n = usable.length;
  // Weight by recency relative to the newest item in this set.
  const newest = Math.max(...usable.map((e) => toTime(e.at)));
  let wSum = 0;
  let scoreSum = 0;
  const series: { w: number; ratio: number }[] = [];

  for (const e of usable) {
    const ageTests = n > 1 ? (newest - toTime(e.at)) / Math.max(1, spanMs(usable)) * (n - 1) : 0;
    const recency = Math.pow(0.5, ageTests / HALF_LIFE_TESTS);
    const w = recency * difficultyWeight(e.difficulty);
    const ratio = clamp(e.score / e.maxScore, 0, 1.25); // extra credit is allowed through
    wSum += w;
    scoreSum += w * Math.min(1, ratio);
    series.push({ w, ratio: Math.min(1, ratio) });
  }

  const raw = wSum > 0 ? scoreSum / wSum : classMean;
  const mastery = (wSum * raw + PRIOR_WEIGHT * classMean) / (wSum + PRIOR_WEIGHT);

  // Trend: compare the weighted mean of the older half with the newer half.
  let trend: MasteryResult["trend"] = "unknown";
  let delta = 0;
  if (series.length >= 3) {
    const mid = Math.floor(series.length / 2);
    const older = series.slice(0, mid);
    const newer = series.slice(mid);
    const mean = (xs: { w: number; ratio: number }[]) => {
      const w = xs.reduce((a, b) => a + b.w, 0);
      return w > 0 ? xs.reduce((a, b) => a + b.ratio * b.w, 0) / w : 0;
    };
    const oldMean = mean(older);
    const newMean = mean(newer);
    delta = Math.round((newMean - oldMean) * 100);
    trend = delta >= 8 ? "improving" : delta <= -8 ? "declining" : "steady";
  }

  return { mastery: clamp(mastery, 0, 1), raw: clamp(raw, 0, 1), confidence: wSum, trend, delta, attempts: n, classMean };
}

function spanMs(evidence: Evidence[]): number {
  const times = evidence.map((e) => toTime(e.at));
  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = max - min;
  return span > 0 ? span : 1;
}

/* ------------------------------------------------------------------ */
/* At-risk prediction                                                  */
/* ------------------------------------------------------------------ */

/** Topics that everything else rests on. A child weak here is a priority. */
const FOUNDATIONAL = new Set([
  "ns_counting", "ns_number_names", "as_within_20", "as_2digit",
  "md_repeated_addition", "md_sharing", "me_length", "me_money",
]);

export type RiskLevel = "low" | "watch" | "high";

export type RiskAssessment = {
  /** 0..100, higher is riskier. */
  score: number;
  level: RiskLevel;
  /** Plain-language reasons, ready to show a teacher or a parent. */
  reasons: string[];
  /** What to do about it, in order. */
  actions: string[];
};

export type RiskInput = {
  /** Mastery per topic, keyed by topic id. */
  topicMastery: Record<string, MasteryResult>;
  /** Recent test scores as percentages, oldest → newest. */
  recentScores: number[];
  /** Attendance percentage over the last month, if known. */
  attendance?: number | null;
  /**
   * Concern from `summariseAttendance`, 0..1. Null when no register has been
   * kept — which must not be read as "no concern", hence the separate field
   * from `attendance`.
   */
  attendanceConcern?: number | null;
  /** One-line notes for the reason text. */
  attendanceNotes?: string[];
  /** How many topics are below the gap threshold. */
  weakTopicCount?: number;
};

/**
 * Who is falling behind.
 *
 * Deliberately not a black box: the score is the sum of named components, and
 * every component that fired becomes a reason. A teacher who disagrees can see
 * exactly which part to disagree with.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const reasons: string[] = [];
  const actions: string[] = [];
  let score = 0;

  const entries = Object.entries(input.topicMastery);

  if (entries.length > 0) {
    const avg = entries.reduce((a, [, m]) => a + m.mastery, 0) / entries.length;
    if (avg < 0.4) {
      score += 32;
      reasons.push(`Overall topic mastery is ${Math.round(avg * 100)}%, which is well below the class.`);
    } else if (avg < 0.55) {
      score += 18;
      reasons.push(`Overall topic mastery is ${Math.round(avg * 100)}%, below where it should be.`);
    } else if (avg < TOPIC_GAP_THRESHOLD + 0.15) {
      score += 8;
      reasons.push(`Overall topic mastery is ${Math.round(avg * 100)}% — borderline.`);
    }

    const weak = entries.filter(([, m]) => m.mastery < TOPIC_GAP_THRESHOLD);
    const weakShare = weak.length / entries.length;
    if (weakShare > 0.5) {
      score += 20;
      reasons.push(`${weak.length} of ${entries.length} topics tested so far are below ${Math.round(TOPIC_GAP_THRESHOLD * 100)}%.`);
    } else if (weak.length > 0) {
      score += 8 * Math.min(1, weak.length / 3);
    }

    // Weak in the foundations is worse than weak in one advanced topic,
    // because everything later is built on it.
    const foundationalWeak = weak.filter(([id]) => FOUNDATIONAL.has(id));
    if (foundationalWeak.length > 0) {
      score += 14;
      const names = foundationalWeak
        .map(([id]) => TOPIC_BY_ID.get(id)?.name)
        .filter(Boolean)
        .slice(0, 2)
        .join(", ");
      reasons.push(`The gaps are in foundational work (${names}), which later topics depend on.`);
      actions.push(`Rebuild the foundation first: ${names}. Practise this daily for two weeks before moving on.`);
    }

    // Slipping is a stronger warning than simply being low.
    const declining = entries.filter(([, m]) => m.trend === "declining");
    if (declining.length > 0) {
      score += 12 * Math.min(2, declining.length);
      const worst = declining.sort((a, b) => a[1].mastery - b[1].mastery)[0];
      const name = TOPIC_BY_ID.get(worst[0])?.name ?? worst[0];
      reasons.push(
        `Performance in ${name} is going down (${worst[1].delta} points across recent tests), not just low.`,
      );
      actions.push(`Check what changed before ${name} went wrong — a new topic may be landing too fast.`);
    }

    // Getting worse across tests, even if the level is acceptable.
    if (input.recentScores.length >= 3) {
      const half = Math.floor(input.recentScores.length / 2);
      const oldAvg = input.recentScores.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const newAvg = input.recentScores.slice(half).reduce((a, b) => a + b, 0) / (input.recentScores.length - half);
      const drop = oldAvg - newAvg;
      if (drop >= 10) {
        score += 15;
        reasons.push(`Scores have fallen from ${Math.round(oldAvg)}% to ${Math.round(newAvg)}% over recent tests.`);
        actions.push("Arrange a short one-to-one check-in; a fall this size is rarely about the maths alone.");
      } else if (drop <= -10) {
        // Improving — note it, because good news is worth surfacing.
        reasons.push(`Scores have improved from ${Math.round(oldAvg)}% to ${Math.round(newAvg)}%.`);
      }
    }
  } else {
    reasons.push("Not enough graded work yet to judge this child.");
    actions.push("Grade one more test to get a reliable picture.");
  }

  if (typeof input.attendance === "number" && input.attendance < 75) {
    score += 10;
    reasons.push(`Attendance is ${Math.round(input.attendance)}%.`);
    actions.push("Check in with the family — attendance is affecting learning more than marks suggest.");
  }

  // Absence *pattern* carries more than absence *rate*. Three days off in a
  // row is a child who may not come back at all, which a 78% attendance
  // figure and a steady once-a-week pattern can report identically. This is
  // the missing half of the dropout signal: the marks say where a child is
  // struggling, the register says whether they are still turning up.
  if (input.attendanceConcern && input.attendanceConcern > 0) {
    const patternPoints = Math.round(14 * Math.min(1, input.attendanceConcern));
    if (patternPoints > 0) {
      score += patternPoints;
      const notes = input.attendanceNotes?.length
        ? ` ${input.attendanceNotes.slice(0, 2).join(" ")}`
        : "";
      reasons.push(`Attendance pattern needs a conversation.${notes}`);
      actions.push(
        "Absence and weak marks together are the combination that most often precedes a child leaving. Find out what is happening at home before offering more homework.",
      );
    }
  }

  const final = Math.round(clamp(score, 0, 100));
  const level: RiskLevel = final >= 55 ? "high" : final >= 30 ? "watch" : "low";

  if (actions.length === 0) {
    actions.push("No action needed right now. Keep the weekly practice going.");
  }
  if (level === "high" && !actions.some((a) => a.toLowerCase().includes("one-to-one"))) {
    actions.push("Schedule a short one-to-one session this week.");
  }

  return { score: final, level, reasons, actions };
}

/* ------------------------------------------------------------------ */
/* Gap summary                                                         */
/* ------------------------------------------------------------------ */

export type TopicGap = {
  topicId: string;
  name: string;
  strand: string;
  mastery: number;
  attempts: number;
  trend: MasteryResult["trend"];
  /** Most common misconception among the students weak on this topic. */
  topMisconception: string | null;
};

export type GapSummary = {
  topics: TopicGap[];
  weakTopics: TopicGap[];
  improvingTopics: TopicGap[];
  decliningTopics: TopicGap[];
  classMastery: number;
};

export type GapInput = {
  topicId: string;
  evidence: Evidence[];
  classMean?: number;
  misconceptionCounts?: Record<string, number>;
};

/** Build the topic gap list for one student, ranked by how much it matters. */
export function summariseGaps(inputs: GapInput[]): GapSummary {
  const topics: TopicGap[] = inputs.map((input) => {
    const m = computeMastery(input.evidence, input.classMean ?? 0.6);
    const meta = TOPIC_BY_ID.get(input.topicId);
    const counts = Object.entries(input.misconceptionCounts ?? {}).sort((a, b) => b[1] - a[1]);
    return {
      topicId: input.topicId,
      name: meta?.name ?? input.topicId,
      strand: meta?.strand ?? "number",
      mastery: m.mastery,
      attempts: m.attempts,
      trend: m.trend,
      topMisconception: counts[0]?.[0] ?? null,
    };
  });

  topics.sort((a, b) => a.mastery - b.mastery);
  const classMastery = topics.length > 0 ? topics.reduce((a, t) => a + t.mastery, 0) / topics.length : 0;

  return {
    topics,
    weakTopics: topics.filter((t) => t.mastery < TOPIC_GAP_THRESHOLD),
    improvingTopics: topics.filter((t) => t.trend === "improving").sort((a, b) => a.mastery - b.mastery),
    decliningTopics: topics.filter((t) => t.trend === "declining").sort((a, b) => a.mastery - b.mastery),
    classMastery,
  };
}

/** Is a whole strand below the bar, class-wide? */
export function strandIsGapped(strandMastery: Record<string, number>, strand: string): boolean {
  return (strandMastery[strand] ?? 1) < STRAND_GAP_THRESHOLD / 100;
}
