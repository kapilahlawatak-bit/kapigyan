"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { prisma, toJson } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { gradeSubmission } from "@/lib/grading";
import { gradeBand } from "@/lib/curriculum";

/**
 * Re-mark a whole paper from the answers already on file.
 *
 * The situation it exists for: a teacher finds one miskeyed question *after*
 * a paper is marked, fixes it, and now every child's score is wrong. Without
 * this, correcting it means retyping thirty scripts.
 *
 * ## What it discards, and why that is stated loudly
 *
 * Manual marks are discarded. Those were deliberate human judgements about
 * written work, and keeping them while re-deriving everything else would
 * produce a result matching no possible reading of the paper. The count of
 * affected answers is shown *before* the teacher commits, because that is what
 * makes the decision informed rather than careless.
 *
 * The responses themselves — what each child actually wrote — are never
 * touched. That is the irreplaceable part, and only the marks derived from it
 * are rebuilt.
 */
export async function recheckPaper(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const paperId = String(formData.get("paperId") ?? "");

  const paper = await prisma.paper.findFirst({
    where: { id: paperId, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { id: true, classId: true },
  });
  if (!paper) throw new Error("That test is not yours");
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const questions = await prisma.paperQuestion.findMany({
    where: { paperId },
    orderBy: { position: "asc" },
    select: {
      id: true, type: true, stem: true, options: true, answerKey: true, accepted: true,
      markScheme: true, topicId: true, strand: true, competency: true, marks: true,
    },
  });
  if (questions.length === 0) throw new Error("This paper has no questions");

  const submissions = await prisma.submission.findMany({
    where: { paperId },
    select: { id: true, studentId: true, score: true, maxScore: true, answers: { select: { paperQuestionId: true, response: true } } },
  });
  if (submissions.length === 0) throw new Error("Nothing has been submitted yet");

  /** Scores before the re-mark, so the audit row can say what moved. */
  const previous = new Map(submissions.map((s) => [s.id, { score: s.score, maxScore: s.maxScore }]));
  let changed = 0;

  for (const sub of submissions) {
    const byQuestion = new Map(sub.answers.map((a) => [a.paperQuestionId, a.response]));
    // A question with no stored answer is marked blank rather than skipped,
    // so re-marking cannot quietly raise anyone's score.
    const responses = questions.map((q) => ({
      paperQuestionId: q.id,
      response: String(byQuestion.get(q.id) ?? "").trim(),
    }));

    const result = gradeSubmission(questions, responses);
    const band = gradeBand(result.percentage);

    await prisma.answer.deleteMany({ where: { submissionId: sub.id } });
    const before = previous.get(sub.id);
    if (before && before.score !== result.score) changed += 1;
    await prisma.submission.update({
      where: { id: sub.id },
      data: {
        score: result.score,
        maxScore: result.maxScore,
        gradeBand: band.grade,
        breakdown: toJson({
          topics: result.topicBreakdown,
          misconceptions: result.misconceptionCounts,
          counts: result.counts,
        }),
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
  }

  // One row for the whole paper rather than one per child: a re-mark is a single
  // deliberate act, and thirty identical rows would bury it.
  await recordAudit({
    schoolId: session.schoolId,
    actorId: session.userId,
    actorName: session.name,
    action: "mark_recheck",
    paperId,
    classId: paper.classId,
    after: { submissions: submissions.length, scoresChanged: changed },
    detail:
      `Re-marked ${submissions.length} submission(s) from the stored responses. ` +
      `${changed} score(s) changed. Manual marks were discarded, as re-marking always does.`,
  });

  revalidatePath(`/tests/${paperId}`);
  revalidatePath(`/tests/${paperId}/review`);
  revalidatePath(`/tests/${paperId}/analysis`);
  revalidatePath("/reports");
}
