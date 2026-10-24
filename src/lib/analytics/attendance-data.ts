/**
 * Attendance data for the views that need it.
 *
 * Kept in one place because the important property is a negative one: a school
 * that has never taken a register must be told nothing, rather than told zero.
 * Every consumer here gets `null` when there is no record, and the risk engine
 * treats `null` as "unknown" rather than "fine".
 */

import { prisma } from "@/lib/db";
import { summariseAttendance, type AttendanceStatus, type AttendanceSummary } from "@/lib/intelligence/attendance";

export type AttendanceForRisk = {
  concern: number | null;
  notes: string[];
};

/** Summaries for a set of children, keyed by student id. */
export async function attendanceByStudent(
  studentIds: string[],
): Promise<Map<string, AttendanceSummary>> {
  const out = new Map<string, AttendanceSummary>();
  if (studentIds.length === 0) return out;

  const rows = await prisma.attendanceRecord.findMany({
    where: { studentId: { in: studentIds } },
    select: { studentId: true, date: true, status: true },
    orderBy: { date: "asc" },
  });

  const byChild = new Map<string, { date: string; status: AttendanceStatus }[]>();
  for (const r of rows) {
    const list = byChild.get(r.studentId) ?? [];
    list.push({ date: r.date.toISOString().slice(0, 10), status: r.status as AttendanceStatus });
    byChild.set(r.studentId, list);
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const id of studentIds) {
    out.set(id, summariseAttendance({ days: byChild.get(id) ?? [], today }));
  }
  return out;
}

/** One child, shaped for `riskFor`. */
export async function attendanceForRisk(studentId: string): Promise<AttendanceForRisk | undefined> {
  const summary = (await attendanceByStudent([studentId])).get(studentId);
  if (!summary || summary.daysRecorded === 0) return undefined;
  return {
    concern: summary.concern,
    notes: summary.findings.filter((f) => f.severity === "high").map((f) => f.note),
  };
}

/** One child, for display. */
export async function attendanceFor(studentId: string): Promise<AttendanceSummary | null> {
  const s = (await attendanceByStudent([studentId])).get(studentId);
  return s && s.daysRecorded > 0 ? s : null;
}
