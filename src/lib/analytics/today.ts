/**
 * What a teacher needs to do today.
 *
 * The app has grown to a dozen pages, and the honest truth is that a teacher
 * does not open an app to browse it. They open it in the morning, in the
 * corridor, with thirty children arriving, and they want one thing: what does
 * today involve.
 *
 * So this aggregates the six things that are actually time-bound into a
 * single list, ordered by what breaks if it is not done. Marking a register
 * late is a small problem. Teaching the wrong topic because the app said
 * something confusing is a bigger one.
 *
 * ## What it refuses to do
 *
 * It does not manufacture urgency. A teacher with nothing due sees "Nothing is
 * due today" and that is the end of it — no invented tasks, no "consider
 * reviewing" padding. A today view that is never empty cannot be trusted to
 * mean anything when it says a day is busy.
 */

import { prisma } from "@/lib/db";
import { TOPIC_BY_ID } from "@/lib/curriculum";
import { reviewQueue } from "@/lib/analytics/review-queue";
import { loadPlanData } from "@/lib/analytics/plan-data";
import { buildTeachingPlan } from "@/lib/intelligence/teaching-plan";
import { topicsForClass } from "@/lib/curriculum";
import type { Session } from "@/lib/auth/session";

export type TodayTask = {
  id: string;
  /** What the teacher does, as a verb. */
  what: string;
  detail: string;
  href: string;
  /** 1 = do this first, 3 = do it if you get to it. */
  weight: 1 | 2 | 3;
  /** Why it matters today rather than tomorrow, in one clause. */
  because: string;
  count?: number;
};

export type TodayView = {
  date: string;
  tasks: TodayTask[];
  /** One line, honest, for the top of the screen. */
  headline: string;
  /** True when genuinely nothing is due. */
  clear: boolean;
};

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function todayFor(session: Session, now = new Date()): Promise<TodayView> {
  const tasks: TodayTask[] = [];
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const date = today.toISOString().slice(0, 10);

  const classes = await prisma.class.findMany({
    where: {
      ...(session.schoolId ? { schoolId: session.schoolId } : {}),
      ...(session.role === "TEACHER" && session.mode !== "HOME" ? { teacherId: session.userId } : {}),
    },
    select: { id: true, name: true, grade: true, enrollments: { select: { studentId: true } } },
    orderBy: { grade: "asc" },
  });

  // Shown once across the whole view, not repeated per class.
  let startedTerm = false;

  if (classes.length === 0) {
    return { date, tasks, headline: "No classes set up yet.", clear: true };
  }

  for (const c of classes) {
    // 1. The register. Everything downstream assumes it exists.
    const taken = await prisma.attendanceRecord.count({
      where: { classId: c.id, date: { gte: today, lt: tomorrow } },
    });
    const size = c.enrollments.length;
    if (size > 0 && taken === 0) {
      tasks.push({
        id: `att-${c.id}`,
        what: `Take the register for ${c.name}`,
        detail: `${size} children on roll.`,
        href: `/classes?class=${c.id}`,
        weight: 1,
        because: "Absence patterns are only visible once the register is kept.",
        count: size,
      });
    }

    // 2. What the plan says to teach today.
    const taughtToday = await prisma.taughtSession.findMany({
      where: { classId: c.id, taughtAt: { gte: today, lt: tomorrow } },
      select: { topicId: true },
    });
    const taughtIds = new Set(taughtToday.map((t) => t.topicId));

    const plan = await loadPlanData(session, c.id);
    if (!plan) continue;

    const built = buildTeachingPlan({
      grade: c.grade,
      syllabus: topicsForClass(c.grade),
      mastery: plan.mastery,
      recommendations: plan.recommendations,
      weeks: 6,
      sessionsPerWeek: 3,
    });

    const teachSessions = built.weeks.flatMap((w) => w.sessions).filter((s) => s.kind === "teach");

    // The plan is laid out in weeks, not calendar dates, so "today's lesson"
    // cannot honestly be read off it — there is no date to read. Instead the
    // next lesson is taken from where the teacher has actually got to, using
    // the real taught records. That is a fact; a calendar mapping would not be.
    const nextUp = teachSessions.find((s) => !taughtIds.has(s.topicId));
    if (nextUp && !startedTerm) {
      tasks.push({
        id: `teach-${c.id}-${nextUp.topicId}`,
        what: `Start ${c.name} with ${nextUp.topicName}`,
        detail: nextUp.why,
        href: `/plan/materials/${nextUp.topicId}?classId=${c.id}`,
        weight: 3,
        because: "Nothing has been ticked off as taught yet, so this is where the term begins.",
      });
      startedTerm = true;
    } else if (nextUp) {
      tasks.push({
        id: `teach-${c.id}-${nextUp.topicId}`,
        what: `Next up: ${nextUp.topicName} for ${c.name}`,
        detail: nextUp.why,
        href: `/plan/materials/${nextUp.topicId}?classId=${c.id}`,
        weight: 3,
        because: "The next topic in the plan that has not been marked as taught.",
      });
    }
  }

  // 3. Papers marked by the machine that still need a person.
  const pending = await prisma.paper.findMany({
    where: {
      ...(session.schoolId ? { schoolId: session.schoolId } : {}),
      classId: { not: null },
      submissions: { some: { status: "GRADED" } },
    },
    select: { id: true, title: true, classId: true, class: { select: { name: true } } },
    take: 20,
  });
  for (const p of pending) {
    const q = await reviewQueue(p.id);
    if (q.items.length > 0) {
      tasks.push({
        id: `review-${p.id}`,
        what: `Review ${q.items.length} ${q.items.length === 1 ? "answer" : "answers"} in ${p.class?.name ?? "a paper"}`,
        detail: `${p.title} — ${q.coverage}`,
        href: `/tests/${p.id}/review`,
        weight: 2,
        because: "The machine marked these but could not settle them.",
        count: q.items.length,
      });
    }
  }

  // Order: registers first, then marking, then the next lesson.
  tasks.sort((a, b) => a.weight - b.weight || a.what.localeCompare(b.what));

  const urgent = tasks.filter((t) => t.weight === 1).length;
  const headline =
    tasks.length === 0
      ? "Nothing is due today."
      : tasks.length === 1
        ? tasks[0]!.what
        : `${tasks.length} things today — ${urgent > 0 ? `${urgent} of them before the first bell` : "nothing urgent"}.`;

  return { date, tasks, headline, clear: tasks.length === 0 };
}
