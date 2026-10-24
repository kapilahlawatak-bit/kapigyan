/**
 * Class and student analytics.
 *
 * Everything the dashboards, the heatmap, the reports and the AI recommender
 * read from. Three rules kept this file honest:
 *
 *  - **Blanks are not wrong.** A child who did not attempt a question is
 *    tracked separately, because "did not attempt" and "attempted with a
 *    misconception" need completely different teaching.
 *  - **A question nobody got right is not automatically a hard question.**
 *    It is often a badly written one. `calibrateQuestions` uses the actual
 *    class performance to tell those apart, because a paper that is too hard
 *    tells a teacher nothing useful.
 *  - **Every number can be traced back to a question.** The heatmap cells and
 *    the topic rows both carry the question ids behind them, so a teacher who
 *    doubts a number can open the paper and see it.
 */

import { prisma, parseJson } from "@/lib/db";
import { STRANDS, TOPIC_BY_ID, type CompetencyId } from "@/lib/curriculum";
import { computeMastery, type Evidence, type MasteryResult } from "@/lib/intelligence/mastery";

/* ------------------------------------------------------------------ */
/* Paper-level                                                         */
/* ------------------------------------------------------------------ */

export type QuestionStat = {
  questionId: string;
  position: number;
  stem: string;
  type: string;
  marks: number;
  topicId: string | null;
  topicName: string;
  strand: string;
  competency: string;
  answerKey: string;
  attempted: number;
  correct: number;
  wrong: number;
  blank: number;
  /** Percentage of the class who got it right, 0-100. */
  successRate: number;
  /** Real difficulty from the data, 1 (easy) .. 5 (hard). */
  calibratedDifficulty: number;
  /** Verbatim wrong answers, most common first. */
  topWrong: { response: string; count: number; percentage: number }[];
  /** Misconceptions this question's wrong answers actually revealed. */
  misconceptionCounts: { id: string; count: number }[];
};

export type TopicRow = {
  topicId: string;
  name: string;
  strand: string;
  questions: number;
  studentsAssessed: number;
  averagePercent: number;
  correctRate: number;
  blankRate: number;
  misconceptions: { id: string; count: number }[];
};

export type StrandRow = {
  strand: string;
  name: string;
  color: string;
  topics: number;
  averagePercent: number;
};

export type ClassAnalysis = {
  paperId: string;
  title: string;
  grade: number;
  classId: string | null;
  term: string;
  date: Date;
  maxMarks: number;
  studentCount: number;
  gradedCount: number;
  averagePercent: number;
  medianPercent: number;
  highest: { name: string; percent: number } | null;
  lowest: { name: string; percent: number } | null;
  bandCounts: Record<string, number>;
  topics: TopicRow[];
  strands: StrandRow[];
  questions: QuestionStat[];
  /** The single most common wrong idea in the class. */
  classMisconception: { id: string; count: number; share: number } | null;
  needsReviewCount: number;
};

