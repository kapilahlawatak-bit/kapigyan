"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { buildOmr } from "@/lib/analytics/omr";
import { parseOmr } from "@/lib/omr-parse";
import { inferMisconceptions } from "@/lib/intelligence/misconception-inference";
import { gradeBand } from "@/lib/curriculum";

/**
 * Save one child's bubble sheet.
 *
 * Answers are matched positionally against the sheet's question numbers, so a
 * child who skipped question 4 must still type a placeholder for it. Anything
 * missing is stored as unanswered rather than shifted up — silently shifting
 * would put every mark after the gap on the wrong question, which is the
 * failure mode this screen most needs to avoid.
 */
export async function saveOmr(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const paperId = String(formData.get("paperId") ?? "");
  const studentId = String(formData.get("studentId") ?? "");
  const raw = String(formData.get("answers") ?? "");

  const paper = await prisma.paper.findFirst({
    where: { id: paperId, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { id: true, classId: true },
  });
  if (!paper) return;
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const omr = await buildOmr(paperId);
  if (omr.questionNumbers.length === 0) return;

  const questions = await prisma.paperQuestion.findMany({
    where: { paperId, position: { in: omr.questionNumbers.map((n) => n - 1) } },
    select: { id: true, position: true, answerKey: true, accepted: true, topicId: true, stem: true, type: true, marks: true },
  });
  const byPosition = new Map(questions.map((q) => [q.position + 1, q]));
  const parsed = parseOmr(raw, omr.questionNumbers);
  let unread = 0;

  // An existing submission is reused so a corrected sheet overwrites rather
  // than duplicating the child.
  const existing = await prisma.submission.findFirst({
    where: { paperId, studentId },
    select: { id: true },
  });
  const submission = existing
    ? await prisma.submission.update({ where: { id: existing.id }, data: { status: "GRADED" }, select: { id: true } })
    : await prisma.submission.create({
        data: { paperId, studentId, status: "GRADED", submittedAt: new Date() },
        select: { id: true },
      });

  let saved = 0;
  for (let i = 0; i < omr.questionNumbers.length; i++) {
    const n = omr.questionNumbers[i]!;
    const q = byPosition.get(n);
    const given = parsed[i];
    if (!q) continue;
    if (given === null) { unread++; continue; }

    const accepted = (() => {
      try { const v = JSON.parse(q.accepted); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
    })();
    const isCorrect = [q.answerKey, ...accepted].some((k) => k.trim().toUpperCase() === given);

    const inferences = isCorrect
      ? []
      : inferMisconceptions({
          stem: q.stem, response: given, isWrong: true, type: q.type, topicId: q.topicId,
        });

    const data = {
      response: given,
      isCorrect,
      marksAwarded: isCorrect ? q.marks : 0,
      maxMarks: q.marks,
      errorTag: inferences[0]?.misconceptionId ?? null,
      confidence: 0.9,
      needsReview: false,
      note: "Marked from a bubble sheet",
    };
    const prior = await prisma.answer.findFirst({ where: { submissionId: submission.id, paperQuestionId: q.id }, select: { id: true } });
    if (prior) await prisma.answer.update({ where: { id: prior.id }, data });
    else await prisma.answer.create({ data: { ...data, submissionId: submission.id, paperQuestionId: q.id } });
    saved++;
  }

  const answers = await prisma.answer.findMany({ where: { submissionId: submission.id } });
  const score = answers.reduce((a, x) => a + x.marksAwarded, 0);
  const maxScore = answers.reduce((a, x) => a + x.maxMarks, 0);
  const band = gradeBand(maxScore > 0 ? (score / maxScore) * 100 : 0);
  await prisma.submission.update({
    where: { id: submission.id },
    data: { score, maxScore, gradeBand: band.grade, manualShare: 0 },
  });

  revalidatePath(`/tests/${paperId}`);
  if (unread > 0) {
    // Surfaced rather than swallowed: a partly-read sheet must not look
    // identical to a complete one.
    console.warn(`OMR ${paperId}: ${saved} saved, ${unread} answers could not be read.`);
  }
  void saved;
}
