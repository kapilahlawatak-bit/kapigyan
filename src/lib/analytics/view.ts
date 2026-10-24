/**
 * View adapters.
 *
 * The analytics layer returns mastery as a record keyed by topic — the right
 * shape for the risk engine, which wants to look a topic up. Every screen,
 * however, wants a sorted *array* to render, and wants it typed as the
 * richer per-topic object. Converting in one place keeps those two
 * representations from drifting apart across a dozen pages.
 */

import { assessRisk, type MasteryResult, type RiskAssessment } from "@/lib/intelligence/mastery";
import { planForStudent, type PracticePlan } from "@/lib/intelligence/recommendations";
import { TOPIC_GAP_THRESHOLD } from "@/lib/curriculum";

export type StudentMastery = Record<
  string,
  MasteryResult & { classMean: number; misconceptionCounts: Record<string, number> }
>;

/** One topic's mastery, with its id attached. */
export type TopicMastery = StudentMastery[string] & { topicId: string };

export function asArray(map: StudentMastery): TopicMastery[] {
  return Object.entries(map).map(([topicId, v]) => ({ ...v, topicId }));
}

export function meanMastery(rows: { mastery: number }[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((a, r) => a + r.mastery, 0) / rows.length;
}

function topMisconception(counts: Record<string, number> | undefined): string | null {
  if (!counts) return null;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? null;
}

/**
 * Risk for one child, assembled the way the engine expects.
 *
 * `attendance` is optional and genuinely so: a school that has never taken a
 * register gets no attendance signal at all, rather than a fabricated one.
 * That distinction matters — a child with no record must not read as fully
 * present, and must not read as absent either.
 */
export function riskFor(
  map: StudentMastery,
  recentScores: number[] = [],
  attendance?: { concern: number | null; notes: string[] },
): RiskAssessment {
  return assessRisk({
    topicMastery: map,
    recentScores,
    weakTopicCount: Object.values(map).filter((m) => m.mastery < TOPIC_GAP_THRESHOLD).length,
    attendance: attendance?.concern == null ? null : (1 - attendance.concern) * 100,
    attendanceConcern: attendance?.concern ?? null,
    attendanceNotes: attendance?.notes,
  });
}

/** A short practice plan built from everything the child is weak on. */
export function planFrom(
  studentName: string,
  map: StudentMastery,
  threshold = 0.75,
  maxItems = 3,
): PracticePlan {
  return planForStudent(
    studentName,
    asArray(map)
      .filter((m) => m.mastery < threshold)
      .map((m) => ({
        topicId: m.topicId,
        mastery: m.mastery,
        misconceptionId: topMisconception(m.misconceptionCounts),
        trend: m.trend,
      })),
    maxItems,
  );
}

/**
 * Class-level topic stats for the recommendation engine.
 * `classMasteryMap` reports how many children are below the gap line, which
 * is exactly the "reach" the ranking needs.
 */
/**
 * Class-level rows → the shape the recommendation engine scores.
 *
 * Two things here are easy to get wrong and both were wrong once already:
 *
 * - `studentsWeak` must be a *count of children*, not the gap fraction.
 *   `reach` is computed as weak/assessed, so handing it a 0–1 fraction
 *   divides the shortfall by the class size and every topic looks like it
 *   affects nobody.
 * - `questionsOnPaper` must reflect real evidence. The ranker deliberately
 *   refuses to act on a topic it has almost no data for, so leaving this at
 *   zero silently disables the whole page.
 */
export function classTopicStats(
  rows: { topicId: string; mastery: number; assessed: number; gap: number }[],
  misconceptionCountsByTopic: Record<string, Record<string, number>> = {},
  questionsPerTopic: Record<string, number> = {},
) {
  return rows.map((r) => ({
    topicId: r.topicId,
    mastery: r.mastery,
    studentsWeak: Math.round(r.gap * r.assessed),
    studentsAssessed: r.assessed,
    questionsOnPaper: questionsPerTopic[r.topicId] ?? 0,
    // Per topic, not class-wide: attaching every topic's dominant error to
    // every topic makes every lesson address the same misconception.
    misconceptionCounts: misconceptionCountsByTopic[r.topicId] ?? {},
  }));
}
