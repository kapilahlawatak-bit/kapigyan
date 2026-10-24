/**
 * The review queue.
 *
 * The marking engine already grades a whole paper in seconds. The problem is
 * that a teacher is then shown all of it, and almost none of it needs them.
 * On a 30-child paper that is 300+ rows to scroll past to find the twelve that
 * matter. A teacher who does that once will not do it again.
 *
 * So the queue's job is to be *short*, and the whole design serves that. A
 * correct answer with a recognised misconception needs nobody. The items worth
 * a human's attention are the ones where the machine is least likely to be
 * right, and there are only four kinds:
 *
 * 1. **A wrong answer nothing explains.** The engine diagnosed 73% of wrong
 *    answers with a named misconception. The remaining 27% are the interesting
 *    ones: either the child holds a misconception nobody has written down yet,
 *    or the key is wrong. Both are worth a look, and the second one means
 *    everything derived from this question is suspect.
 * 2. **A written answer the machine could only partly score.** Marked
 *    `needsReview` by the grader, which never auto-finalises these.
 * 3. **A blank where the class mostly answered.** Usually an unreadable
 *    answer, not an unanswered one.
 * 4. **Part credit on thin evidence.** Something between nothing and full, on
 *    a question the machine was not confident about.
 *
 * ## The honesty constraint
 *
 * A queue that is long is worse than no queue, because a teacher who opens it
 * and finds forty items has learned the app cannot prioritise. So the count is
 * always shown, and when the queue is long the page says so plainly rather
 * than pretending the short list is complete. There is no silent truncation:
 * a teacher is never shown "12 to review" when there are actually 40.
 */