/** Full analysis of one paper across the whole class. */
export async function analysePaper(paperId: string): Promise<ClassAnalysis | null> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      questions: { orderBy: { position: "asc" } },
      submissions: {
        where: { status: "GRADED" },
        include: {
          student: { select: { id: true, name: true, rollNo: true } },
          answers: true,
        },
      },
    },
  });
  if (!paper) return null;

  const subs = paper.submissions;
  const students = subs.map((s) => s.student);
  const scores = subs.map((s) => (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0)).sort((a, b) => a - b);
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const median =
    scores.length > 0
      ? scores.length % 2 === 0
        ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
        : scores[Math.floor(scores.length / 2)]
      : 0;

  /* ---- per question ---- */
  const answersByQuestion = new Map<string, { response: string; isCorrect: boolean | null; errorTag: string | null }[]>();
  for (const sub of subs) {
    for (const a of sub.answers) {
      const list = answersByQuestion.get(a.paperQuestionId) ?? [];
      list.push({ response: a.response, isCorrect: a.isCorrect, errorTag: a.errorTag });
      answersByQuestion.set(a.paperQuestionId, list);
    }
  }

  const questions: QuestionStat[] = paper.questions.map((q) => {
    const list = answersByQuestion.get(q.id) ?? [];
    const correct = list.filter((a) => a.isCorrect === true).length;
    const blank = list.filter((a) => a.isCorrect === null).length;
    const wrong = list.filter((a) => a.isCorrect === false).length;
    const attempted = correct + wrong;

    // Verbatim wrong answers, grouped.
    const wrongGroups = new Map<string, number>();
    for (const a of list) {
      if (a.isCorrect !== false) continue;
      const key = (a.response || "(blank)").trim().toLowerCase();
      if (!key) continue;
      wrongGroups.set(key, (wrongGroups.get(key) ?? 0) + 1);
    }
    const topWrong = [...wrongGroups.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([response, count]) => ({
        response: response === "(blank)" ? "(not attempted)" : response,
        count,
        percentage: attempted + wrong > 0 ? Math.round((count / (attempted + wrong)) * 100) : 0,
      }));

    const mc = new Map<string, number>();
    for (const a of list) {
      if (a.errorTag) mc.set(a.errorTag, (mc.get(a.errorTag) ?? 0) + 1);
    }
    const misconceptionCounts = [...mc.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);

    const successRate = list.length > 0 ? Math.round((correct / list.length) * 100) : 0;

    return {
      questionId: q.id,
      position: q.position,
      stem: q.stem,
      type: q.type,
      marks: q.marks,
      topicId: q.topicId,
      topicName: q.topicId ? TOPIC_BY_ID.get(q.topicId)?.name ?? q.topicId : "Untagged",
      strand: q.strand,
      competency: q.competency,
      answerKey: q.answerKey,
      attempted,
      correct,
      wrong,
      blank,
      successRate,
      calibratedDifficulty: calibrate(successRate, attempted),
      topWrong,
      misconceptionCounts,
    };
  });

  /* ---- per topic ---- */
  const topicMap = new Map<string, TopicRow>();
  for (const q of questions) {
    const key = q.topicId ?? "untagged";
    const row =
      topicMap.get(key) ??
      ({
        topicId: key,
        name: q.topicId ? TOPIC_BY_ID.get(q.topicId)?.name ?? key : "Untagged",
        strand: q.strand,
        questions: 0,
        studentsAssessed: 0,
        averagePercent: 0,
        correctRate: 0,
        blankRate: 0,
        misconceptions: [],
      } satisfies TopicRow);
    row.questions += 1;
    row.studentsAssessed += q.attempted;
    const correct = q.correct;
    const total = q.attempted + q.blank;
    const prevCorrect = (row as TopicRow & { _c?: number; _b?: number })._c ?? 0;
    const prevBlank = (row as TopicRow & { _b?: number })._b ?? 0;
    (row as TopicRow & { _c?: number; _b?: number })._c = prevCorrect + correct;
    (row as TopicRow & { _b?: number })._b = prevBlank + q.blank;
    row.misconceptions.push(...q.misconceptionCounts);
    void total;
    topicMap.set(key, row);
  }

  const topics: TopicRow[] = [...topicMap.values()].map((row) => {
    const r = row as TopicRow & { _c?: number; _b?: number };
    const correct = r._c ?? 0;
    const blank = r._b ?? 0;
    const considered = correct + blank + Math.max(0, row.studentsAssessed - correct - blank);
    const mc = new Map<string, number>();
    for (const m of row.misconceptions) mc.set(m.id, (mc.get(m.id) ?? 0) + m.count);
    return {
      ...row,
      correctRate: considered > 0 ? Math.round((correct / considered) * 100) : 0,
      blankRate: considered > 0 ? Math.round((blank / considered) * 100) : 0,
      averagePercent: considered > 0 ? Math.round((correct / considered) * 100) : 0,
      misconceptions: [...mc.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, 4),
    };
  }).sort((a, b) => a.averagePercent - b.averagePercent);

  /* ---- per strand ---- */
  const strandMap = new Map<string, { topics: Set<string>; sum: number; n: number }>();
  for (const t of topics) {
    const s = strandMap.get(t.strand) ?? { topics: new Set<string>(), sum: 0, n: 0 };
    s.topics.add(t.topicId);
    s.sum += t.averagePercent;
    s.n += 1;
    strandMap.set(t.strand, s);
  }
  const strands: StrandRow[] = STRANDS.filter((s) => strandMap.has(s.id)).map((s) => {
    const v = strandMap.get(s.id)!;
    return {
      strand: s.id,
      name: s.name,
      color: s.color,
      topics: v.topics.size,
      averagePercent: Math.round(v.sum / Math.max(1, v.n)),
    };
  });

  /* ---- class-wide misconception ---- */
  const classMc = new Map<string, number>();
  for (const t of topics) for (const m of t.misconceptions) classMc.set(m.id, (classMc.get(m.id) ?? 0) + m.count);
  const classTop = [...classMc.entries()].sort((a, b) => b[1] - a[1])[0];
  const totalAnswers = subs.reduce((a, s) => a + s.answers.length, 0);

  const bandCounts: Record<string, number> = {};
  for (const s of scores) {
    const band = bandOf(s);
    bandCounts[band] = (bandCounts[band] ?? 0) + 1;
  }

  const ranked = [...subs]
    .map((s) => ({ name: s.student.name, percent: s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0 }))
    .sort((a, b) => b.percent - a.percent);

  const needsReviewCount = subs.reduce(
    (a, s) => a + s.answers.filter((x) => x.needsReview).length,
    0,
  );

  return {
    paperId: paper.id,
    title: paper.title,
    grade: paper.grade,
    classId: paper.classId,
    term: paper.term,
    date: paper.date,
    maxMarks: paper.maxMarks,
    studentCount: students.length,
    gradedCount: subs.length,
    averagePercent: Math.round(avg * 10) / 10,
    medianPercent: Math.round(median * 10) / 10,
    highest: ranked[0] ?? null,
    lowest: ranked[ranked.length - 1] ?? null,
    bandCounts,
    topics,
    strands,
    questions,
    classMisconception: classTop
      ? { id: classTop[0], count: classTop[1], share: totalAnswers > 0 ? Math.round((classTop[1] / totalAnswers) * 100) : 0 }
      : null,
    needsReviewCount,
  };
}

