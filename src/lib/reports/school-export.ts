/**
 * Whole-school data export.
 *
 * Two different needs are served here, and confusing them would be a mistake:
 *
 * 1. **Portability.** DPDP Act 2023 gives a parent the right to a copy of
 *    their child's data, and a school the right to archive its records.
 * 2. **Dead reckoning.** Knowing before a year of data goes in that it can be
 *    taken out is worth more than knowing afterwards.
 *
 * ## Raw responses, not just summaries
 *
 * Most exports stop at marks, which loses the answer itself, the mark a human
 * gave and the note they wrote — none of which can be recovered from a score.
 * Answer-level rows are included so this is a backup, not a summary of one.
 *
 * ## The distinction this must not lose
 *
 * `Answer.isCorrect` is nullable, and **null means the child left it blank**.
 * That is not the same as wrong, and the whole analysis engine depends on the
 * difference: a question a class found hard and a question they skipped are
 * different findings. An export that flattened null to false would silently
 * destroy that, so it is written as `blank`, `wrong` or `correct` and never as
 * a bare boolean.
 *
 * ## What is deliberately absent
 *
 * No risk label, no inferred trait, no `confidence` from the grading engine.
 * Those are working hypotheses. Exporting them as data would turn a guess into
 * a fact the moment it left the building, where it would be read as an
 * assessment result.
 */

import { prisma } from "@/lib/db";
import { TOPIC_BY_ID } from "@/lib/curriculum";
import { resolveDepth } from "@/lib/competition";

/** "blank" is a real third state, not an error to normalise away. */
export type AnswerOutcome = "correct" | "wrong" | "blank";

export function outcomeOf(isCorrect: boolean | null): AnswerOutcome {
  if (isCorrect === null) return "blank";
  return isCorrect ? "correct" : "wrong";
}

export type SchoolExport = {
  generatedAt: string;
  school: { name: string; code: string; academicYear: string; city: string | null; state: string | null };
  scope: { classes: number; students: number; papers: number; submissions: number; answers: number };
  students: { className: string; grade: number; name: string; rollNo: number | null; dob: string | null; note: string | null }[];
  papers: { id: string; title: string; className: string; term: string; date: string; maxMarks: number; status: string; source: string }[];
  submissions: {
    id: string; paperTitle: string; className: string; studentName: string;
    score: number; maxScore: number; percent: number | null; grade: string | null; gradedAt: string | null;
  }[];
  answers: {
    studentName: string; paperTitle: string; className: string; questionNo: number;
    question: string; topic: string | null; response: string; outcome: AnswerOutcome;
    awarded: number; maxMarks: number; needsReview: boolean; errorTag: string | null; note: string | null;
  }[];
  otherSubjects: { className: string; studentName: string; subject: string; marks: number; maxMarks: number }[];
  attendance: { className: string; studentName: string; date: string; status: string }[];
  curriculum: { id: string; name: string; nameHi: string; strand: string; classes: number[] }[];
  depthOverrides: DepthMapRow[];
  manifest: string[];
};

