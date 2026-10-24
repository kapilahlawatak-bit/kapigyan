"use server";

/**
 * Sign up, sign in, sign out.
 *
 * Onboarding matters more than usual here. A real deployment has two very
 * different people arriving at the same form: a teacher who already belongs to
 * a school and just needs to enter its code, and a parent who is home
 * educating and has no school at all. The form asks which one, because the
 * difference decides whether they ever see a class roster, a roll register or a
 * school timetable.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/session";
import { requireRole } from "@/lib/auth/guard";
import { homeFor, isMode, isRole, type Role } from "@/lib/auth/roles";
import { setLocale } from "@/lib/i18n";
import { hashSeed } from "@/lib/question-generation/templates";

export type ActionState = { error?: string; fieldErrors?: Record<string, string> } | null;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Please enter your name").max(80),
    email: z.string().trim().toLowerCase().email("That email address does not look right"),
    password: z.string().min(8, "Use at least 8 characters").max(200),
    mode: z.enum(["SCHOOL", "HOME"]),
    // School mode only.
    schoolName: z.string().trim().max(120).optional(),
    schoolCode: z.string().trim().toUpperCase().max(20).optional(),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    role: z
      .enum(["TEACHER", "PARENT", "STUDENT"])
      .default("TEACHER")
      .describe(
        "Self-service roles only. ADMIN is never accepted from the client: it is granted to the first account that creates a school, or by an existing admin. Otherwise anyone could post role=ADMIN and be handed the whole school.",
      ),
    // Home mode only: the children being taught.
    childNames: z.string().trim().max(400).optional(),
    childGrade: z.coerce.number().int().min(1).max(5).default(3),
  })
  .refine((d) => d.mode === "HOME" || d.schoolName || d.schoolCode, {
    message: "Enter your school name, or enter an existing school code",
    path: ["schoolName"],
  });

function slugCode(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 5);
  return `${base || "SCH"}${Math.floor(Math.random() * 9000 + 1000)}`;
}

/* ------------------------------------------------------------------ */
/* Register                                                            */
/* ------------------------------------------------------------------ */

export async function register(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    mode: formData.get("mode") || "SCHOOL",
    schoolName: formData.get("schoolName") || undefined,
    schoolCode: formData.get("schoolCode") || undefined,
    city: formData.get("city") || undefined,
    state: formData.get("state") || undefined,
    role: formData.get("role") || "TEACHER",
    childNames: formData.get("childNames") || undefined,
    childGrade: formData.get("childGrade") || 3,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Please check the highlighted fields", fieldErrors };
  }

  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email }, select: { id: true } });
  if (existing) {
    return { fieldErrors: { email: "An account already exists with this email. Try signing in." } };
  }

  const passwordHash = await bcrypt.hash(data.password, 12);

  // Find or create the school.
  let schoolId: string | null = null;
  // Set when this registration is the one that brought the school into being,
  // in which case the person who named the school administers it.
  let foundingSchool = false;
  if (data.mode === "SCHOOL") {
    if (data.schoolCode) {
      const school = await prisma.school.findUnique({ where: { code: data.schoolCode }, select: { id: true } });
      if (!school) {
        return { fieldErrors: { schoolCode: "No school has that code. Check with your school office, or create a new school." } };
      }
      schoolId = school.id;
    } else if (data.schoolName) {
      const school = await prisma.school.create({
        data: {
          name: data.schoolName,
          code: slugCode(data.schoolName),
          city: data.city || null,
          state: data.state || null,
        },
        select: { id: true },
      });
      schoolId = school.id;
      foundingSchool = true;
    }
  } else {
    // Home educators get a private "school" record so that ownership checks
    // work identically for everybody and no code path has to special-case them.
    const school = await prisma.school.create({
      data: {
        name: `${data.name.split(" ")[0]}'s home classroom`,
        code: slugCode(`HOME${data.name}`),
        academicYear: `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(2)}`,
      },
      select: { id: true },
    });
    schoolId = school.id;
  }

  const year = new Date().getFullYear();
  const academicYear = `${year}-${String(year + 1).slice(2)}`;

  // The role is decided here, not taken from the form. A hidden `role` input is
  // not a trust boundary, so ADMIN is only ever granted to the person who
  // created the school in the first place.
  const role: Role =
    data.mode === "HOME" ? "TEACHER" : foundingSchool && !data.schoolCode ? "ADMIN" : data.role;

  const user = await prisma.user.create({
    data: {
      schoolId,
      email: data.email,
      passwordHash,
      name: data.name,
      role,
      mode: data.mode,
      // DPDP Act 2023: record who gave consent and when. A guardian creating
      // their own account is the verifiable consent for their own child's data.
      // A child cannot consent to their own processing, so a student account
      // is left without consent and stays pending until a guardian links.
      consentAt: data.role === "STUDENT" ? null : new Date(),
      consentBy: data.role === "STUDENT" ? null : data.name,
    },
    select: { id: true, name: true, email: true, role: true, mode: true, schoolId: true },
  });

  // A teacher's first class, so the app is never empty on first login.
  if (role === "TEACHER" || role === "ADMIN" || data.mode === "HOME") {
    const grade = data.mode === "HOME" ? data.childGrade : 3;
    await prisma.class.create({
      data: {
        schoolId: schoolId!,
        name: data.mode === "HOME" ? "Class" : "3-A",
        grade,
        section: data.mode === "HOME" ? null : "A",
        year: academicYear,
        teacherId: user.id,
      },
    });
  }

  // Home educators: create a student record per named child and enrol them.
  if (data.mode === "HOME") {
    const cls = await prisma.class.findFirst({ where: { schoolId: schoolId!, teacherId: user.id }, select: { id: true } });
    const names = (data.childNames ?? "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 6);

    let roll = 1;
    for (const childName of names.length > 0 ? names : ["Child"]) {
      await prisma.student.create({
        data: {
          name: childName,
          rollNo: roll++,
          enrollments: cls ? { create: { classId: cls.id, rollNo: roll - 1 } } : undefined,
        },
      });
    }
  }

  await setSessionCookie({
    userId: user.id,
    schoolId: user.schoolId,
    role: isRole(user.role) ? user.role : "TEACHER",
    mode: isMode(user.mode) ? user.mode : "SCHOOL",
    name: user.name,
    email: user.email,
  });

  await setLocale((formData.get("locale") as string) || "en");
  revalidatePath("/", "layout");
  redirect(homeFor(isRole(user.role) ? user.role : "TEACHER", isMode(user.mode) ? user.mode : "SCHOOL"));
}

