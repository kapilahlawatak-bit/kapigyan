"use server";

/**
 * Paper and marking actions.
 *
 * Every action follows the same discipline: check who is asking, check that
 * the thing belongs to them, do the work, then refresh. Grading always
 * recomputes from the stored answers rather than trusting anything sent from
 * the browser, so a teacher cannot be tricked into recording a wrong mark by
 * editing a hidden field.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, toJson } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { requireSession, assertClassAccess, type SchoolSession } from "@/lib/auth/guard";
import { canTeach } from "@/lib/auth/roles";
import { TOPIC_BY_ID, gradeBand } from "@/lib/curriculum";
import { buildPaper, diagnosticBlueprint, gapBlueprint } from "@/lib/paper/generator";
import { gradeSubmission } from "@/lib/grading";
import { parseQuestionsFromImage, parseQuestionsFromText, extractText, validateUpload } from "@/lib/ai/parse-paper";

export type ActionResult = { ok: true; id: string } | { ok: false; error: string; shortfall?: unknown };

/**
 * A teacher session, resolved from the database rather than the cookie.
 *
 * These actions write marks, so they used to read `getSession()` and trust the
 * role the token was minted with — which a fourteen-day expiry would keep
 * honouring after a demotion. `requireSession` re-reads the row on each call;
 * the throws are kept (rather than the guard's redirect) because every caller
 * here is a server action that reports failure to a teacher on a form.
 */
async function requireTeacher(): Promise<SchoolSession> {
  const session = await requireSession();
  if (!canTeach(session.role)) throw new Error("Not allowed");
  if (!session.schoolId) throw new Error("No school");
  return session as SchoolSession;
}

/* ------------------------------------------------------------------ */
/* Parsing an upload (no persistence — review screen decides what to keep) */
/* ------------------------------------------------------------------ */

export type ParseState = {
  status: "idle" | "working" | "done" | "error";
  message?: string;
  result?: {
    questions: {
      stem: string; stemHi?: string; type: string; options: string[]; answerKey: string;
      accepted: string[]; marks: number; topicId: string | null; strand: string;
      topicConfidence: number; competency: string; difficulty: number; explanation: string;
    }[];
    notes: string[];
    method: string;
  };
  fileName?: string;
};

export async function parseUpload(_prev: ParseState, formData: FormData): Promise<ParseState> {
  let session;
  try {
    session = await requireTeacher();
  } catch {
    return { status: "error", message: "Please sign in again." };
  }

  const file = formData.get("file");
  const grade = Number(formData.get("grade") ?? 3);
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", message: "Choose a file first." };
  }

  const invalid = validateUpload(file);
  if (invalid) return { status: "error", message: invalid };

  try {
    if (file.type.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(file.name)) {
      const parsed = await parseQuestionsFromImage(file, grade);
      return { status: "done", fileName: file.name, result: parsed, message: notesMessage(parsed.notes, parsed.method) };
    }

    const extracted = await extractText(file);
    if (extracted.warning && extracted.text.trim().length < 40) {
      return { status: "error", message: extracted.warning };
    }
    const parsed = await parseQuestionsFromText(extracted.text, grade);
    return {
      status: "done",
      fileName: file.name,
      result: parsed,
      message: notesMessage(parsed.notes, parsed.method, extracted.kind),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "That file could not be read. Try a different one.",
    };
  }
}

function notesMessage(notes: string[], method: string, kind?: string): string {
  const how =
    method === "ai-vision" ? "Read with the AI vision model."
    : method === "ai-text" ? "Read with AI."
    : "Read without AI, so the topics below are a first guess — please check them.";
  const extra = notes.length > 0 ? ` ${notes.join(" ")}` : "";
  return kind ? `${how}${extra}` : how + extra;
}

/* ------------------------------------------------------------------ */
/* Create a paper from reviewed questions                              */
/* ------------------------------------------------------------------ */

const createSchema = z.object({
  classId: z.string().optional().nullable(),
  title: z.string().trim().min(1).max(160),
  term: z.string().trim().min(1).max(40),
  grade: z.coerce.number().int().min(1).max(5),
  sourceMeta: z.string().optional(),
  questions: z.array(
    z.object({
      stem: z.string().trim().min(1),
      type: z.string(),
      options: z.array(z.string()).default([]),
      answerKey: z.string(),
      accepted: z.array(z.string()).default([]),
      marks: z.coerce.number().min(0).max(10),
      topicId: z.string().nullable(),
      competency: z.string().default("basic"),
      difficulty: z.coerce.number().int().min(1).max(5).default(2),
      explanation: z.string().default(""),
      stemHi: z.string().optional(),
    }),
  ).min(1, "A paper needs at least one question"),
});

