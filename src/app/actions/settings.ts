"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clearSessionCookie } from "@/lib/auth/session";
import { requireSession } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/audit";
import { setLocale, type Locale } from "@/lib/i18n";

/** Account, school, language and data-rights actions. */

/**
 * The live session, not the raw token.
 *
 * `getSession()` alone would hand back the role the cookie was minted with,
 * which for fourteen days would keep honouring a demotion that never took
 * effect. `renameSchool` gates on ADMIN, so that distinction matters here.
 */
async function sessionOrThrow() {
  return requireSession();
}

export async function updateProfile(formData: FormData): Promise<void> {
  const session = await sessionOrThrow();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (name.length < 2) throw new Error("Please enter your name");

  await prisma.user.update({ where: { id: session.userId }, data: { name } });
  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function changePassword(formData: FormData): Promise<void> {
  const session = await sessionOrThrow();
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  if (next.length < 8) throw new Error("Use at least 8 characters");
  if (!/[0-9]/.test(next)) throw new Error("Include at least one number");

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user?.passwordHash) throw new Error("This account has no password");

  const { compare, hash } = await import("bcryptjs");
  if (!(await compare(current, user.passwordHash))) throw new Error("That current password is not right");

  await prisma.user.update({
    where: { id: session.userId },
    data: { passwordHash: await hash(next, 12), passwordChangedAt: new Date() },
  });
  revalidatePath("/settings");
}

export async function switchLocale(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "en") as Locale;
  await setLocale(locale);
  revalidatePath("/", "layout");
}

/**
 * Rename the school.
 *
 * The school name appears on every printed paper and every exported report, so
 * it is a real setting rather than decoration — and it is restricted to the
 * admin role because it changes another person's institution's paperwork.
 */
export async function renameSchool(formData: FormData): Promise<void> {
  const session = await sessionOrThrow();
  if (session.role !== "ADMIN" || !session.schoolId) throw new Error("Only a school administrator can do this");
  const name = String(formData.get("schoolName") ?? "").trim().slice(0, 100);
  if (name.length < 2) throw new Error("Enter a school name");
  await prisma.school.update({ where: { id: session.schoolId }, data: { name } });
  revalidatePath("/settings");
}

/**
 * Record or withdraw consent to process a child's data.
 *
 * Under the DPDP Act 2023 a guardian can withdraw consent, and withdrawal has
 * to take effect on data *processing*, not just on display. So this writes a
 * revoked timestamp that every read path already filters on, and it also
 * deletes the parent's link entirely when the withdrawal is theirs to make.
 */
export async function setConsent(formData: FormData): Promise<void> {
  const session = await sessionOrThrow();
  const studentId = String(formData.get("studentId") ?? "");
  const grant = String(formData.get("grant") ?? "no") === "yes";

  const link = await prisma.parentLink.findFirst({ where: { parentId: session.userId, studentId } });
  if (!link) throw new Error("That link does not exist");

  await prisma.parentLink.update({
    where: { id: link.id },
    data: { consentAt: grant ? new Date() : link.consentAt, revokedAt: grant ? null : new Date() },
  });

  await recordAudit({
    schoolId: session.schoolId,
    actorId: session.userId,
    actorName: session.name,
    action: grant ? "consent_granted" : "consent_revoked",
    studentId,
    after: { consentAt: grant ? new Date().toISOString() : null, revokedAt: grant ? null : "set" },
    detail: grant
      ? "Guardian consent recorded for this child's report."
      : "Guardian withdrew consent. Report access is closed from now on.",
  });

  revalidatePath("/parent");
  revalidatePath(`/parent/report/${studentId}`);
}

/**
 * Erase an account and everything attached to it.
 *
 * A real right, not a checkbox. The important part is what is *not* deleted.
 *
 * `Submission.userId` is the *marker*, not the student — it records who
 * graded the paper. So a teacher exercising their right to erasure must not
 * take with them every submission they ever marked: those rows are the
 * children's assessment record, grades and inferred misconceptions included,
 * and the school holds its own duty to keep them. Deleting on `userId` (which
 * this used to do) silently destroyed one child's entire history because a
 * colleague pressed a button in Settings.
 *
 * So the scope is split three ways:
 *   - papers this account *authored*, and the answers inside them: deleted,
 *     because that content is theirs;
 *   - submissions belonging to this account's *own* student record: deleted,
 *     because those are their own results;
 *   - submissions this account merely marked: left alone, and the marker
 *     reference is dropped by `onDelete: SetNull` when the user row goes.
 */
export async function deleteMyData(formData: FormData): Promise<void> {
  const session = await sessionOrThrow();
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm.trim().toUpperCase() !== "DELETE") {
    throw new Error('Type DELETE in the box to confirm');
  }

  const owned = await prisma.paper.findMany({ where: { createdBy: session.userId }, select: { id: true } });
  const ownedIds = owned.map((p) => p.id);

  // Which child record, if any, is this account itself?
  const ownStudent = await prisma.student.findUnique({
    where: { userId: session.userId },
    select: { id: true },
  });

  await recordAudit({
    schoolId: session.schoolId,
    actorId: session.userId,
    actorName: session.name,
    action: "account_deleted",
    detail: `Account erased. ${ownedIds.length} authored paper(s) removed; marked submissions retained.`,
  });

  // Detach the children this account created so their school record survives.
  await prisma.student.updateMany({ where: { userId: session.userId }, data: { userId: null } });

  if (session.role === "PARENT") {
    await prisma.parentLink.deleteMany({ where: { parentId: session.userId } });
  }

  // Their own results, if this account is a student.
  if (ownStudent) {
    await prisma.answer.deleteMany({ where: { submission: { studentId: ownStudent.id } } });
    await prisma.submission.deleteMany({ where: { studentId: ownStudent.id } });
  }

  // Content this account authored.
  await prisma.answer.deleteMany({ where: { submission: { paperId: { in: ownedIds } } } });
  await prisma.paperQuestion.deleteMany({ where: { paperId: { in: ownedIds } } });
  await prisma.paper.deleteMany({ where: { id: { in: ownedIds } } });
  // Submissions on an authored paper go with it (Cascade); explicitly
  // detaching the marker here would be undone by the delete anyway.
  await prisma.user.delete({ where: { id: session.userId } });

  clearSessionCookie();
  redirect("/");
}

export async function signOut(): Promise<void> {
  clearSessionCookie();
  redirect("/login");
}
