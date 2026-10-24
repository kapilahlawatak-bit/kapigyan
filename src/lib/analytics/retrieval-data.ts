/**
 * Per-child practice evidence.
 *
 * Retrieval scheduling needs one thing the other analytics do not: every time
 * a child was *asked* about a topic, including times they got it right.
 *
 * That distinction matters. Mastery looks at the weighted score, which
 * improves when a child answers well and so pushes the next review further
 * away. For a practice schedule that is backwards — a child who has just had
 * three questions right has retrieved the idea *today*, and tomorrow is
 * exactly when the next one is due. So this counts attempts and keeps the
 * evidence, and leaves the weighting to the caller.
 */

import { prisma } from "@/lib/db";
import { retrievalPlan, type RetrievalPlan } from "@/lib/intelligence/retrieval";
import type { Evidence } from "@/lib/intelligence/mastery";
import { computeMastery } from "@/lib/intelligence/mastery";

/** Every answer this child has given, keyed by topic. */
export async function practiceEvidence(
  studentId: string,
): Promise<Record<string, Evidence[]>> {
  const answers = await prisma.answer.findMany({
    where: { submission: { studentId } },
    select: {
      marksAwarded: true,
      maxMarks: true,
      paperQuestion: { select: { topicId: true, difficulty: true } },
      submission: { select: { paper: { select: { date: true } } } },
    },
    orderBy: { submission: { paper: { date: "asc" } } },
  });

  const byTopic: Record<string, Evidence[]> = {};
  for (const a of answers) {
    const topicId = a.paperQuestion.topicId;
    if (!topicId) continue;
    (byTopic[topicId] ??= []).push({
      score: a.marksAwarded,
      maxScore: a.maxMarks || 1,
      difficulty: a.paperQuestion.difficulty,
      at: a.submission.paper.date,
    });
  }
  return byTopic;
}

/** The three things a child should practise today, and why. */
export async function retrievalFor(
  studentId: string,
  max = 3,
): Promise<RetrievalPlan & { practisedTopics: number }> {
  const practised = await practiceEvidence(studentId);
  const plan = retrievalPlan({ practised, max });
  return { ...plan, practisedTopics: Object.keys(practised).length };
}

/** Mastery for the topics on a retrieval plan, for showing a bar. */
export function masteryOf(evidence: Evidence[]): number {
  return computeMastery(evidence, 0).raw;
}