export async function createPaperFromReview(formData: FormData): Promise<void> {
  const session = await requireTeacher();

  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    throw new Error("Could not read the questions");
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid paper");
  }
  const data = parsed.data;

  // Ownership check on the class.
  if (data.classId) {
    const cls = await prisma.class.findUnique({ where: { id: data.classId }, select: { schoolId: true, grade: true } });
    if (!cls || cls.schoolId !== session.schoolId) throw new Error("That class is not yours");
  }

  const paper = await prisma.paper.create({
    data: {
      schoolId: session.schoolId,
      classId: data.classId || null,
      createdBy: session.userId,
      title: data.title,
      grade: data.grade,
      term: data.term,
      source: "UPLOADED",
      status: "DRAFT",
      maxMarks: data.questions.reduce((a, q) => a + q.marks, 0),
      sourceMeta: data.sourceMeta ?? "{}",
      questions: {
        create: data.questions.map((q, i) => ({
          position: i + 1,
          topicId: q.topicId || null,
          strand: q.topicId ? TOPIC_BY_ID.get(q.topicId)?.strand ?? "number" : "number",
          competency: q.competency,
          type: q.type,
          marks: q.marks,
          difficulty: q.difficulty,
          stem: q.stem,
          stemHi: q.stemHi ?? null,
          options: toJson(q.options),
          answerKey: q.answerKey,
          accepted: toJson(q.accepted),
          markScheme: "{}",
          explanation: q.explanation || null,
        })),
      },
    },
  });

  revalidatePath("/tests");
  redirect(`/tests/${paper.id}`);
}

/* ------------------------------------------------------------------ */
/* Generate a paper                                                    */
/* ------------------------------------------------------------------ */

export async function generatePaper(formData: FormData): Promise<void> {
  const session = await requireTeacher();

  const classId = String(formData.get("classId") ?? "") || null;
  const grade = Number(formData.get("grade") ?? 3);
  const totalMarks = Number(formData.get("totalMarks") ?? 20);
  const mode = String(formData.get("mode") ?? "diagnostic");
  const title = String(formData.get("title") ?? "") || undefined;
  const term = String(formData.get("term") ?? "Term 1");
  const topicIds = formData.getAll("topicIds").map(String).filter(Boolean);

  // 0 = an ordinary school paper. Read and clamped rather than trusted: a form
  // field is not a boundary, and an out-of-range tier would ask the transforms
  // for a depth no topic in the taxonomy reaches.
  const rawTier = Number(formData.get("competitionTier") ?? 0);
  const competitionTier = Number.isFinite(rawTier) ? Math.max(0, Math.min(3, Math.trunc(rawTier))) : 0;

  if (classId) {
    const cls = await prisma.class.findUnique({ where: { id: classId }, select: { schoolId: true } });
    if (!cls || cls.schoolId !== session.schoolId) throw new Error("That class is not yours");
    // Ownership, not just school membership — the same reason the paper pages
    // check it, and the same reason this action used to be able to write
    // attendance-style data into a colleague's class.
    await assertClassAccess(session, classId);
  }

  const blueprint =
    mode === "gap"
      ? gapBlueprint({ grade, totalMarks, mastery: await masteryForClass(classId), title, term })
      : diagnosticBlueprint({ grade, totalMarks, topicIds, title, term });

  const result = await buildPaper({
    ...blueprint,
    schoolId: session.schoolId,
    classId,
    grade,
    createdBy: session.userId,
    competitionTier,
    seed: `${session.userId}:${grade}:${mode}:${competitionTier}:${topicIds.join(",")}:${Date.now() >> 16}`,
  });

  revalidatePath("/tests");
  redirect(`/tests/${result.paperId}`);
}

async function masteryForClass(classId: string | null): Promise<Record<string, number>> {
  if (!classId) return {};
  const { classMasteryMap } = await import("@/lib/analytics/class");
  const rows = await classMasteryMap(classId);
  return Object.fromEntries(rows.map((r) => [r.topicId, r.mastery]));
}

/* ------------------------------------------------------------------ */
/* Students                                                            */
/* ------------------------------------------------------------------ */

export async function addStudents(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const classId = String(formData.get("classId") ?? "");
  const raw = String(formData.get("names") ?? "");

  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { schoolId: true } });
  if (!cls || cls.schoolId !== session.schoolId) throw new Error("That class is not yours");

  const names = raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 80);
  if (names.length === 0) return;

  const existing = await prisma.enrollment.findMany({
    where: { classId },
    select: { rollNo: true },
    orderBy: { rollNo: "desc" },
    take: 1,
  });
  let roll = (existing[0]?.rollNo ?? 0) + 1;

  for (const name of names) {
    const student = await prisma.student.create({ data: { name, rollNo: roll } });
    await prisma.enrollment.create({ data: { classId, studentId: student.id, rollNo: roll } });
    roll += 1;
  }

  revalidatePath("/classes");
  revalidatePath("/students");
}