export async function buildSchoolExport(
  schoolId: string,
  opts: { restrictToClasses?: string[] } = {},
): Promise<SchoolExport | null> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true, code: true, academicYear: true, city: true, state: true },
  });
  if (!school) return null;

  const classes = await prisma.class.findMany({
    where: { schoolId, ...(opts.restrictToClasses ? { id: { in: opts.restrictToClasses } } : {}) },
    select: {
      id: true, name: true, grade: true,
      enrollments: { select: { student: { select: { name: true, rollNo: true, dob: true, note: true } } } },
    },
    orderBy: [{ grade: "asc" }, { name: "asc" }],
  });
  const classIds = classes.map((c) => c.id);
  if (classIds.length === 0) return null;

  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  // A paper can exist with no class — created before one was chosen. That is
  // a real state, not an error, so it exports as an empty class name.
  const className = (id: string | null) => (id ? classNameById.get(id) ?? "" : "");

  const papers = await prisma.paper.findMany({
    where: { classId: { in: classIds } },
    select: { id: true, title: true, classId: true, term: true, date: true, maxMarks: true, status: true, source: true },
    orderBy: { date: "desc" },
  });
  const paperById = new Map(papers.map((p) => [p.id, p]));

  const submissions = await prisma.submission.findMany({
    where: { paperId: { in: papers.map((p) => p.id) } },
    select: {
      id: true, paperId: true, score: true, maxScore: true, gradeBand: true, gradedAt: true,
      student: { select: { name: true } },
    },
  });
  const subById = new Map(submissions.map((s) => [s.id, s]));

  const answers = submissions.length > 0
    ? await prisma.answer.findMany({
        where: { submissionId: { in: submissions.map((s) => s.id) } },
        select: {
          submissionId: true, response: true, isCorrect: true, marksAwarded: true,
          maxMarks: true, needsReview: true, errorTag: true, note: true,
          paperQuestion: { select: { position: true, stem: true, topicId: true } },
        },
      })
    : [];

  const otherSubjects = await prisma.otherSubjectMark.findMany({
    where: { classId: { in: classIds } },
    select: { marks: true, maxMarks: true, subject: true, classId: true, student: { select: { name: true } } },
  });

  const attendance = await prisma.attendanceRecord.findMany({
    where: { classId: { in: classIds } },
    select: { date: true, status: true, classId: true, student: { select: { name: true } } },
    orderBy: { date: "asc" },
  });

  const generatedAt = new Date().toISOString();

  return {
    generatedAt,
    school,
    scope: {
      classes: classes.length,
      students: classes.reduce((a, c) => a + c.enrollments.length, 0),
      papers: papers.length,
      submissions: submissions.length,
      answers: answers.length,
    },
    students: classes.flatMap((c) =>
      c.enrollments
        .map((e) => e.student)
        .sort((a, b) => (a.rollNo ?? 99) - (b.rollNo ?? 99) || a.name.localeCompare(b.name))
        .map((s) => ({
          className: c.name, grade: c.grade, name: s.name, rollNo: s.rollNo,
          dob: s.dob ? s.dob.toISOString().slice(0, 10) : null, note: s.note ?? null,
        })),
    ),
    papers: papers.map((p) => ({
      id: p.id, title: p.title, className: className(p.classId),
      term: p.term, date: p.date.toISOString().slice(0, 10), maxMarks: p.maxMarks,
      status: p.status, source: p.source,
    })),
    submissions: submissions.map((s) => {
      const p = paperById.get(s.paperId);
      return {
        id: s.id,
        paperTitle: p?.title ?? "",
        className: p ? className(p.classId) : "",
        studentName: s.student.name,
        score: s.score,
        maxScore: s.maxScore,
        // Null when the paper carried no marks, rather than a division by zero.
        percent: s.maxScore > 0 ? Math.round((s.score / s.maxScore) * 1000) / 10 : null,
        grade: s.gradeBand,
        gradedAt: s.gradedAt ? s.gradedAt.toISOString() : null,
      };
    }),
    answers: answers.map((a) => {
      const sub = subById.get(a.submissionId);
      const paper = sub ? paperById.get(sub.paperId) : undefined;
      return {
        studentName: sub?.student.name ?? "",
        paperTitle: paper?.title ?? "",
        className: paper ? className(paper.classId) : "",
        questionNo: a.paperQuestion.position,
        question: a.paperQuestion.stem,
        topic: a.paperQuestion.topicId ? TOPIC_BY_ID.get(a.paperQuestion.topicId)?.name ?? null : null,
        response: a.response,
        outcome: outcomeOf(a.isCorrect),
        awarded: a.marksAwarded,
        maxMarks: a.maxMarks,
        needsReview: a.needsReview,
        errorTag: a.errorTag,
        note: a.note,
      };
    }),
    otherSubjects: otherSubjects.map((m) => ({
      className: className(m.classId), studentName: m.student.name,
      subject: m.subject, marks: m.marks, maxMarks: m.maxMarks,
    })),
    attendance: attendance.map((r) => ({
      className: className(r.classId), studentName: r.student.name,
      date: r.date.toISOString().slice(0, 10), status: r.status,
    })),
    curriculum: [...TOPIC_BY_ID.values()].map((t) => ({
      id: t.id, name: t.name, nameHi: t.nameHi ?? "", strand: t.strand, classes: t.classes,
    })),
    depthOverrides: await depthOverridesFor(schoolId),
    manifest: [
      "Assessment records, attendance, imported other-subject marks and the curriculum map.",
      "No risk label, no inferred trait and no grading-confidence figure are included. Those are the app's working hypotheses; exporting them as data would turn a guess into a fact.",
      "A blank answer is written as 'blank' and is never merged with 'wrong' — a class that found a question hard and a class that skipped it are different findings.",
      "Raw responses and teacher notes are included, because those cannot be recovered from a score.",
      "Imported other-subject marks are context only and were never used in any mathematics calculation.",
      "This school's corrections to the competitive-depth map are included, with the reason given for each and the bundled answer they replaced. Re-importing them elsewhere applies them there; they are not merged with that school's own.",
    ],
  };
}