/* ------------------------------------------------------------------ */
/* Sign in / out                                                       */
/* ------------------------------------------------------------------ */

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Enter your email address and password" };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, name: true, email: true, passwordHash: true, role: true, mode: true, schoolId: true },
  });

  // Same message either way, so the form cannot be used to discover which
  // email addresses have accounts.
  const generic = { error: "That email address and password do not match" };
  if (!user) {
    // Still run a hash so the timing does not reveal whether the account exists.
    await bcrypt.compare(parsed.data.password, "$2a$12$dummyhashdummyhashdummyhashdummyhashdummyhashdummyhashdu");
    return generic;
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!ok) return generic;

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const role = isRole(user.role) ? user.role : "TEACHER";
  const mode = isMode(user.mode) ? user.mode : "SCHOOL";
  await setSessionCookie({
    userId: user.id,
    schoolId: user.schoolId,
    role,
    mode,
    name: user.name,
    email: user.email,
  });

  await setLocale((formData.get("locale") as string) || "en");
  revalidatePath("/", "layout");
  redirect(homeFor(role, mode));
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  revalidatePath("/", "layout");
  redirect("/login");
}

/* ------------------------------------------------------------------ */
/* Parent linking                                                      */
/* ------------------------------------------------------------------ */

const linkSchema = z.object({
  childEmail: z.string().trim().toLowerCase().email(),
  childName: z.string().trim().min(2),
  childGrade: z.coerce.number().int().min(1).max(5),
  className: z.string().trim().max(40),
});

/**
 * A parent claims a child by email.
 *
 * The child's account must already exist — the parent is attaching themselves
 * to existing school data, not creating it. This keeps the consent trail
 * unambiguous under the DPDP Act: the school created the record, and the
 * parent attaches to it explicitly.
 */
export async function linkChild(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = linkSchema.safeParse({
    childEmail: formData.get("childEmail"),
    childName: formData.get("childName"),
    childGrade: formData.get("childGrade"),
    className: formData.get("className"),
  });
  if (!parsed.success) return { error: "Please fill in every field" };

  const session = await requireRole("PARENT");

  const child = await prisma.user.findUnique({
    where: { email: parsed.data.childEmail },
    select: { id: true, role: true, name: true, schoolId: true },
  });
  if (!child) {
    return { fieldErrors: { childEmail: "No account with that email. Ask the school to create one first." } };
  }
  if (child.role !== "STUDENT") {
    return { fieldErrors: { childEmail: "That account is not a student account." } };
  }
  if (!session.schoolId || child.schoolId !== session.schoolId) {
    return { fieldErrors: { childEmail: "That account belongs to a different school." } };
  }

  // Prefer the student record already attached to the child's own login, then
  // fall back to a name match *within this school only*. The previous lookup
  // matched on name across the whole database, so a parent who guessed a
  // first name could attach themselves to a child at another school.
  const student =
    (await prisma.student.findFirst({
      where: { userId: child.id, enrollments: { some: { class: { schoolId: session.schoolId } } } },
      select: { id: true },
    })) ??
    (await prisma.student.findFirst({
      where: {
        name: parsed.data.childName,
        enrollments: { some: { class: { schoolId: session.schoolId } } },
      },
      select: { id: true },
    }));
  if (!student) {
    return {
      fieldErrors: {
        childName: `No child named "${parsed.data.childName}" is on the roll of your school. Check the spelling with the class teacher.`,
      },
    };
  }
  const studentId = student.id;

  await prisma.parentLink.upsert({
    where: { parentId_studentId: { parentId: session.userId, studentId } },
    create: { parentId: session.userId, childId: child.id, studentId, consentAt: new Date() },
    update: { consentAt: new Date(), revokedAt: null },
  });

  revalidatePath("/parent");
  return { error: undefined };
}

export { hashSeed };
