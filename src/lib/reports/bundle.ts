/**
 * Report bundle.
 *
 * Every export format and every on-screen report is built from one bundle, so
 * the PDF a teacher downloads, the Excel they paste into the register, and
 * the page they printed on the way out of school cannot disagree with each
 * other. Formats differ; the numbers do not.
 */

import { prisma, parseJson } from "@/lib/db";
import { MISCONCEPTION_BY_ID, STRAND_BY_ID, TOPIC_BY_ID, gradeBand } from "@/lib/curriculum";
import { analysePaper, type ClassAnalysis } from "@/lib/analytics/class";

export type StudentRow = {
  rollNo: number | null;
  name: string;
  studentId: string;
  score: number;
  maxScore: number;
  percent: number;
  grade: string;
  correct: number;
  wrong: number;
  blank: number;
  partial: number;
  topMisconception: string | null;
  errorCount: number;
};

export type ReportBundle = {
  school: { name: string; city: string | null; state: string | null };
  /**
   * Only what a printed report shows. The underlying row also carries `id` and
   * `teacherId`, which the access check needs but a document must never carry.
   */
  class: { name: string; grade: number; section: string | null } | null;
  paper: {
    id: string;
    title: string;
    grade: number;
    term: string;
    date: Date;
    maxMarks: number;
    totalQuestions: number;
    timeMinutes: number | null;
  };
  analysis: ClassAnalysis;
  students: StudentRow[];
  topics: {
    topicId: string;
    name: string;
    strand: string;
    strandName: string;
    correctRate: number;
    blankRate: number;
    misconceptions: { id: string; name: string; count: number }[];
  }[];
  questions: {
    position: number;
    stem: string;
    type: string;
    marks: number;
    topicId: string | null;
    topicName: string;
    answerKey: string;
    successRate: number;
    topWrong: { response: string; count: number }[];
  }[];
  generatedAt: Date;
};

export async function buildReport(paperId: string, schoolId: string): Promise<ReportBundle | null> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      school: { select: { name: true, city: true, state: true } },
      class: { select: { id: true, name: true, grade: true, section: true, teacherId: true } },
      questions: { orderBy: { position: "asc" } },
      submissions: {
        include: {
          student: { select: { id: true, name: true, rollNo: true } },
          answers: { select: { isCorrect: true, marksAwarded: true, errorTag: true } },
        },
      },
    },
  });
  if (!paper || paper.schoolId !== schoolId) return null;

  const analysis = await analysePaper(paperId);
  if (!analysis) return null;

  const students: StudentRow[] = paper.submissions
    .map((s) => {
      const answered = s.answers.filter((a) => a.isCorrect !== null);
      const correct = s.answers.filter((a) => a.isCorrect === true).length;
      const wrong = s.answers.filter((a) => a.isCorrect === false && a.marksAwarded === 0).length;
      const blank = s.answers.filter((a) => a.isCorrect === null).length;
      const partial = s.answers.filter((a) => a.isCorrect === false && a.marksAwarded > 0).length;
      const errorCounts = new Map<string, number>();
      for (const a of s.answers) {
        if (a.errorTag) errorCounts.set(a.errorTag, (errorCounts.get(a.errorTag) ?? 0) + 1);
      }
      const top = [...errorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const percent = s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0;

      return {
        rollNo: s.student.rollNo,
        name: s.student.name,
        studentId: s.student.id,
        score: s.score,
        maxScore: s.maxScore,
        percent: Math.round(percent * 10) / 10,
        grade: gradeBand(percent).grade,
        correct,
        wrong,
        blank,
        partial,
        topMisconception: top,
        errorCount: [...errorCounts.values()].reduce((a, b) => a + b, 0),
      };
    })
    .sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999));

  const topics = analysis.topics.map((t) => ({
    topicId: t.topicId,
    name: t.name,
    strand: t.strand,
    strandName: STRAND_BY_ID.get(t.strand)?.name ?? t.strand,
    correctRate: t.correctRate,
    blankRate: t.blankRate,
    misconceptions: t.misconceptions
      .map((m) => ({ id: m.id, name: MISCONCEPTION_BY_ID.get(m.id)?.name ?? m.id, count: m.count }))
      .filter((m) => m.name !== m.id || MISCONCEPTION_BY_ID.has(m.id)),
  }));

  const questions = analysis.questions.map((q) => ({
    position: q.position,
    stem: q.stem,
    type: q.type,
    marks: q.marks,
    topicId: q.topicId,
    topicName: q.topicId ? TOPIC_BY_ID.get(q.topicId)?.name ?? q.topicId : "Untagged",
    answerKey: q.answerKey,
    successRate: q.successRate,
    topWrong: q.topWrong.map((w) => ({ response: w.response, count: w.count })),
  }));

  return {
    school: paper.school,
    class: paper.class
      ? { name: paper.class.name, grade: paper.class.grade, section: paper.class.section }
      : null,
    paper: {
      id: paper.id,
      title: paper.title,
      grade: paper.grade,
      term: paper.term,
      date: paper.date,
      maxMarks: paper.maxMarks,
      totalQuestions: paper.questions.length,
      timeMinutes: paper.timeMinutes,
    },
    analysis,
    students,
    topics,
    questions,
    generatedAt: new Date(),
  };
}

/** School header lines reused by every format. */
export function reportHeading(b: ReportBundle): string[] {
  return [
    b.school.name,
    [b.school.city, b.school.state].filter(Boolean).join(", "),
    b.class ? `Class ${b.class.grade} · ${b.class.name}` : `Class ${b.paper.grade}`,
    `${b.paper.title} · ${b.paper.term} · ${b.paper.date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
  ];
}

export { parseJson };
