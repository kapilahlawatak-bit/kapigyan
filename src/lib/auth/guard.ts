/**
 * Access guards for pages, server actions and route handlers.
 *
 * `require*` and `assert*` throw or redirect, so a caller can never
 * accidentally proceed without a real check having passed. Route handlers
 * should use `requireApi*`, which returns a Response instead of redirecting.
 *
 * The rule this file exists to enforce: a guard that returns a verdict
 * instead of raising is a guard nobody calls correctly. `assertClassAccess`
 * used to `return { ok: false }` and all eight call sites discarded it, which
 * meant the check was decorative. Everything here now throws.
 */

import { redirect, notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession, type Session, type SchoolSession } from "./session";
import { canTeach, isMode, isRole, type Role, type UserMode } from "./roles";

export type { SchoolSession };

/**
 * Thrown by `assertStudentAccess` when a signed-in user reaches for a child that
 * is not theirs.
 *
 * The route handlers that call it catch this and answer 403. Page-level guards
 * do not throw it — they redirect, matching what `requireRole` already does — so
 * this stays a route-handler concern rather than something every page has to
 * wrap.
 */
export class AuthError extends Error {
  readonly status: number;
  constructor(message = "Not allowed", status = 403) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * The signed token is only a hint about who the user *was*. Role and school
 * can be revoked, and a 14-day token would otherwise carry a demotion for a
 * fortnight. Every guard re-reads the user row, so demoting someone takes
 * effect on their next request.
 */
async function liveUser(
  userId: string,
  issuedAt: number,
): Promise<{ role: Role; mode: UserMode; schoolId: string | null } | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, mode: true, schoolId: true, passwordChangedAt: true },
  });
  if (!row) return null;
  if (!isRole(row.role) || !isMode(row.mode)) return null;
  // A token minted before the password last changed is no longer good. This is
  // what makes "change my password" revoke the sessions that were signed with
  // the old one, rather than only changing the password going forward.
  if (row.passwordChangedAt && issuedAt > 0 && issuedAt * 1000 < row.passwordChangedAt.getTime() - 1000) {
    return null;
  }
  return { role: row.role, mode: row.mode, schoolId: row.schoolId };
}

/**
 * The session with `role`, `mode` and `schoolId` replaced by whatever the
 * database says right now. Throws AuthError if the user is gone.
 */
export async function requireSession(): Promise<Session> {
  const token = await getSession();
  if (!token) redirect("/login");
  const live = await liveUser(token.userId, token.issuedAt);
  if (!live) {
    // The account was deleted, the role is no longer recognised, or the
    // password changed after this cookie was issued.
    redirect("/login");
  }
  return { ...token, role: live.role, mode: live.mode, schoolId: live.schoolId };
}

/** Any of the given roles. Unknown roles are rejected, not downgraded. */
export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect("/no-access");
  return session;
}

/** A teacher session that definitely has a school, for school-scoped queries. */
export async function requireTeacher(): Promise<SchoolSession> {
  const session = await requireSession();
  if (!canTeach(session.role)) redirect("/no-access");
  // Every teacher, parent and student belongs to a school record — home
  // educators get a private one at registration. If it is missing, the
  // account is broken and there is nothing sensible to show.
  if (!session.schoolId) redirect("/no-access");
  return session as SchoolSession;
}

/* ------------------------------------------------------------------ */
/* Route-handler variants                                              */
/* ------------------------------------------------------------------ */

/**
 * Route-handler guard. Returns a Response for the caller to return, or the
 * live session to continue with. `roles` empty means "any signed-in user".
 */
export async function requireApi(...roles: Role[]): Promise<{ session: Session } | { response: NextResponse }> {
  const token = await getSession();
  if (!token) {
    return { response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  const live = await liveUser(token.userId, token.issuedAt);
  if (!live) {
    return { response: NextResponse.json({ error: "Session no longer valid" }, { status: 401 }) };
  }
  const session: Session = { ...token, role: live.role, mode: live.mode, schoolId: live.schoolId };
  if (roles.length > 0 && !roles.includes(session.role)) {
    return { response: NextResponse.json({ error: "Not allowed" }, { status: 403 }) };
  }
  return { session };
}

/* ------------------------------------------------------------------ */
/* Resource-level checks                                               */
/* ------------------------------------------------------------------ */

/**
 * Verify the signed-in user may touch a class.
 *
 * Denials are redirects or 404s, never a thrown error. Throwing here would
 * reach the nearest error boundary and render a 500 — which tells a teacher
 * that *something* broke when in fact they are simply not allowed, and is worse
 * than either honest answer below.
 *
 * Administrators may touch any class in their own school. Teachers may touch
 * only classes they are assigned to; a class with no assigned teacher is treated
 * as unclaimed and therefore *not* open to every teacher in the school, because
 * "nobody owns it" is a data-entry gap, not an invitation.
 */
export async function assertClassAccess(session: Session, classId: string): Promise<void> {
  const cls = await prisma.class.findUnique({
    where: { id: classId },
    select: { schoolId: true, teacherId: true },
  });
  if (!cls) notFound();

  // Across a school boundary, answer 404 rather than 403: a 403 confirms the id
  // is real, and confirming that is itself a leak.
  if (session.schoolId && cls.schoolId !== session.schoolId) notFound();

  if (session.role === "ADMIN") return;

  if (session.role === "TEACHER") {
    // Same school, wrong teacher. The class genuinely exists and this person can
    // see that it exists, so there is nothing to hide — send them somewhere that
    // explains why, the same place a role mismatch goes.
    if (cls.teacherId !== session.userId) redirect("/no-access");
    return;
  }

  redirect("/no-access");
}

/**
 * Verify the signed-in user may read a child's record.
 *
 * Honours `ParentLink.revokedAt`, so a withdrawn consent takes effect on the
 * next read rather than at the moment it was revoked.
 *
 * Note that a teacher is *not* waved through. "Is a teacher" is not "may see
 * every child in every school" — a home educator's private classroom and the
 * school next door are different tenants, and this used to return true for any
 * `studentId` at all.
 */
export async function assertStudentAccess(session: Session, studentId: string): Promise<void> {
  if (canTeach(session.role)) {
    if (!session.schoolId) throw new AuthError("No school on this account", 403);
    const inSchool = await prisma.enrollment.findFirst({
      where: { studentId, class: { schoolId: session.schoolId } },
      select: { id: true },
    });
    if (!inSchool) notFound();
    return;
  }

  if (session.role === "STUDENT") {
    const me = await prisma.student.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (me?.id !== studentId) throw new AuthError("Not your record", 403);
    return;
  }

  if (session.role === "PARENT") {
    const link = await prisma.parentLink.findFirst({
      where: { parentId: session.userId, studentId, revokedAt: null },
      select: { id: true },
    });
    if (!link) notFound();
    return;
  }

  throw new AuthError("Not allowed", 403);
}

export type { Role, UserMode, Session };