/* ------------------------------------------------------------------ */
/* The competitive-depth map, as a portable file                        */
/* ------------------------------------------------------------------ */

export type DepthMapRow = {
  topicId: string;
  topicName: string;
  /** What this school decided. */
  tier: number;
  idea: string | null;
  /** Why, as recorded when the correction was made. */
  note: string | null;
  /** What this build of the app would have said. */
  bundledTier: number;
  bundledIdea: string | null;
  /** True when this build has since changed its own answer, so the shared
      file is no longer a straight "differs from" list. */
  bundledChanged: boolean;
};

async function depthOverridesFor(schoolId: string): Promise<DepthMapRow[]> {
  const rows = await prisma.topicDepthOverride.findMany({
    where: { schoolId },
    select: { topicId: true, tier: true, idea: true, note: true },
    orderBy: { topicId: "asc" },
  });
  return rows.map((r) => {
    const bundled = resolveDepth(r.topicId);
    const meta = TOPIC_BY_ID.get(r.topicId);
    return {
      topicId: r.topicId,
      topicName: meta?.name ?? r.topicId,
      tier: r.tier,
      idea: r.idea,
      note: r.note,
      bundledTier: bundled.tier,
      bundledIdea: bundled.idea,
      bundledChanged: bundled.tier !== r.tier || (bundled.idea ?? null) !== (r.idea ?? null),
    };
  });
}

export type DepthMapFile = {
  format: "kapigyan-depth-map";
  version: 1;
  exportedAt: string;
  school: { name: string; code: string };
  corrections: DepthMapRow[];
  manifest: string[];
};

/**
 * The school's tuned map as a file another school can read.
 *
 * Each row carries the bundled answer it replaced alongside the school's own, so
 * the receiving school can see what it is being asked to change and disagree if
 * it likes. Shipping only the school's conclusions would make the file look like
 * an authority rather than one school's opinion.
 */
export async function buildDepthMapExport(schoolId: string): Promise<DepthMapFile | null> {
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { name: true, code: true } });
  if (!school) return null;

  return {
    format: "kapigyan-depth-map",
    version: 1,
    exportedAt: new Date().toISOString(),
    school,
    corrections: await depthOverridesFor(schoolId),
    manifest: [
      "These are one school's corrections to this app's competitive-depth map, which is itself a structural interpretation and not a published syllabus.",
      "Each row states what the school decided and what this build would have said, so nothing here has to be taken on trust.",
      "Importing applies the corrections to the importing school only. Schools do not share a map.",
      "Topics this app has no bundle entry for are kept as rows but marked unknown, rather than dropped.",
    ],
  };
}
