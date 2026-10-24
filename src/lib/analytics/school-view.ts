/**
 * The principal's view.
 *
 * A principal is not a bigger teacher. They do not need more detail; they need
 * to know which two things to look at this week, and they need to be able to
 * hand those to the right teacher without a meeting.
 *
 * So this deliberately does not show a leaderboard, and it deliberately does
 * not rank teachers. Both are common, both are harmful, and neither answers
 * the question:
 *
 * - Ranking teachers by their classes' scores makes a teacher with a hard
 *   class look like a failing teacher, and creates an incentive to teach
 *   easier material.
 * - Ranking children in front of staff is the thing this app has refused
 *   everywhere else.
 *
 * What it shows instead is *coverage* and *gaps*: which strands the school is
 * secure in, which have not been assessed at all, and which classes share the
 * same problem. The last one is the genuinely useful thing — twelve classes
 * all weak in fractions is a curriculum decision, not twelve teaching
 * decisions, and only a principal is positioned to notice it.
 */

import { prisma } from "@/lib/db";
import { STRAND_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import { classMasteryMap } from "@/lib/analytics/class";

export type SchoolView = {
  classCount: number;
  studentCount: number;
  /** Strand → share of classes whose mastery is below 60%. */
  strandHealth: { strand: string; strandName: string; weakClasses: number; classCount: number; coverage: number }[];
  /** Topics weak in several classes at once — a curriculum-level signal. */
  sharedGaps: { topicId: string; topicName: string; weakClasses: number; classCount: number; average: number }[];
  /** Topics nobody has ever assessed. Silence is a finding, not a zero. */
  neverAssessed: { topicId: string; topicName: string; grade: number }[];
  classes: { id: string; name: string; grade: number; students: number; topics: number; weakest: string | null }[];
  /** Deliberately empty. Stated rather than quietly omitted. */
  teachingRank: never;
  headline: string;
}

export async function schoolView(schoolId: string): Promise<SchoolView> {
  const classes = await prisma.class.findMany({
    where: { schoolId },
    select: { id: true, name: true, grade: true, enrollments: { select: { studentId: true } } },
    orderBy: [{ grade: "asc" }, { name: "asc" }],
  });

  if (classes.length === 0) {
    return {
      classCount: 0, studentCount: 0, strandHealth: [], sharedGaps: [], neverAssessed: [],
      classes: [], teachingRank: undefined as never,
      headline: "No classes are set up yet.",
    };
  }

  const masters = await Promise.all(classes.map((c) => classMasteryMap(c.id)));

  // --- Coverage, per strand -------------------------------------------
  const strandTouched = new Map<string, Set<string>>();
  const topicWeak = new Map<string, { weak: Set<string>; total: number; sum: number }>();
  const assessedTopics = new Set<string>();
  const gradeTopics = new Map<number, Set<string>>();

  classes.forEach((cls, i) => {
    for (const row of masters[i]!) {
      if (row.assessed <= 0) continue;
      assessedTopics.add(row.topicId);
      const gset = gradeTopics.get(cls.grade) ?? new Set<string>();
      gset.add(row.topicId);
      gradeTopics.set(cls.grade, gset);

      const topic = TOPIC_BY_ID.get(row.topicId);
      if (topic) {
        const set = strandTouched.get(topic.strand) ?? new Set<string>();
        set.add(cls.id);
        strandTouched.set(topic.strand, set);
      }
      const g = topicWeak.get(row.topicId) ?? { weak: new Set<string>(), total: 0, sum: 0 };
      g.total++;
      g.sum += row.mastery;
      if (row.mastery < 0.6) g.weak.add(cls.id);
      topicWeak.set(row.topicId, g);
    }
  });

  // A class only counts as "covered" in a strand once something in it has
  // been assessed. Silence is not a passing grade.
  const strandHealth = [...strandTouched.entries()].map(([strand, ids]) => {
    const meta = STRAND_BY_ID.get(strand);
    return {
      strand,
      strandName: meta?.name ?? strand,
      weakClasses: 0,
      classCount: ids.size,
      coverage: ids.size / classes.length,
    };
  });

  // Weak classes per strand, counted from the same evidence.
  for (const [topicId, g] of topicWeak) {
    const strand = TOPIC_BY_ID.get(topicId)?.strand;
    if (!strand) continue;
    const row = strandHealth.find((s) => s.strand === strand);
    if (row) row.weakClasses = Math.max(row.weakClasses, g.weak.size);
  }

  // --- Gaps shared across classes -------------------------------------
  const sharedGaps = [...topicWeak.entries()]
    .map(([topicId, g]) => ({
      topicId,
      topicName: TOPIC_BY_ID.get(topicId)?.name ?? topicId,
      weakClasses: g.weak.size,
      classCount: g.total,
      average: g.total > 0 ? Math.round((g.sum / g.total) * 100) : 0,
    }))
    // A problem in one class is that teacher's business. A problem in four or
    // more is the school's.
    .filter((g) => g.weakClasses >= 4)
    .sort((a, b) => b.weakClasses - a.weakClasses || a.average - b.average)
    .slice(0, 6);

  // --- What nobody has looked at --------------------------------------
  const neverAssessed: SchoolView["neverAssessed"] = [];
  for (const cls of classes) {
    const seen = gradeTopics.get(cls.grade) ?? new Set<string>();
    for (const topic of TOPIC_BY_ID.values()) {
      if (!topic.classes.includes(cls.grade)) continue;
      if (seen.has(topic.id) || assessedTopics.has(topic.id)) continue;
      neverAssessed.push({ topicId: topic.id, topicName: topic.name, grade: cls.grade });
    }
  }

  const classRows = classes.map((cls, i) => {
    const rows = masters[i]!.filter((r) => r.assessed > 0);
    const weakest = rows.length > 0 ? [...rows].sort((a, b) => a.mastery - b.mastery)[0] : null;
    return {
      id: cls.id,
      name: cls.name,
      grade: cls.grade,
      students: cls.enrollments.length,
      topics: rows.length,
      weakest: weakest ? TOPIC_BY_ID.get(weakest.topicId)?.name ?? weakest.topicId : null,
    };
  });

  const studentCount = classes.reduce((a, c) => a + c.enrollments.length, 0);
  const headline =
    sharedGaps.length > 0
      ? `${sharedGaps.length} topic${sharedGaps.length === 1 ? "" : "s"} are weak across ${sharedGaps[0]!.weakClasses} or more classes at once. That is a curriculum question, not ${sharedGaps[0]!.weakClasses} separate teaching problems.`
      : neverAssessed.length > 0
        ? `Nothing is weak school-wide, but ${neverAssessed.length} topics have never been assessed. Silence is not a passing grade.`
        : "Nothing is flagged across the school. The weakest class still shows below.";

  return {
    classCount: classes.length,
    studentCount,
    strandHealth: strandHealth.sort((a, b) => b.weakClasses - a.weakClasses || a.strandName.localeCompare(b.strandName)),
    sharedGaps,
    neverAssessed: neverAssessed.slice(0, 20),
    classes: classRows,
    teachingRank: undefined as never,
    headline,
  };
}
