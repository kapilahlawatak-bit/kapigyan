/**
 * Building the nudge list for a class.
 *
 * Lives beside the other analytics loaders because it is class-level data, not
 * student-level, and it is reusable from anywhere a teacher is thinking about
 * a whole group.
 */

import { prisma } from "@/lib/db";
import { practiceEvidence } from "@/lib/analytics/retrieval-data";
import { parentMessage } from "@/lib/intelligence/parent-nudge";
import { assertClassAccess } from "@/lib/auth/guard";
import type { Session } from "@/lib/auth/session";

export type NudgeRow = {
  studentId: string;
  name: string;
  rollNo: number | null;
  parentName: string;
  message: string;
  /** False when the child is doing well and there is nothing to ask for. */
  worthSending: boolean;
  topicName: string | null;
};

/**
 * The most frequent misconception this child has actually demonstrated.
 *
 * One isolated error is not a pattern, so a tag must appear at least twice
 * before it is offered as advice. Saying "your child thinks bigger
 * denominators mean bigger fractions" after a single answer would be alarming
 * and probably wrong.
 */
async function topMisconception(studentId: string): Promise<string | null> {
  const rows = await prisma.answer.findMany({
    where: { submission: { studentId }, isCorrect: false, errorTag: { not: null } },
    select: { errorTag: true },
    take: 60,
  });
  const counts = new Map<string, number>();
  for (const r of rows) if (r.errorTag) counts.set(r.errorTag, (counts.get(r.errorTag) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= 2 ? top[0] : null;
}

export async function nudgeRows(session: Session, classId: string): Promise<NudgeRow[]> {
  await assertClassAccess(session, classId);

  // Consent lives on the link and on the parent user; both must be present.
  // Students are reached through the class, because `Student` has no
  // `schoolId` of its own and a loose query would leak across schools.
  const links = await prisma.parentLink.findMany({
    where: {
      student: { enrollments: { some: { classId } } },
      revokedAt: null,
      parent: { consentAt: { not: null } },
    },
    select: {
      student: { select: { id: true, name: true, rollNo: true, enrollments: { select: { classId: true } } } },
      parent: { select: { name: true, schoolId: true } },
    },
  });

  const rows: NudgeRow[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (link.parent.schoolId !== session.schoolId) continue;
    if (seen.has(link.student.id)) continue;
    seen.add(link.student.id);

    const [practised, misconceptionId] = await Promise.all([
      practiceEvidence(link.student.id),
      topMisconception(link.student.id),
    ]);
    const message = parentMessage({ childName: link.student.name, practised, misconceptionId });
    rows.push({
      studentId: link.student.id,
      name: link.student.name,
      rollNo: link.student.rollNo,
      parentName: link.parent.name,
      message: message.body,
      worthSending: message.honest,
      topicName: message.nudge?.topicName ?? null,
    });
  }

  rows.sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999) || a.name.localeCompare(b.name));
  return rows;
}