/* ------------------------------------------------------------------ */
/* Marking                                                             */
/* ------------------------------------------------------------------ */

/**
 * Record a child's answers and mark them.
 * Called once per student per paper.
 */
export async function markSubmission(formData: FormData): Promise<void> {
  const session = await requireTeacher();

  const paperId = String(formData.get("paperId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  if (!paper || paper.schoolId !== session.schoolId) throw new Error("That test is not yours");
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const enrolled = await prisma.enrollment.findFirst({
    where: { studentId, classId: paper.classId ?? "__none__" },
    select: { id: true },
  });
  if (!enrolled && paper.classId) throw new Error("That student is not in this class");

  // Collect responses straight from the form, keyed by paper question id.
  const responses = paper.questions.map((q) => ({
    paperQuestionId: q.id,
    response: String(formData.get(`q_${q.id}`) ?? "").trim(),
  }));

  const result = gradeSubmission(
    paper.questions.map((q) => ({
      id: q.id,
      type: q.type,
      stem: q.stem,
      options: q.options,
      answerKey: q.answerKey,
      accepted: q.accepted,
      markScheme: q.markScheme,
      topicId: q.topicId,
      strand: q.strand,
      competency: q.competency,
      marks: q.marks,
    })),
    responses,
  );

  // Overwrite any previous attempt for this student.
  await prisma.answer.deleteMany({ where: { submission: { paperId, studentId } } });
  await prisma.submission.deleteMany({ where: { paperId, studentId } });

  const band = gradeBand(result.percentage);

  await prisma.submission.create({
    data: {
      paperId,
      studentId,
      userId: session.userId,
      status: "GRADED",
      entryMode: "AOM",
      score: result.score,
      maxScore: result.maxScore,
      gradeBand: band.grade,
      breakdown: toJson({ topics: result.topicBreakdown, misconceptions: result.misconceptionCounts, counts: result.counts }),
      manualShare: result.manualShare,
      gradedAt: new Date(),
      answers: {
        create: result.answers.map((a) => ({
          paperQuestionId: a.paperQuestionId,
          response: a.response,
          isCorrect: a.isCorrect,
          marksAwarded: a.marksAwarded,
          maxMarks: a.maxMarks,
          errorTag: a.errorTag,
          confidence: a.confidence,
          needsReview: a.needsReview,
          note: a.reason,
        })),
      },
    },
  });

  await prisma.paper.update({ where: { id: paperId }, data: { status: "PUBLISHED" } });

  revalidatePath(`/tests/${paperId}`);
  redirect(`/tests/${paperId}?marked=${encodeURIComponent(studentId)}`);
}

/** Mark every student in the class at once, from a grid of scores. */
export async function markAll(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const paperId = String(formData.get("paperId") ?? "");

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      questions: { orderBy: { position: "asc" } },
      class: { include: { enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } } } },
    },
  });
  if (!paper || paper.schoolId !== session.schoolId) throw new Error("That test is not yours");
  if (paper.classId) await assertClassAccess(session, paper.classId);
  if (!paper.class) throw new Error("Assign this test to a class first");

  for (const enrolment of paper.class.enrollments) {
    const studentId = enrolment.studentId;
    const responses = paper.questions.map((q) => ({
      paperQuestionId: q.id,
      response: String(formData.get(`q_${studentId}_${q.id}`) ?? "").trim(),
    }));

    const result = gradeSubmission(
      paper.questions.map((q) => ({
        id: q.id, type: q.type, stem: q.stem, options: q.options, answerKey: q.answerKey,
        accepted: q.accepted, markScheme: q.markScheme, topicId: q.topicId, strand: q.strand,
        competency: q.competency, marks: q.marks,
      })),
      responses,
    );

    await prisma.answer.deleteMany({ where: { submission: { paperId, studentId } } });
    await prisma.submission.deleteMany({ where: { paperId, studentId } });

    const band = gradeBand(result.percentage);
    await prisma.submission.create({
      data: {
        paperId, studentId, userId: session.userId, status: "GRADED", entryMode: "AOM",
        score: result.score, maxScore: result.maxScore, gradeBand: band.grade,
        breakdown: toJson({ topics: result.topicBreakdown, misconceptions: result.misconceptionCounts, counts: result.counts }),
        manualShare: result.manualShare, gradedAt: new Date(),
        answers: {
          create: result.answers.map((a) => ({
            paperQuestionId: a.paperQuestionId, response: a.response, isCorrect: a.isCorrect,
            marksAwarded: a.marksAwarded, maxMarks: a.maxMarks, errorTag: a.errorTag,
            confidence: a.confidence, needsReview: a.needsReview, note: a.reason,
          })),
        },
      },
    });
  }

  await prisma.paper.update({ where: { id: paperId }, data: { status: "PUBLISHED" } });
  revalidatePath(`/tests/${paperId}`);
  redirect(`/tests/${paperId}?done=1`);
}

