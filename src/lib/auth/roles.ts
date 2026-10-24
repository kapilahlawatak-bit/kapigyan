/**
 * Roles, modes and what each one may do.
 *
 * Kept in one file and enforced in one place (`requireRole`) so that a new
 * route cannot accidentally widen access. Home education is a *mode*, not a
 * role: a home educator is a teacher, they just do not have a roster, and the
 * app should not pretend otherwise.
 */

export const ROLES = ["ADMIN", "TEACHER", "STUDENT", "PARENT"] as const;
export type Role = (typeof ROLES)[number];

export const MODES = ["SCHOOL", "HOME"] as const;
export type UserMode = (typeof MODES)[number];

export const ROLE_LABEL: Record<Role, { en: string; hi: string }> = {
  ADMIN: { en: "School administrator", hi: "विद्यालय प्रशासक" },
  TEACHER: { en: "Teacher", hi: "शिक्षक" },
  STUDENT: { en: "Student", hi: "विद्यार्थी" },
  PARENT: { en: "Parent", hi: "अभिभावक" },
};

export const MODE_LABEL: Record<UserMode, { en: string; hi: string }> = {
  SCHOOL: { en: "School", hi: "विद्यालय" },
  HOME: { en: "Home schooling", hi: "घरेलू शिक्षा" },
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isMode(value: string): value is UserMode {
  return (MODES as readonly string[]).includes(value);
}

/** Routes each role is allowed to land on after signing in. */
export function homeFor(role: Role, mode: UserMode): string {
  if (role === "STUDENT") return "/me";
  if (role === "PARENT") return "/parent";
  if (mode === "HOME") return "/home";
  // An administrator is a teacher first. `/admin` does not exist, so sending
  // them there was a dead link; the principal view is the school-wide one and
  // is open to teachers as well.
  return "/dashboard";
}

export const TEACHER_LIKE: Role[] = ["ADMIN", "TEACHER"];

/**
 * May this role teach? Home educators are teachers, so they inherit every
 * teacher capability.
 *
 * Note that `canSeeClass` is a *role* check, not an *ownership* check. It
 * answers "is this kind of account allowed on class pages at all", and nothing
 * more — whether this particular teacher may touch this particular class is
 * `assertClassAccess`, which looks at `Class.teacherId`. The two used to be
 * the same predicate under two names, which read like a two-tier policy that
 * did not exist.
 */
export function canTeach(role: Role): boolean {
  return TEACHER_LIKE.includes(role);
}

export function canSeeClass(role: Role): boolean {
  return TEACHER_LIKE.includes(role);
}
