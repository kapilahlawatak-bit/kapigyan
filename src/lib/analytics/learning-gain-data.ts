/**
 * Loading the evidence that learning gain needs.
 *
 * The plan records *what to teach and when*, and submissions record *what each
 * child actually did, and on what date*. Learning gain is the join of the two,
 * so this module's whole job is to slice submissions either side of a set of
 * teaching dates.
 *
 * A teaching date comes from a plan session, which is generated rather than
 * stored. So the plan is rebuilt here for the requested term, and the
 * `teach` sessions supply the dates. The catch is handled honestly rather than
 * silently: a plan generated today says "week 3 is place value", and every
 * date in it is in the future, so a class that has not been there yet correctly
 * reports as unassessed rather than as having gained nothing.
 */

import { prisma } from "@/lib/db";
import { buildTeachingPlan } from "@/lib/intelligence/teaching-plan";
import { learningGain, type TeachingFeedback } from "@/lib/intelligence/learning-gain";
import type { Evidence } from "@/lib/intelligence/mastery";
import type { Session } from "@/lib/auth/session";
import { loadPlanData } from "@/lib/analytics/plan-data";

type ClassRow = { id: string; name: string; grade: number };

/**
 * When the plan says a topic will be taught, but that date is in the past
 * relative to the plan being generated from "today".
 *
 * The term runs from when the class actually started, not from today.
 *
 * A plan generated "now" and anchored to this week would place every session in
 * the future, so every piece of evidence the class has ever produced would fall
 * on the "before" side and the page would report "nothing checked yet" for every
 * topic — technically true of a plan that has not been run, and useless to a
 * teacher asking how the term has gone so far.
 *
 * The earliest assessment for the class is the best available evidence of when
 * the term started, so it anchors the calendar. It is bounded to a single term
 * so that a class with four years of history is not read as one long term.
 */
const MAX_TERM_AGE_DAYS = 112;

function planStart(earliestPaper: Date | null, now: Date): Date {
  const thisWeek = new Date(now);
  thisWeek.setHours(0, 0, 0, 0);
  thisWeek.setDate(thisWeek.getDate() - thisWeek.getDay());

  if (!earliestPaper) return thisWeek;
  const ageDays = (now.getTime() - earliestPaper.getTime()) / 86_400_000;
  if (ageDays > MAX_TERM_AGE_DAYS) return thisWeek;

  const start = new Date(earliestPaper);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

export async function loadLearningGain(
  session: Session,
  classId: string,
  opts: { weeks?: number; sessionsPerWeek?: number } = {},
): Promise<{ feedback: TeachingFeedback; className: string; grade: number; termStart: Date; recorded: number } | null> {
  // A session with no school must never reach a query that filters on one.
  if (!session.schoolId) return null;

  const klass = await prisma.class.findFirst({
    where: { id: classId, schoolId: session.schoolId },
    select: { id: true, name: true, grade: true },
  });
  if (!klass) return null;

  const data = await loadPlanData(session, classId);
  if (!data) return null;

  // Teaching dates come from what the teacher actually recorded, never from
  // the generated plan. A plan is a proposal; dating a lesson from it would
  // mean inventing the very fact the page exists to measure.
  const records = await prisma.taughtSession.findMany({
    where: { classId },
    select: { topicId: true, taughtAt: true },
  });
  const taught: Record<string, string[]> = {};
  for (const r of records) (taught[r.topicId] ??= []).push(r.taughtAt.toISOString());

  if (records.length === 0) {
    return {
      feedback: learningGain({ taught: {}, before: {}, after: {}, studentNames: {} }),
      className: klass.name, grade: klass.grade, termStart: new Date(), recorded: 0,
    };
  }

  // Every submission answer in the class, with the topic and date we need.
  const answers = await prisma.answer.findMany({
    where: { submission: { student: { enrollments: { some: { classId } } } } },
    select: {
      marksAwarded: true,
      maxMarks: true,
      paperQuestion: { select: { topicId: true, difficulty: true } },
      submission: {
        select: { studentId: true, paper: { select: { date: true } } },
      },
    },
  });

  const before: Record<string, Record<string, Evidence[]>> = {};
  const after: Record<string, Record<string, Evidence[]>> = {};
  const studentNames: Record<string, string> = {};

  for (const topicId of Object.keys(taught)) {
    // Split at the *last* recorded lesson, so everything after the final one
    // counts as the "after" evidence.
    const split = taught[topicId]!.map((d) => new Date(d)).sort((a, b) => a.getTime() - b.getTime()).pop()!;

    for (const a of answers) {
      if (a.paperQuestion.topicId !== topicId) continue;
      const studentId = a.submission.studentId;
      const at = a.submission.paper.date;
      const ev: Evidence = {
        score: a.marksAwarded,
        maxScore: a.maxMarks || 1,
        difficulty: a.paperQuestion.difficulty,
        at,
      };
      const bucket = at < split ? before : after;
      (bucket[topicId] ??= {});
      (bucket[topicId]![studentId] ??= []).push(ev);
    }
  }

  const students = await prisma.student.findMany({
    where: { enrollments: { some: { classId } } },
    select: { id: true, name: true },
  });
  for (const s of students) studentNames[s.id] = s.name;

  const feedback = learningGain({ taught, before, after, studentNames });
  return {
    feedback, className: klass.name, grade: klass.grade,
    termStart: new Date(Math.min(...records.map((r) => r.taughtAt.getTime()))),
    recorded: records.length,
  };
}

/** Kept for callers that only need the class list. */
export async function classesForGain(session: Session): Promise<ClassRow[]> {
  if (!session.schoolId) return [];
  return prisma.class.findMany({
    where: {
      schoolId: session.schoolId,
      ...(session.role === "TEACHER" && session.mode !== "HOME" ? { teacherId: session.userId } : {}),
    },
    select: { id: true, name: true, grade: true },
    orderBy: { name: "asc" },
  });
}
