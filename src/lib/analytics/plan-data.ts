/**
 * Loading the data behind the curriculum map and the term plan.
 *
 * Both pages need the same three things — the classes a teacher owns, which
 * one is selected, and the class's mastery and ranked gaps — and both have to
 * agree, or the map will say "teach this first" while the plan teaches
 * something else. So it is computed once, here.
 */

import { prisma } from "@/lib/db";
import { classMasteryMap } from "@/lib/analytics/class";
import { recommendTeaching, type TopicStat } from "@/lib/intelligence/recommendations";
import { STRAND_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import type { Session } from "@/lib/auth/session";

export type PlanData = {
  classId: string;
  className: string;
  grade: number;
  studentCount: number;
  /** topicId → mastery. */
  mastery: Record<string, number>;
  /** Mastery rows, weakest first, for the map. */
  rows: { topicId: string; mastery: number; assessed: number; gap: number }[];
  recommendations: ReturnType<typeof recommendTeaching>;
  /** topicId → how many questions this class has been asked about it. */
  questionsPerTopic: Record<string, number>;
  /** topicId → misconception id → count. */
  misconceptionsByTopic: Record<string, Record<string, number>>;
  /** Class-wide roll-up, for a summary. */
  misconceptionTotals: Record<string, number>;
  allClasses: { id: string; name: string; grade: number; students: number }[];
  hasData: boolean;
};

export async function loadPlanData(session: Session, requestedClassId?: string): Promise<PlanData | null> {
  const classes = await prisma.class.findMany({
    where: {
      ...(session.schoolId ? { schoolId: session.schoolId } : {}),
      // A class teacher sees their own classes. A home educator has no
      // staff role, so theirs are identified by having authored a paper for
      // them — `Class` carries `teacherId` but not a creator.
      ...(session.role === "TEACHER" && session.mode !== "HOME" ? { teacherId: session.userId } : {}),
    },
    include: { enrollments: { select: { studentId: true } } },
    orderBy: [{ grade: "asc" }, { name: "asc" }],
  });

  if (classes.length === 0) return null;

  const active = classes.find((c) => c.id === requestedClassId) ?? classes[0]!;
  const mastery = await classMasteryMap(active.id);

  const [questionRows, errorRows] = await Promise.all([
    prisma.paperQuestion.findMany({
      where: { topicId: { not: null }, paper: { classId: active.id } },
      select: { id: true, topicId: true },
    }),
    prisma.answer.groupBy({
      by: ["errorTag", "paperQuestionId"],
      where: { submission: { paper: { classId: active.id } }, errorTag: { not: null } },
      _count: { _all: true },
    }),
  ]);

  const topicByQuestion = new Map(questionRows.map((q) => [q.id, q.topicId as string]));

  const questionsPerTopic: Record<string, number> = {};
  for (const q of questionRows) {
    if (q.topicId) questionsPerTopic[q.topicId] = (questionsPerTopic[q.topicId] ?? 0) + 1;
  }

  const misconceptionsByTopic: Record<string, Record<string, number>> = {};
  const misconceptionTotals: Record<string, number> = {};
  for (const row of errorRows) {
    if (!row.errorTag) continue;
    const topicId = topicByQuestion.get(row.paperQuestionId);
    if (topicId) {
      misconceptionsByTopic[topicId] = misconceptionsByTopic[topicId] ?? {};
      misconceptionsByTopic[topicId]![row.errorTag] =
        (misconceptionsByTopic[topicId]![row.errorTag] ?? 0) + row._count._all;
    }
    misconceptionTotals[row.errorTag] = (misconceptionTotals[row.errorTag] ?? 0) + row._count._all;
  }

  const stats: TopicStat[] = mastery.map((m) => ({
    topicId: m.topicId,
    mastery: m.mastery,
    // A count of children, not the shortfall fraction — reach is a share.
    studentsWeak: Math.round(m.gap * m.assessed),
    studentsAssessed: m.assessed,
    questionsOnPaper: questionsPerTopic[m.topicId] ?? 0,
    misconceptionCounts: misconceptionsByTopic[m.topicId] ?? {},
  }));

  return {
    classId: active.id,
    className: active.name,
    grade: active.grade,
    studentCount: active.enrollments.length,
    mastery: Object.fromEntries(mastery.map((m) => [m.topicId, m.mastery])),
    rows: mastery,
    recommendations: recommendTeaching(stats, { maxRecommendations: 6 }),
    questionsPerTopic,
    misconceptionsByTopic,
    misconceptionTotals,
    allClasses: classes.map((c) => ({
      id: c.id,
      name: c.name,
      grade: c.grade,
      students: c.enrollments.length,
    })),
    hasData: mastery.length > 0,
  };
}

/** Strand roll-up for the plan header. */
export function strandSummary(rows: { topicId: string; mastery: number }[]) {
  const by = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const strand = TOPIC_BY_ID.get(r.topicId)?.strand;
    if (!strand) continue;
    const e = by.get(strand) ?? { sum: 0, n: 0 };
    e.sum += r.mastery;
    e.n += 1;
    by.set(strand, e);
  }
  return [...by.entries()]
    .map(([id, e]) => ({
      id,
      name: STRAND_BY_ID.get(id)?.name ?? id,
      color: STRAND_BY_ID.get(id)?.color ?? "#888",
      mastery: e.n > 0 ? e.sum / e.n : 0,
      topics: e.n,
    }))
    .sort((a, b) => a.mastery - b.mastery);
}
