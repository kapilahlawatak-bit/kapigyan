/**
 * The audit trail.
 *
 * Children's assessment records are edited after they are created: a marker
 * overrules the engine, a whole paper is re-marked because a key was wrong, a
 * guardian withdraws consent. Each of those is defensible and none is unusual —
 * but each one *changes what a child's record says*, and after it, nobody can
 * tell from the record alone that it happened.
 *
 * The `note` string on an answer row is not a substitute. It records what
 * somebody wrote ("Marked correct by the teacher"), not what the value was
 * before or after, and it is overwritten by the next edit. This is a separate
 * append-only log that answers the only question that matters later: who
 * changed this child's mark, when, from what to what.
 *
 * Two rules hold everywhere it is called:
 *   - the actor's *name* is copied in, because deleting an account must not
 *     erase the school's record that the change happened;
 *   - the before-state is written, because "correct" means nothing without it.
 */

import { prisma } from "@/lib/db";

export const AUDIT_ACTIONS = [
  "mark_override",
  "mark_recheck",
  "consent_granted",
  "consent_revoked",
  "attendance_saved",
  "import_marks",
  "omr_save",
  "account_deleted",
  "reflection_recorded",
  "paper_created",
  "topic_depth_corrected",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEntry = {
  schoolId: string | null;
  actorId: string | null;
  actorName: string;
  action: AuditAction;
  studentId?: string | null;
  paperId?: string | null;
  classId?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: string;
};

/**
 * Append one entry.
 *
 * Never throws. An audit failure must not roll back or block the mark it was
 * recording — losing a child's mark because the log was unavailable would be
 * the worse of the two failures — but it is reported, loudly, because a log
 * that silently stops recording is worse than one that was never there.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        schoolId: entry.schoolId,
        actorId: entry.actorId,
        actorName: entry.actorName,
        action: entry.action,
        studentId: entry.studentId ?? null,
        paperId: entry.paperId ?? null,
        classId: entry.classId ?? null,
        before: entry.before === undefined ? null : JSON.stringify(entry.before),
        after: entry.after === undefined ? null : JSON.stringify(entry.after),
        detail: entry.detail ?? null,
      },
    });
  } catch (err) {
    console.error(
      `[audit] could not record "${entry.action}". The change was applied, but the trail is incomplete.`,
      err,
    );
  }
}

export function isAuditAction(value: string): value is AuditAction {
  return (AUDIT_ACTIONS as readonly string[]).includes(value);
}
