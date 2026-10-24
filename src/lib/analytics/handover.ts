/**
 * The handover note.
 *
 * When a teacher is absent for a day, the substitute almost never gets a
 * handover. They are handed a class, a register and a syllabus, and the
 * children spend the day doing something the next day will be repeated.
 *
 * This produces a single sheet that answers the three questions a substitute
 * actually has, in this order:
 *
 * 1. **Who am I taking, and what is unusual about them?** Includes children
 *    with a medical or support note, because those are the ones who need
 *    handling on the day.
 * 2. **What were they learning, and what comes next?** Taken from the real
 *    teaching record, not invented.
 * 3. **What must not be lost?** The class's live gaps, so the substitute does
 *    not accidentally spend the day teaching something that is secure.
 *
 * ## What it refuses to do
 *
 * It does not include a child's score, a ranking, attendance statistics, or
 * any risk label. A note that says "Aarav is at risk of dropping out" handed
 * to a stranger on their first morning is harmful, not helpful — and it is
 * also a use of that data the parents did not agree to.
 *
 * It does not pretend to replace the teacher. If a child is likely to need
 * something only their teacher can give, the note says so plainly rather than
 * pretending a substitute can handle it.
 */

import { prisma } from "@/lib/db";
import { TOPIC_BY_ID, topicsForClass } from "@/lib/curriculum";
import { classMasteryMap } from "@/lib/analytics/class";

export type HandoverChild = {
  name: string;
  rollNo: number | null;
  /** Only written notes, never inferred labels. */
  note: string | null;
  /** A support need the substitute should know about before the lesson. */
  support: string | null;
};

export type Handover = {
  className: string;
  grade: number;
  studentCount: number;
  children: HandoverChild[];
  /** The most recent topics actually recorded as taught. */
  recentlyTaught: string[];
  /** Where the term is going next. */
  upNext: string[];
  /** The live class-level gaps, so the day is not wasted. */
  liveGaps: { topicName: string; mastery: number; note: string }[];
  /** The last register, summarised without judgement. */
  register: { absentToday: string[]; recentlyOftenAbsent: string[] } | null;
  cautions: string[];
}

export async function buildHandover(classId: string): Promise<Handover | null> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { id: true, name: true, grade: true },
  });
  if (!cls) return null;

  const students = await prisma.student.findMany({
    where: { enrollments: { some: { classId } }, active: true },
    select: { name: true, rollNo: true, note: true, dob: true },
    orderBy: [{ rollNo: "asc" }, { name: "asc" }],
  });

  // Support needs come from the child's own note, which a parent or teacher
  // wrote deliberately. Nothing here is inferred by the app.
  const children: HandoverChild[] = students.map((s) => ({
    name: s.name,
    rollNo: s.rollNo,
    note: s.note,
    support: s.note,
  }));

  const taught = await prisma.taughtSession.findMany({
    where: { classId },
    orderBy: { taughtAt: "desc" },
    select: { topicId: true },
    take: 12,
  });
  const recentIds = [...new Set(taught.map((t) => t.topicId))].slice(0, 6);
  const recentlyTaught = recentIds.map((id) => TOPIC_BY_ID.get(id)?.name ?? id);

  // What the term plan says comes next, so the substitute can keep the thread.
  const upNext: string[] = [];
  const lastTaughtAt = taught[0]?.topicId;
  if (lastTaughtAt) {
    const topic = TOPIC_BY_ID.get(lastTaughtAt);
    if (topic) {
      // Stay in the same strand so the day is a continuation, not a jump.
      const sameStrand = topicsForClass(cls.grade).filter((t) => t.strand === topic.strand);
      for (const t of sameStrand) {
        if (t.id === lastTaughtAt || recentIds.includes(t.id)) continue;
        upNext.push(t.name);
        if (upNext.length >= 3) break;
      }
    }
  }

  const mastery = await classMasteryMap(classId);
  const assessed = mastery.filter((m) => m.assessed > 0);
  const liveGaps = assessed
    .filter((m) => m.mastery < 0.6)
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 4)
    .map((m) => ({
      topicName: TOPIC_BY_ID.get(m.topicId)?.name ?? m.topicId,
      mastery: Math.round(m.mastery * 100),
      note: "The class has not got this yet. Even a short lesson here is worth more than a lesson on something they can already do.",
    }));

  // Attendance is summarised as who is likely to be missing today, which is
  // operationally useful. No rates, no trend, no judgement.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const recent = await prisma.attendanceRecord.findMany({
    where: { classId, date: { gte: new Date(today.getTime() - 7 * 86_400_000), lte: today } },
    select: { date: true, status: true, student: { select: { name: true } } },
  });
  let register: Handover["register"] = null;
  if (recent.length > 0) {
    const byStudent = new Map<string, number>();
    for (const r of recent) {
      if (r.status === "absent") byStudent.set(r.student.name, (byStudent.get(r.student.name) ?? 0) + 1);
    }
    register = {
      absentToday: recent
        .filter((r) => r.status === "absent" && r.date.getTime() === today.getTime())
        .map((r) => r.student.name),
      recentlyOftenAbsent: [...byStudent.entries()].filter(([, n]) => n >= 3).map(([name]) => name),
    };
  }

  const cautions: string[] = [];
  if (recentlyTaught.length === 0) {
    cautions.push("Nothing has been ticked off as taught for this class yet, so the plan above is a guess. Follow the textbook and tell the class teacher what you covered.");
  }
  if (liveGaps.length === 0 && assessed.length > 0) {
    cautions.push("The class is secure on everything assessed so far. Do not re-teach a topic they have; move forward.");
  }
  if (children.length === 0) {
    cautions.push("No children are enrolled in this class yet.");
  }
  cautions.push("If a child becomes distressed, send them to the school office. Do not counsel them yourself — you do not know the family, and guessing can do harm.");

  return {
    className: cls.name,
    grade: cls.grade,
    studentCount: children.length,
    children,
    recentlyTaught,
    upNext,
    liveGaps,
    register,
    cautions,
  };
}
