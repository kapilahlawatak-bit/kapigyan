"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/intelligence/attendance";

/**
 * Saving a day's register.
 *
 * One submit for the whole class rather than a request per child. A register
 * is taken with thirty children waiting, and a form that round-trips per row
 * is a form a teacher abandons halfway through. One request that writes in a
 * transaction is also the only version that cannot half-save.
 *
 * The same action serves today and any earlier day: the merge into the
 * Register page made "take today's register" and "fix last Tuesday's" the
 * same operation, and they always were — the date was always a parameter.
 */
export async function saveAttendance(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const classId = String(formData.get("classId") ?? "");
  const day = String(formData.get("date") ?? "");
  if (!classId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("Missing class or date.");
  }
  await assertClassAccess(session, classId);

  // A future register is a data-entry error, not a plan. Refusing beats
  // writing rows a teacher then has to unpick.
  const when = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 86_400_000) {
    throw new Error("Cannot mark attendance for a future day.");
  }

  const enrolled = await prisma.student.findMany({
    where: { enrollments: { some: { classId } } },
    select: { id: true },
  });
  const roster = new Set(enrolled.map((s) => s.id));

  const entries: { studentId: string; status: AttendanceStatus }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status:")) continue;
    const studentId = key.slice("status:".length);
    const status = String(value);
    // Ignore anything not on the roster, so a hand-crafted post cannot
    // create records for children this class does not have.
    if (!roster.has(studentId) || !ATTENDANCE_STATUSES.includes(status as AttendanceStatus)) continue;
    entries.push({ studentId, status: status as AttendanceStatus });
  }
  if (entries.length === 0) throw new Error("Nothing to save.");

  await prisma.$transaction([
    prisma.attendanceRecord.deleteMany({ where: { classId, date: when } }),
    prisma.attendanceRecord.createMany({
      data: entries.map((e) => ({
        classId, studentId: e.studentId, date: when,
        status: e.status, recordedBy: session.userId,
      })),
    }),
  ]);

  revalidatePath("/classes");
  revalidatePath(`/students`);
  revalidatePath("/insights");
}