function bandOf(pct: number): string {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B";
  if (pct >= 60) return "C";
  if (pct >= 40) return "D";
  return "E";
}

/**
 * Real difficulty from how the class actually did.
 * 1 means nearly everyone got it; 5 means nearly everyone missed it.
 */
function calibrate(successRate: number, attempted: number): number {
  if (attempted < 3) return 3; // not enough children to say anything useful
  if (successRate >= 90) return 1;
  if (successRate >= 75) return 2;
  if (successRate >= 50) return 3;
  if (successRate >= 25) return 4;
  return 5;
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

export type HeatmapCell = {
  /** Percentage correct, 0-100. null when the topic was not assessed. */
  percent: number | null;
  attempted: number;
  blank: number;
  correct: number;
  questionIds: string[];
};

export type Heatmap = {
  students: { id: string; name: string; rollNo: number | null; percent: number }[];
  topics: { topicId: string; name: string; strand: string; questionCount: number }[];
  /** [studentIndex][topicIndex] */
  cells: HeatmapCell[][];
  overall: number;
};

/** Students × topics, for one paper or for a whole class's history. */
export async function buildHeatmap(opts: { paperId?: string; classId?: string; studentIds?: string[] }): Promise<Heatmap> {
  const submissions = await loadSubmissions(opts);
  if (submissions.length === 0) {
    return { students: [], topics: [], cells: [], overall: 0 };
  }

  const topicIds = new Set<string>();
  for (const s of submissions) {
    for (const pq of s.paper.questions) if (pq.topicId) topicIds.add(pq.topicId);
  }
  const topics = [...topicIds]
    .map((id) => ({ topicId: id, name: TOPIC_BY_ID.get(id)?.name ?? id, strand: TOPIC_BY_ID.get(id)?.strand ?? "number", questionCount: 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const s of submissions) {
    for (const pq of s.paper.questions) {
      const t = topics.find((x) => x.topicId === pq.topicId);
      if (t) t.questionCount += 1;
    }
  }

  const students = submissions
    .map((s) => ({
      id: s.student.id,
      name: s.student.name,
      rollNo: s.student.rollNo,
      percent: s.maxScore > 0 ? Math.round((s.score / s.maxScore) * 100) : 0,
    }))
    .sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999) || a.name.localeCompare(b.name));

  const cells: HeatmapCell[][] = students.map((st) => {
    const sub = submissions.find((s) => s.student.id === st.id)!;
    const perTopic = new Map<string, HeatmapCell>();
    for (const pq of sub.paper.questions) {
      const key = pq.topicId ?? "untagged";
      const cell = perTopic.get(key) ?? { percent: 0, attempted: 0, blank: 0, correct: 0, questionIds: [] };
      const ans = sub.answers.find((a) => a.paperQuestionId === pq.id);
      if (ans) {
        cell.questionIds.push(pq.id);
        if (ans.isCorrect === null) cell.blank += 1;
        else {
          cell.attempted += 1;
          if (ans.isCorrect) cell.correct += 1;
        }
      }
      perTopic.set(key, cell);
    }
    return topics.map((t) => {
      const cell = perTopic.get(t.topicId);
      if (!cell) return { percent: null, attempted: 0, blank: 0, correct: 0, questionIds: [] };
      return { ...cell, percent: cell.attempted > 0 ? Math.round((cell.correct / cell.attempted) * 100) : null };
    });
  });

  const overall = students.length > 0 ? Math.round(students.reduce((a, s) => a + s.percent, 0) / students.length) : 0;
  return { students, topics, cells, overall };
}

type LoadedSubmission = {
  student: { id: string; name: string; rollNo: number | null };
  score: number;
  maxScore: number;
  answers: { paperQuestionId: string; isCorrect: boolean | null }[];
  paper: { questions: { id: string; topicId: string | null }[] };
};

async function loadSubmissions(opts: { paperId?: string; classId?: string; studentIds?: string[] }): Promise<LoadedSubmission[]> {
  const rows = await prisma.submission.findMany({
    where: {
      status: "GRADED",
      ...(opts.paperId ? { paperId: opts.paperId } : opts.classId ? { paper: { classId: opts.classId } } : {}),
      ...(opts.studentIds ? { studentId: { in: opts.studentIds } } : {}),
    },
    include: {
      student: { select: { id: true, name: true, rollNo: true } },
      answers: { select: { paperQuestionId: true, isCorrect: true } },
      paper: { select: { questions: { select: { id: true, topicId: true } } } },
    },
  });
  return rows as unknown as LoadedSubmission[];
}

/* ------------------------------------------------------------------ */
/* Mastery maps                                                        */
/* ------------------------------------------------------------------ */

/** Class-wide mastery per topic, built from every graded submission. */
export async function classMasteryMap(classId: string): Promise<{ topicId: string; mastery: number; assessed: number; gap: number }[]> {
  const submissions = await prisma.submission.findMany({
    where: { status: "GRADED", paper: { classId } },
    include: {
      answers: { include: { paperQuestion: { select: { topicId: true, difficulty: true, marks: true } } } },
    },
    orderBy: { gradedAt: "asc" },
  });

  const byStudentTopic = new Map<string, Map<string, Evidence[]>>();
  for (const sub of submissions) {
    const map = byStudentTopic.get(sub.studentId) ?? new Map<string, Evidence[]>();
    for (const a of sub.answers) {
      const topicId = a.paperQuestion.topicId;
      if (!topicId) continue;
      const list = map.get(topicId) ?? [];
      list.push({
        score: a.marksAwarded,
        maxScore: a.maxMarks || a.paperQuestion.marks,
        difficulty: 3,
        at: sub.gradedAt ?? sub.createdAt,
      });
      map.set(topicId, list);
    }
    byStudentTopic.set(sub.studentId, map);
  }

  // Topic means first, so each student can be shrunk toward the class mean.
  //
  // The first pass uses the *unshrunk* score. Shrinking toward a mean that was
  // itself computed from shrunk values would be circular, and shrinking toward
  // a hardcoded constant (say 0.6) would be worse than useless: every topic
  // would be pulled toward "fine", and a class that is genuinely struggling
  // would never register a gap. A student is shrunk toward where their class
  // actually is on that topic — nothing else.
  const rawTotals = new Map<string, { sum: number; n: number }>();
  const byTopicEvidence = new Map<string, Evidence[][]>();
  for (const map of byStudentTopic.values()) {
    for (const [topicId, evidence] of map) {
      // `.raw` is the unshrunk weighted score; the classMean argument is
      // irrelevant here and only affects the discarded `.mastery` field.
      const m = computeMastery(evidence, 0.6);
      const t = rawTotals.get(topicId) ?? { sum: 0, n: 0 };
      t.sum += m.raw;
      t.n += 1;
      rawTotals.set(topicId, t);
      byTopicEvidence.set(topicId, [...(byTopicEvidence.get(topicId) ?? []), evidence]);
    }
  }
  const classMeans = new Map<string, number>();
  for (const [topicId, t] of rawTotals) {
    classMeans.set(topicId, t.n > 0 ? t.sum / t.n : 0.6);
  }

  const out: { topicId: string; mastery: number; assessed: number; gap: number }[] = [];
  for (const [topicId] of rawTotals) {
    const classMean = classMeans.get(topicId)!;
    const evidenceSets = byTopicEvidence.get(topicId) ?? [];
    const masteries = evidenceSets.map((evidence) => computeMastery(evidence, classMean).mastery);
    const mastery = masteries.length > 0 ? masteries.reduce((a, b) => a + b, 0) / masteries.length : 0;
    out.push({
      topicId,
      mastery: Math.round(mastery * 1000) / 1000,
      assessed: masteries.length,
      gap: 1 - mastery,
    });
  }
  return out.sort((a, b) => a.mastery - b.mastery);
}

/** Per-student mastery, trend and raw evidence for one topic. */
export async function studentMasteryMap(
  studentId: string,
  classId?: string,
): Promise<Record<string, MasteryResult & { classMean: number; misconceptionCounts: Record<string, number> }>> {
  const submissions = await prisma.submission.findMany({
    where: {
      studentId,
      status: "GRADED",
      ...(classId ? { paper: { classId } } : {}),
    },
    include: {
      answers: { include: { paperQuestion: { select: { topicId: true, marks: true, difficulty: true } } } },
    },
    orderBy: { gradedAt: "asc" },
  });

  const byTopic = new Map<string, Evidence[]>();
  const misconceptions = new Map<string, Record<string, number>>();

  for (const sub of submissions) {
    for (const a of sub.answers) {
      const topicId = a.paperQuestion.topicId;
      if (!topicId) continue;
      const list = byTopic.get(topicId) ?? [];
      list.push({
        score: a.marksAwarded,
        maxScore: a.maxMarks || a.paperQuestion.marks,
        difficulty: a.paperQuestion.difficulty,
        at: sub.gradedAt ?? sub.createdAt,
      });
      byTopic.set(topicId, list);

      if (a.errorTag) {
        const bag = misconceptions.get(topicId) ?? {};
        bag[a.errorTag] = (bag[a.errorTag] ?? 0) + 1;
        misconceptions.set(topicId, bag);
      }
    }
  }

  const out: Record<string, MasteryResult & { classMean: number; misconceptionCounts: Record<string, number> }> = {};

  // The real class mean for each of this student's topics, so the prior pulls
  // toward the class rather than toward a constant. Without this, a student
  // who is genuinely behind their class looks merely average.
  const classMeans = new Map<string, number>();
  if (classId) {
    const peers = await prisma.submission.findMany({
      where: { status: "GRADED", paper: { classId }, studentId: { not: studentId } },
      select: {
        gradedAt: true,
        createdAt: true,
        answers: { select: { marksAwarded: true, maxMarks: true, paperQuestion: { select: { topicId: true, marks: true, difficulty: true } } } },
      },
    });
    const sums = new Map<string, { sum: number; n: number }>();
    for (const sub of peers) {
      for (const a of sub.answers) {
        const topicId = a.paperQuestion.topicId;
        if (!topicId) continue;
        const t = sums.get(topicId) ?? { sum: 0, n: 0 };
        t.sum += a.maxMarks > 0 ? a.marksAwarded / a.maxMarks : 0;
        t.n += 1;
        sums.set(topicId, t);
      }
    }
    for (const [topicId, t] of sums) {
      if (t.n > 0) classMeans.set(topicId, t.sum / t.n);
    }
  }

  for (const [topicId, evidence] of byTopic) {
    const m = computeMastery(evidence, classMeans.get(topicId) ?? 0.6);
    out[topicId] = { ...m, classMean: m.classMean, misconceptionCounts: misconceptions.get(topicId) ?? {} };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Question calibration across papers                                 */
/* ------------------------------------------------------------------ */

export type CalibrationRow = {
  questionId: string;
  paperQuestionId: string | null;
  paperId: string | null;
  paperTitle: string | null;
  stem: string;
  topicId: string | null;
  topicName: string;
  /** The difficulty the author claimed, 1..5. */
  authored: number;
  timesUsed: number;
  responses: number;
  successRate: number | null;
  /** Share of all responses that gave the single most common wrong answer. */
  topWrongShare: number;
  /**
   * How far the real success rate sits from what the authored difficulty
   * predicted, in percentage points. Positive = easier than claimed.
   */
  drift: number;
  verdict: "too_easy" | "just_right" | "too_hard" | "ambiguous" | "not_enough_data";
  note: string;
};

/**
 * Compare authored difficulty against how the class actually performed, and
 * flag the questions that are not doing their job.
 *
 * Two things this deliberately does not do:
 *
 * - It does not trust the author. A question marked "hard" that 90% of the
 *   class answered is either mislabelled or badly written, and either way it
 *   should not go back in the paper unchanged.
 * - It does not call a hard question a bad one. A genuinely hard question
 *   with *spread out* wrong answers is fine; the problem is a hard question
 *   where the same wrong answer repeats, which points at the wording.
 *
 * Scoped to a school. The question bank is partly shared and partly private,
 * so a national-bank question is visible to every school and must not carry
 * one school's results with it.
 */
export async function calibrateQuestions(
  opts: { schoolId: string; classId?: string; limit?: number } ,
): Promise<CalibrationRow[]> {
  const limit = opts.limit ?? 50;

  const rows = await prisma.paperQuestion.findMany({
    where: {
      paper: {
        schoolId: opts.schoolId,
        ...(opts.classId ? { classId: opts.classId } : {}),
      },
      answers: { some: {} },
    },
    include: {
      paper: { select: { id: true, title: true } },
      answers: { select: { isCorrect: true, response: true } },
    },
    orderBy: { paper: { date: "desc" } },
    take: limit * 4,
  });

  return rows
    .map((q) => {
      const graded = q.answers.filter((a) => a.isCorrect !== null);
      const correct = graded.filter((a) => a.isCorrect === true).length;
      const successRate = graded.length > 0 ? Math.round((correct / graded.length) * 100) : null;

      // Concentration of one wrong answer is the ambiguity signal.
      const wrongGroups = new Map<string, number>();
      for (const a of q.answers) {
        if (a.isCorrect !== false) continue;
        const key = (a.response ?? "").trim().toLowerCase();
        if (key) wrongGroups.set(key, (wrongGroups.get(key) ?? 0) + 1);
      }
      const topWrongShare =
        q.answers.length > 0 ? Math.max(0, ...wrongGroups.values()) / graded.length || 0 : 0;

      // Authored difficulty 1..5 maps to an expected success rate. A 5 is not
      // meant to be unanswerable, so the floor is 25%, not 0.
      const expected = Math.round(100 - ((q.difficulty - 1) / 4) * 70 - 5);
      const drift = successRate === null ? 0 : successRate - Math.max(25, expected);

      let verdict: CalibrationRow["verdict"] = "not_enough_data";
      let note = `Only ${graded.length} ${graded.length === 1 ? "answer" : "answers"} — not enough to judge.`;

      if (successRate !== null && graded.length >= 8) {
        // Wording suspicion needs *both* a low success rate and a genuinely
        // dominant single wrong answer. Either alone is normal: a hard
        // question will have a low success rate, and a quarter of a class
        // landing on the same error is usually a real misconception rather
        // than a badly written question.
        const dominantWrong = topWrongShare >= 0.5;
        if (dominantWrong && successRate < 70) {
          verdict = "ambiguous";
          note = `Half the class gave the same wrong answer and the overall success rate is low. When one wrong answer is this dominant, suspect the wording — read the question before using it again.`;
        } else if (successRate >= 95) {
          verdict = "too_easy";
          note = "Almost everyone got it. It is not telling you anything about this class.";
        } else if (successRate <= 25) {
          verdict = "too_hard";
          note = "Only a quarter got it. Check this has actually been taught yet.";
        } else if (Math.abs(drift) >= 25) {
          verdict = drift > 0 ? "too_easy" : "too_hard";
          note = drift > 0
            ? `${Math.round(drift)} points easier than the difficulty it is filed under. Resave it at the level it really is.`
            : `${Math.abs(Math.round(drift))} points harder than the difficulty it is filed under. Check it matches what has been taught.`;
        } else {
          verdict = "just_right";
          note = "Working as intended — it separates the class well.";
        }
      }

      return {
        questionId: q.questionId ?? q.id,
        paperQuestionId: q.id,
        paperId: q.paper.id,
        paperTitle: q.paper.title,
        stem: q.stem,
        topicId: q.topicId,
        topicName: TOPIC_BY_ID.get(q.topicId ?? "")?.name ?? "Untagged",
        authored: q.difficulty,
        timesUsed: 1,
        responses: q.answers.length,
        successRate,
        topWrongShare: Math.round(topWrongShare * 100) / 100,
        drift,
        verdict,
        note,
      };
    })
    .sort((a, b) => {
      // Problems first, in the order they are worth fixing.
      const rank: Record<CalibrationRow["verdict"], number> = {
        ambiguous: 0, too_hard: 1, too_easy: 2, just_right: 3, not_enough_data: 4,
      };
      if (rank[a.verdict] !== rank[b.verdict]) return rank[a.verdict] - rank[b.verdict];
      return (a.successRate ?? 0) - (b.successRate ?? 0);
    })
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Question-level wrong answer detail                                 */
/* ------------------------------------------------------------------ */

export type WrongAnswerRow = {
  studentId: string;
  studentName: string;
  response: string;
  isCorrect: boolean | null;
  marksAwarded: number;
  errorTag: string | null;
  reason: string | null;
};

/** Every child's answer to one question, for the "what did the class write" view. */
export async function answersToQuestion(paperId: string, questionId: string): Promise<WrongAnswerRow[]> {
  const rows = await prisma.answer.findMany({
    where: { paperQuestionId: questionId, submission: { paperId } },
    include: { submission: { include: { student: { select: { id: true, name: true } } } } },
  });
  return rows
    .map((a) => ({
      studentId: a.submission.student.id,
      studentName: a.submission.student.name,
      response: a.response,
      isCorrect: a.isCorrect,
      marksAwarded: a.marksAwarded,
      errorTag: a.errorTag,
      reason: a.note,
    }))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

/* ------------------------------------------------------------------ */
/* Error history for one child                                        */
/* ------------------------------------------------------------------ */

export type ErrorHistoryItem = {
  paperTitle: string;
  date: Date;
  topicName: string;
  questionStem: string;
  response: string;
  errorTag: string | null;
};

/** Everything a particular child has got wrong, newest first. */
export async function errorHistory(studentId: string, limit = 30): Promise<ErrorHistoryItem[]> {
  const rows = await prisma.answer.findMany({
    where: { submission: { studentId }, isCorrect: false },
    include: {
      paperQuestion: { select: { stem: true, topicId: true } },
      submission: { select: { paper: { select: { title: true, date: true } } } },
    },
    orderBy: { submission: { gradedAt: "desc" } },
    take: limit,
  });
  return rows.map((a) => ({
    paperTitle: a.submission.paper.title,
    date: a.submission.paper.date,
    topicName: a.paperQuestion.topicId ? TOPIC_BY_ID.get(a.paperQuestion.topicId)?.name ?? a.paperQuestion.topicId : "Untagged",
    questionStem: a.paperQuestion.stem,
    response: a.response,
    errorTag: a.errorTag,
  }));
}

/** Competency distribution for a paper, using the CBSE competency bands. */
export function competencySpread(questions: { competency: string; successRate: number }[]): { level: CompetencyId; percent: number }[] {
  const bands: { level: CompetencyId; hits: number; total: number }[] = [
    { level: "basic", hits: 0, total: 0 },
    { level: "competent", hits: 0, total: 0 },
    { level: "proficient", hits: 0, total: 0 },
  ];
  for (const q of questions) {
    const band = bands.find((b) => b.level === q.competency);
    if (!band) continue;
    band.total += 1;
    if (q.successRate >= 70) band.hits += 1;
  }
  return bands.map((b) => ({ level: b.level, percent: b.total > 0 ? Math.round((b.hits / b.total) * 100) : 0 }));
}

export { parseJson };