import { prisma } from "@/lib/db";
import { MISCONCEPTION_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";

export type ReviewReason =
  | "unexplained_wrong"
  | "written_answer"
  | "suspicious_blank"
  | "uncertain_partial";

export type ReviewItem = {
  answerId: string;
  submissionId: string;
  studentName: string;
  rollNo: number | null;
  paperQuestionId: string;
  /** 1-based position in the paper, so the teacher can find it fast. */
  questionNumber: number;
  stem: string;
  topicName: string;
  response: string;
  /** The machine's decision, in words. */
  machineVerdict: string;
  answerKey: string;
  marksAwarded: number;
  maxMarks: number;
  confidence: number;
  reason: ReviewReason;
  reasonText: string;
  /** Higher means more urgent. */
  priority: number;
  /**
   * Set when several children gave this exact answer to this exact question.
   * Such a group is one question-level problem, not N answers, and deciding
   * the first one does not decide the rest.
   */
  collapsedCount?: number;
  sampleStudents?: string[];
};

/**
 * How many children giving the same wrong answer to one question makes it a
 * question-level problem rather than N separate answers.
 */
const COLLAPSE_AT = 5;

export type ReviewQueue = {
  items: ReviewItem[];
  /** Everything in the paper, so the count can be stated honestly. */
  totalAnswers: number;
  /** Answers the machine settled with high confidence. */
  settled: number;
  /** How many children this covers. */
  students: number;
  /** A plain statement of whether the queue is short enough to be trusted. */
  coverage: string;
};

const REASON_WEIGHT: Record<ReviewReason, number> = {
  unexplained_wrong: 3,
  written_answer: 2.5,
  suspicious_blank: 1.5,
  uncertain_partial: 1,
};

const REASON_TEXT: Record<ReviewReason, string> = {
  unexplained_wrong: "Wrong, and nothing explains why. Either an unrecorded misconception or a wrong key.",
  written_answer: "A written answer, which is never marked final by machine.",
  suspicious_blank: "Blank, but most of the class answered this one.",
  uncertain_partial: "Part credit on an answer the machine was unsure about.",
};

export async function reviewQueue(paperId: string): Promise<ReviewQueue> {
  const questions = await prisma.paperQuestion.findMany({
    where: { paperId },
    select: {
      id: true, position: true, stem: true, answerKey: true, type: true, topicId: true,
      answers: {
        select: {
          id: true, submissionId: true, response: true, isCorrect: true,
          marksAwarded: true, maxMarks: true, confidence: true, needsReview: true,
          errorTag: true, note: true,
          submission: { select: { student: { select: { name: true, rollNo: true } } } },
        },
      },
    },
    orderBy: { position: "asc" },
  });

  const items: ReviewItem[] = [];
  let totalAnswers = 0;
  let settled = 0;
  const studentIds = new Set<string>();

  for (const q of questions) {
    const answered = q.answers.filter((a) => a.isCorrect !== null);
    // How unusual is a blank on this question? A paper where most children
    // skipped one is a hard question; a paper where a few did is the norm.
    const thisQuestionBlankRate = q.answers.length > 0
      ? (q.answers.length - answered.length) / q.answers.length
      : 0;
    const mostAnswered = thisQuestionBlankRate < 0.8;
    void mostAnswered;

    for (const a of q.answers) {
      totalAnswers++;
      studentIds.add(a.submissionId);

      let reason: ReviewReason | null = null;

      if (a.needsReview) {
        reason = a.isCorrect === null ? "suspicious_blank" : "written_answer";
      } else if (a.isCorrect === false && !a.errorTag) {
        reason = "unexplained_wrong";
      } else if (
        // Only an *anomalous* blank is worth a human: the child answered
        // nearly everything else on the paper, so they were here and working,
        // and this one may be an unreadable answer rather than a skipped one.
        // A child who skipped a question is a fact about them, not an error in
        // the marking, and flagging every such answer buried the real problems.
        a.isCorrect === null &&
        a.response.trim() === "" &&
        q.answers.filter((x) => x.isCorrect !== null).length >= q.answers.length * 0.8 &&
        thisQuestionBlankRate > 0.2 &&
        thisQuestionBlankRate < 0.5
      ) {
        reason = "suspicious_blank";
      } else if (
        a.isCorrect !== null &&
        a.marksAwarded > 0 && a.marksAwarded < a.maxMarks &&
        (a.confidence ?? 1) < 0.7
      ) {
        reason = "uncertain_partial";
      }

      if (!reason) {
        settled++;
        continue;
      }

      const topicName = TOPIC_BY_ID.get(q.topicId ?? "")?.name ?? "Untagged";
      items.push({
        answerId: a.id,
        submissionId: a.submissionId,
        studentName: a.submission.student.name,
        rollNo: a.submission.student.rollNo,
        paperQuestionId: q.id,
        questionNumber: q.position + 1,
        stem: q.stem,
        topicName,
        response: (a.response ?? "").trim(),
        machineVerdict: machineVerdict(a.isCorrect, a.marksAwarded, a.maxMarks, a.errorTag),
        answerKey: q.answerKey,
        marksAwarded: a.marksAwarded,
        maxMarks: a.maxMarks,
        confidence: a.confidence ?? 0,
        reason,
        reasonText: REASON_TEXT[reason],
        // Uncertain confidence pushes an item up within its band.
        priority: REASON_WEIGHT[reason] + (1 - (a.confidence ?? 0.5)) * 0.5,
      });
    }
  }

  // **Collapse the systematic ones.**
  //
  // If eleven children wrote the same wrong answer to the same question, that
  // is not eleven answers needing a human — it is one question that is
  // probably miskeyed or badly worded, and every analysis built on it is
  // suspect. Left as separate items it floods the queue and hides the real
  // problems behind the single most important thing on the page.
  const groups = new Map<string, ReviewItem[]>();
  for (const item of items) {
    if (item.reason !== "unexplained_wrong") continue;
    const key = `${item.paperQuestionId}|${item.response}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
  }

  const collapsed: ReviewItem[] = [];
  const consumed = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < COLLAPSE_AT) {
      for (const g of group) collapsed.push(g);
      continue;
    }
    for (const g of group) consumed.add(g.answerId);
    const lead = group[0]!;
    collapsed.push({
      ...lead,
      answerId: lead.answerId,
      response: lead.response,
      machineVerdict: `${group.length} children wrote this same thing`,
      reasonText: `${group.length} children gave this exact answer and nothing explains it. That usually means the key is wrong or the question is badly worded, not that ${group.length} children are confused. Fix the question and every one of these marks corrects itself.`,
      reason: "unexplained_wrong",
      priority: 10 + group.length,
      // Deciding the lead answer is meaningless; the group is a question-level
      // problem, so the board hides the decision buttons for it.
      collapsedCount: group.length,
      sampleStudents: group.slice(0, 6).map((g) => g.studentName),
    });
  }

  const final = [...collapsed.filter((i) => !consumed.has(i.answerId) || i.collapsedCount)];
  final.sort((a, b) => b.priority - a.priority || a.questionNumber - b.questionNumber);

  const share = totalAnswers > 0 ? final.length / totalAnswers : 0;
  const coverage =
    final.length === 0
      ? `All ${totalAnswers} answers were settled with confidence.`
      : share <= 0.15
        ? `${final.length} of ${totalAnswers} answers need you. The rest are settled.`
        : share <= 0.3
          ? `${final.length} of ${totalAnswers} answers need you — a longer list than usual. Check whether a question's key is wrong, because that alone can flood the queue.`
          : `${final.length} of ${totalAnswers} answers need you. That is a lot, and usually means the marking is uncertain rather than the children. Read the question keys before working through it.`;

  return { items: final, totalAnswers, settled, students: studentIds.size, coverage };
}

function machineVerdict(isCorrect: boolean | null, marks: number, max: number, errorTag: string | null): string {
  if (isCorrect === null) return "Left unmarked";
  if (isCorrect) return marks >= max ? "Marked correct" : `Part credit: ${marks} of ${max}`;
  const name = errorTag ? MISCONCEPTION_BY_ID.get(errorTag)?.name : null;
  return name ? `Marked wrong — ${name}` : "Marked wrong, no explanation";
}
