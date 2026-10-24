"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { prisma, toJson } from "@/lib/db";
import { parseMarksCsv, nameMatches } from "@/lib/analytics/csv-marks";

/**
 * Store another subject's marks as context.
 *
 * These are never fed into mastery, the misconception engine or the risk
 * score. There is no evidence in an imported mark about how a child reasons,
 * and letting a Hindi score move a mathematics risk score would be exactly
 * the kind of confident nonsense this app refuses to produce.
 *
 * A previous import for the same class and subject is replaced, because a
 * teacher re-uploading a corrected sheet expects the correction, not a second
 * copy of both.
 */
export type ImportResult = { imported?: number; unmatched?: string[]; error?: string };

export async function importMarks(formData: FormData): Promise<ImportResult> {
  const session = await requireTeacher();
  const classId = String(formData.get("classId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const text = String(formData.get("csv") ?? "");

  if (!classId || !text.trim()) return { error: "Nothing to import" };
  await assertClassAccess(session, classId);
  if (!subject) return { error: "Choose which subject this is" };

  const parsed = parseMarksCsv(text);
  if (parsed.good.length === 0) {
    return {
      error: `No rows could be read. First problem was on line ${parsed.problems[0]?.line ?? 1}: ${parsed.problems[0]?.problem ?? "unknown"}`,
    };
  }

  const students = await prisma.student.findMany({
    where: { enrollments: { some: { classId } } },
    select: { id: true, name: true },
  });

  const unmatched: string[] = [];
  const saved: { studentId: string; name: string; marks: number; max: number }[] = [];
  for (const row of parsed.good) {
    const student = students.find((s) => nameMatches(s.name, row.studentName));
    if (!student) { unmatched.push(row.studentName); continue; }
    saved.push({ studentId: student.id, name: student.name, marks: row.marks!, max: row.maxMarks ?? 100 });
  }
  if (saved.length === 0) {
    return { error: `None of the ${parsed.good.length} names matched a child in this class. Check the roll, or the names.` };
  }

  await prisma.$transaction([
    // Replace, not accumulate: a corrected upload must not sit beside the
    // version it corrects.
    prisma.otherSubjectMark.deleteMany({ where: { classId, subject } }),
    prisma.otherSubjectMark.createMany({
      data: saved.map((s) => ({
        classId, subject, studentId: s.studentId,
        marks: s.marks, maxMarks: s.max,
        source: "csv", recordedBy: session.userId,
      })),
    }),
  ]);

  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  return { imported: saved.length, unmatched };
}