/** A marker overriding one automated decision. */
export async function overrideAnswer(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const answerId = String(formData.get("answerId") ?? "");
  const decision = String(formData.get("decision") ?? "keep");

  // Validated rather than switched on. An unrecognised value used to fall
  // through both branches and still call `recomputeSubmission`, so a malformed
  // form re-saved the child's total and reported success without changing a
  // single mark — which reads on screen as "the override worked".
  if (decision !== "correct" && decision !== "wrong") {
    throw new Error("Choose whether the teacher marked this answer right or wrong");
  }

  const answer = await prisma.answer.findUnique({
    where: { id: answerId },
    include: {
      submission: {
        include: { paper: { select: { id: true, schoolId: true, classId: true, title: true } } },
      },
    },
  });
  if (!answer || answer.submission.paper.schoolId !== session.schoolId) throw new Error("Not allowed");
  // Overrule the engine and turn a wrong answer into a right one, for any child
  // in the school. That is the single most consequential edit this app makes,
  // so it is ownership-checked and recorded in the audit log below.
  if (answer.submission.paper.classId) await assertClassAccess(session, answer.submission.paper.classId);

  // What the engine said, before the teacher overrules it. This is the whole
  // reason for the audit row: the `note` string on the answer records what
  // someone wrote, not what changed, so without this there is no way to tell
  // later that a wrong answer had been silently promoted.
  const before = {
    isCorrect: answer.isCorrect,
    marksAwarded: answer.marksAwarded,
    errorTag: answer.errorTag,
    response: answer.response,
  };

  if (decision === "correct") {
    await prisma.answer.update({
      where: { id: answerId },
      data: { isCorrect: true, marksAwarded: answer.maxMarks, errorTag: null, needsReview: false, note: "Marked correct by the teacher" },
    });
  } else {
    await prisma.answer.update({
      where: { id: answerId },
      data: { isCorrect: false, marksAwarded: 0, needsReview: false, note: "Marked wrong by the teacher" },
    });
  }

  await recordAudit({
    schoolId: session.schoolId,
    actorId: session.userId,
    actorName: session.name,
    action: "mark_override",
    studentId: answer.submission.studentId,
    paperId: answer.submission.paper.id,
    classId: answer.submission.paper.classId,
    before,
    after: {
      isCorrect: decision === "correct",
      marksAwarded: decision === "correct" ? answer.maxMarks : 0,
      errorTag: decision === "correct" ? null : answer.errorTag,
    },
    detail:
      decision === "correct"
        ? `Teacher marked "${answer.response || "a blank answer"}" correct, over the engine's ${before.isCorrect === true ? "correct" : before.isCorrect === null ? "not-attempted" : "wrong"}.`
        : `Teacher marked "${answer.response || "a blank answer"}" wrong.`,
  });

  await recomputeSubmission(answer.submissionId);
  revalidatePath(`/tests/${answer.submission.paper.id}`);
}

async function recomputeSubmission(submissionId: string) {
  const sub = await prisma.submission.findUnique({ where: { id: submissionId }, include: { answers: true } });
  if (!sub) return;
  const score = sub.answers.reduce((a, x) => a + x.marksAwarded, 0);
  const maxScore = sub.answers.reduce((a, x) => a + x.maxMarks, 0);
  const band = gradeBand(maxScore > 0 ? (score / maxScore) * 100 : 0);
  await prisma.submission.update({
    where: { id: submissionId },
    data: { score, maxScore, gradeBand: band.grade, manualShare: maxScore > 0 ? sub.answers.filter((a) => a.needsReview).reduce((a, x) => a + x.maxMarks, 0) / maxScore : 0 },
  });
}

export async function publishPaper(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const paperId = String(formData.get("paperId") ?? "");
  const status = String(formData.get("status") ?? "PUBLISHED");

  const paper = await prisma.paper.findUnique({ where: { id: paperId }, select: { schoolId: true, classId: true } });
  if (!paper || paper.schoolId !== session.schoolId) throw new Error("Not allowed");
  if (paper.classId) await assertClassAccess(session, paper.classId);

  await prisma.paper.update({ where: { id: paperId }, data: { status } });
  revalidatePath(`/tests/${paperId}`);
  redirect(`/tests/${paperId}`);
}
