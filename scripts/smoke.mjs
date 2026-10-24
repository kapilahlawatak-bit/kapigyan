/**
 * Smoke test.
 *
 * Mints a real session cookie for each seeded role and fetches the pages that
 * role is supposed to see — including a few it is *not* supposed to see, to
 * confirm the guards actually hold. Run against a live server:
 *
 *   node scripts/smoke.mjs http://localhost:3111
 */

import { SignJWT } from "jose";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3111";

// Read the secret from .env the same way Next does.
const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const secretLine = envText.split(/\r?\n/).find((l) => l.startsWith("AUTH_SECRET="));
if (!secretLine) throw new Error("AUTH_SECRET not found in .env");
const secret = new TextEncoder().encode(
  secretLine.slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, ""),
);

const { PrismaClient } = await import("../src/generated/prisma/client.js");
const prisma = new PrismaClient();

async function tokenFor(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user ${email}`);
  return {
    user,
    cookie: await new SignJWT({
      sid: user.schoolId, rol: user.role, mod: user.mode, nm: user.name, em: user.email,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime("3600s")
      .sign(secret),
  };
}

let pass = 0;
let fail = 0;

async function check(label, path, cookie, expect) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: cookie ? { cookie: `kapigyan_session=${cookie}` } : {},
      redirect: "manual",
    });
    const ok = expect.includes(res.status);
    console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${path.padEnd(28)} ${res.status}`);
    if (ok) pass += 1;
    else fail += 1;
    if (!ok && res.status >= 500) {
      const body = await res.text();
      console.log("      " + body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 400));
    }
  } catch (err) {
    console.log(`FAIL  ${label.padEnd(34)} ${path.padEnd(28)} ${err.message}`);
    fail += 1;
  }
}

/**
 * Assert the response is *not* a successful render.
 *
 * Deliberately weaker than `check`, and that is the point: which status a
 * refusal arrives as is not the property worth pinning. A page whose guard
 * redirects to the explanation page answers 307; one that hides the resource
 * answers 404; one that calls a helper returning a verdict nobody reads answers
 * 200. Only the last of those is a bug, and it is the failure this whole
 * section exists to catch. Pinning exact codes would have let a 200 hide behind
 * an unrelated refactor of the redirect target.
 */
async function deny(label, path, cookie) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: cookie ? { cookie: `kapigyan_session=${cookie}` } : {},
      redirect: "manual",
    });
    const ok = res.status !== 200;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${path.padEnd(28)} ${res.status}${ok ? "" : "  ← REACHABLE"}`);
    if (ok) pass += 1;
    else fail += 1;
  } catch (err) {
    console.log(`FAIL  ${label.padEnd(34)} ${path.padEnd(28)} ${err.message}`);
    fail += 1;
  }
}

const teacher = await tokenFor("teacher@kapigyan.test");
const parent = await tokenFor("parent@kapigyan.test");
const home = await tokenFor("home@kapigyan.test");
const child = await tokenFor("child1@kapigyan.test");

/**
 * The rest of this file mints its own tokens, which means it would happily
 * pass against accounts that could not sign in at all — the seed once stored
 * a sha256 digest while login verified with bcrypt, and every route test here
 * stayed green. So check the real thing first: the documented password must
 * actually authenticate, and a wrong one must not.
 */
console.log("— seeded accounts can really sign in —");
const bcrypt = (await import("bcryptjs")).default;
for (const role of [teacher, parent, home, child]) {
  const ok = await bcrypt.compare("kapigyan", role.user.passwordHash);
  const bad = await bcrypt.compare("not-the-password", role.user.passwordHash);
  if (ok && !bad) {
    console.log(`PASS  password for ${role.user.email}`);
    pass += 1;
  } else {
    console.log(`FAIL  password for ${role.user.email}  correct=${ok} wrongRejected=${!bad}`);
    fail += 1;
  }
}

console.log("\n— public —");
await check("landing", "/", null, [200]);
await check("login", "/login", null, [200]);
await check("register", "/register", null, [200]);

console.log("\n— teacher —");
for (const p of ["/dashboard", "/tests", "/tests/new", "/generator", "/insights", "/students",
                 "/classes", "/question-bank", "/settings", "/reports", "/home", "/home/progress",
                 "/home/curriculum", "/curriculum", "/plan", "/plan?weeks=8&sessions=3", "/quality",
                 "/question-bank", "/quality?verdict=diagnosing", "/gain"]) {
  await check("teacher", p, teacher.cookie, [200]);
}
// The register and the roster now live together on /classes ("Register"), so
// the old /attendance route forwards there instead of 404-ing a bookmark.
{
  const res = await fetch(`${BASE}/attendance`, {
    headers: { cookie: `kapigyan_session=${teacher.cookie}` },
    redirect: "manual",
  });
  const loc = res.headers.get("location") ?? "";
  const ok = res.status === 307 && loc.includes("/classes");
  console.log(`${ok ? "PASS" : "FAIL"}  ${"attendance forwards to the register".padEnd(34)} ${"/attendance".padEnd(28)} ${res.status}${ok ? "" : ` → ${loc}`}`);
  if (ok) pass += 1; else fail += 1;
}
const planCls = await prisma.class.findFirst({ where: { schoolId: teacher.user.schoolId } });
if (planCls) {
  await check("teacher plan print", `/plan/print?class=${planCls.id}`, teacher.cookie, [200]);
  await check("teacher plan pdf", `/api/plan/${planCls.id}`, teacher.cookie, [200]);
  // A parent and a child must not be able to pull a whole class plan.
  await check("parent cannot read a teaching plan", `/api/plan/${planCls.id}`, parent.cookie, [403, 404]);
  await check("student cannot read a teaching plan", `/api/plan/${planCls.id}`, child.cookie, [403, 404]);
  await check("anon cannot read a teaching plan", `/api/plan/${planCls.id}`, null, [401, 403]);
  // Nor the printable version.
  await check("parent cannot print a teaching plan", `/plan/print?class=${planCls.id}`, parent.cookie, [307, 403]);
}

// The teacher's own papers and one child, taken from the database.
const paper = await prisma.paper.findFirst({ where: { classId: { not: null } } });
const student = await prisma.student.findFirst({ where: { submissions: { some: {} } } });
if (paper) {
  await check("teacher paper", `/tests/${paper.id}`, teacher.cookie, [200]);
  await check("teacher mark", `/tests/${paper.id}/mark`, teacher.cookie, [200]);
  await check("teacher analysis", `/tests/${paper.id}/analysis`, teacher.cookie, [200]);
  await check("teacher fast review", `/tests/${paper.id}/review`, teacher.cookie, [200]);
  await check("teacher pre-flight check", `/tests/${paper.id}/preflight`, teacher.cookie, [200]);
  await check("teacher bubble sheet entry", `/tests/${paper.id}/omr`, teacher.cookie, [200]);
  await check("teacher bubble sheet print", `/tests/${paper.id}/omr/print`, teacher.cookie, [200]);
  await check("parent cannot open bubble sheet", `/tests/${paper.id}/omr`, parent.cookie, [307, 403]);
  await check("teacher today view", "/today", teacher.cookie, [200]);
  await check("parent cannot open pre-flight", `/tests/${paper.id}/preflight`, parent.cookie, [307, 403]);
  await check("parent cannot open today", "/today", parent.cookie, [307, 403]);
  await check("teacher messages home", "/classes/nudge", teacher.cookie, [200]);
  // A parent must not see messages drafted for other families.
  await check("parent cannot see messages home", "/classes/nudge", parent.cookie, [307, 403]);
  await check("teacher re-check paper", `/tests/${paper.id}/recheck`, teacher.cookie, [200]);
  await check("school overview", "/principal", teacher.cookie, [200]);
  await check("parent cannot see the school overview", "/principal", parent.cookie, [307, 403]);

  // Data export: the four real downloads, and the refusals that matter.
  for (const fmt of ["xlsx", "csv", "json", "docx"]) {
    const res = await fetch(`${BASE}/api/export/school/${fmt}`, {
      headers: { cookie: `kapigyan_session=${teacher.cookie}` },
      redirect: "manual",
    });
    const body = await res.arrayBuffer();
    const good = res.status === 200 && body.byteLength > 200 &&
      (res.headers.get("content-disposition") ?? "").includes("attachment");
    console.log(
      `${good ? "PASS" : "FAIL"}  ${`data export ${fmt}`.padEnd(34)} ${`${body.byteLength} bytes`.padEnd(28)} ${res.status}`,
    );
    if (good) pass += 1; else fail += 1;
    if (!good) console.log("      " + Buffer.from(body).toString("utf8").slice(0, 300));
  }
  await check("a parent cannot export the whole school", "/api/export/school/json", parent.cookie, [403]);
  await check("an anonymous request cannot export", "/api/export/school/json", "", [401]);

  // The self check is a child-facing page. A parent must not be able to walk in.
  await check("a parent cannot open the child self check", "/classes/x/reflect", parent.cookie, [307, 403, 404]);
  await check("a parent cannot read self check results", "/classes/x/reflect/set", parent.cookie, [307, 403, 404]);
  // The class list links to the handover note, so a real id can be read from
  // the page rather than guessed at. Matched loosely because the href may be
  // rendered with an escaped slash or split across attributes.
  const classHtml = await (await fetch(`${BASE}/classes`, { headers: { cookie: teacher.cookie } })).text();
  const someClass =
    classHtml.match(/\/classes\/([a-z0-9]{10,})\/handover/)?.[1] ??
    classHtml.match(/href="([^"]*classes[^"]*handover[^"]*)"/)?.[1]?.match(/([a-z0-9]{10,})/)?.[1];
  // The handover page is checked over HTTP in verify-content, which can read
  // a real class id from the database — the seeded teacher here has no class
  // list to scrape an id from.
  if (someClass) {
    await check("teacher handover note", `/classes/${someClass}/handover`, teacher.cookie, [200]);
  }  await check("teacher print", `/tests/${paper.id}/print`, teacher.cookie, [200]);
  for (const fmt of ["xlsx", "docx", "pdf"]) {
    await check(`teacher export ${fmt}`, `/api/papers/${paper.id}/export/${fmt}`, teacher.cookie, [200]);
  }
}
if (student) {
  await check("teacher student", `/students/${student.id}`, teacher.cookie, [200]);
  await check("student pdf", `/api/reports/student/${student.id}`, teacher.cookie, [200]);
}

console.log("\n— home educator —");
await check("home", "/home", home.cookie, [200]);
await check("home progress", "/home/progress", home.cookie, [200]);
await check("home curriculum", "/home/curriculum", home.cookie, [200]);

console.log("\n— student —");
await check("me", "/me", child.cookie, [200]);
await check("me tests", "/me/tests", child.cookie, [200]);
await check("me practice", "/me/practice", child.cookie, [200]);

console.log("\n— parent —");
await check("parent list", "/parent", parent.cookie, [200]);
await check("parent practice", "/parent/practice", parent.cookie, [200]);
const link = await prisma.parentLink.findFirst({ where: { parentId: parent.user.id, revokedAt: null } });
if (link) {
  await check("parent report", `/parent/report/${link.studentId}`, parent.cookie, [200]);
  await check("parent pdf", `/api/reports/parent/${link.studentId}`, parent.cookie, [200]);
  const topic = await prisma.question.findFirst({
    where: { topicId: { not: null } },
    select: { topicId: true },
  });
  if (topic?.topicId) {
    await check("parent practice print", `/parent/practice/print?child=${link.studentId}&topic=${topic.topicId}`, parent.cookie, [200]);
    await check("parent practice pdf", `/api/practice/${link.studentId}/${topic.topicId}`, parent.cookie, [200]);
  }
}

console.log("\n— guards (these must NOT be 200) —");
await check("teacher blocked from /parent", "/parent", teacher.cookie, [307, 302, 404]);
await check("teacher blocked from /me", "/me", teacher.cookie, [307, 302, 404]);
await check("parent blocked from /insights", "/insights", parent.cookie, [307, 302, 404]);
await check("parent blocked from /tests", "/tests", parent.cookie, [307, 302, 404]);
await check("anon blocked from /dashboard", "/dashboard", null, [307, 302]);
if (link) {
  // Must be a child this parent is *not* linked to — the seed links two.
  const other = await prisma.student.findFirst({
    where: { parents: { none: { parentId: parent.user.id } } },
  });
  if (other) {
    await check("parent cannot read unrelated child", `/parent/report/${other.id}`, parent.cookie, [404, 307]);
    await check("parent cannot fetch unrelated pdf", `/api/reports/parent/${other.id}`, parent.cookie, [403, 404]);
  } else {
    console.log("SKIP  no unlinked student available for the guard check");
  }
}

/* ------------------------------------------------------------------ */
/* Tenant isolation                                                     */
/*                                                                      */
/* Every negative check above is about *roles*. These are about *owning */
/* a resource*, which is the check that was silently absent:            */
/* `assertClassAccess` used to `return { ok: false }` and all eighteen  */
/* call sites discarded it, so school-level tenancy was the only thing  */
/* enforced and any teacher could write attendance, reflections,        */
/* imported marks and OMR data for any class in any school. These       */
/* build a second teacher in the same school, with their own class, and */
/* assert that teacher one cannot reach it.                              */
/* ------------------------------------------------------------------ */

console.log("\n— tenancy: a teacher cannot touch another teacher's class —");

const fixtureIds = { class: null, paper: null, users: [] };
try {
  const school = await prisma.school.findFirst({ where: { users: { some: { email: "teacher@kapigyan.test" } } }, select: { id: true } });
  if (!school) {
    console.log("SKIP  no school found for the tenancy check");
  } else {
    // A second teacher inside the *same* school, so the only thing that can
    // deny access is ownership rather than the school boundary.
    const suffix = Date.now().toString(36);
    const other = await prisma.user.create({
      data: {
        schoolId: school.id,
        email: `smoke-other-${suffix}@kapigyan.test`,
        passwordHash: teacher.user.passwordHash,
        name: "Smoke Other Teacher",
        role: "TEACHER",
        mode: "SCHOOL",
        consentAt: new Date(),
        consentBy: "smoke",
      },
      select: { id: true, email: true, name: true, passwordHash: true, role: true, mode: true, schoolId: true },
    });
    fixtureIds.users.push(other.id);

    const otherClass = await prisma.class.create({
      data: { schoolId: school.id, name: `Smoke ${suffix}`, grade: 3, year: "2026-27", teacherId: other.id },
      select: { id: true },
    });
    fixtureIds.class = otherClass.id;

    const otherPaper = await prisma.paper.create({
      data: {
        schoolId: school.id,
        classId: otherClass.id,
        createdBy: other.id,
        title: "Smoke tenancy paper",
        grade: 3,
        term: "Practice",
        source: "MANUAL",
        status: "GRADED",
        maxMarks: 0,
      },
      select: { id: true },
    });
    fixtureIds.paper = otherPaper.id;

    // `tokenFor` returns { cookie, user } — passing the object itself would
    // send a "[object Object]" header, and every check below would then be
    // passing as "not signed in" rather than as "not allowed".
    const otherSession = await tokenFor(other.email);
    const otherCookie = otherSession.cookie;
    // Sanity: the owner gets in. Without this, every check below would pass
    // for the wrong reason — a 404 caused by a bad fixture rather than by the
    // guard doing its job.
    await check("the owning teacher can open their own class pages", `/tests/${otherPaper.id}/omr`, otherCookie, [200]);
    await check("the owning teacher can print their own plan", `/plan/print?class=${otherClass.id}`, otherCookie, [200]);

    // Now the real assertions: same school, different teacher.
    await deny("teacher one cannot open the other teacher's paper", `/tests/${otherPaper.id}`, teacher.cookie);
    await deny("teacher one cannot open its analysis", `/tests/${otherPaper.id}/analysis`, teacher.cookie);
    await deny("teacher one cannot open its OMR sheet", `/tests/${otherPaper.id}/omr`, teacher.cookie);
    await deny("teacher one cannot print its bubble sheet", `/tests/${otherPaper.id}/omr/print`, teacher.cookie);
    await deny("teacher one cannot run its pre-flight check", `/tests/${otherPaper.id}/preflight`, teacher.cookie);
    await deny("teacher one cannot mark it", `/tests/${otherPaper.id}/mark`, teacher.cookie);
    await deny("teacher one cannot review it", `/tests/${otherPaper.id}/review`, teacher.cookie);
    await deny("teacher one cannot print it", `/tests/${otherPaper.id}/print`, teacher.cookie);
    await deny("teacher one cannot re-check it", `/tests/${otherPaper.id}/recheck`, teacher.cookie);
    await deny("teacher one cannot export it", `/api/papers/${otherPaper.id}/export/pdf`, teacher.cookie);
    await deny("teacher one cannot export it as a spreadsheet", `/api/papers/${otherPaper.id}/export/xlsx`, teacher.cookie);
    await deny("teacher one cannot fetch its term plan", `/api/plan/${otherClass.id}`, teacher.cookie);
    await deny("teacher one cannot open its handover note", `/classes/${otherClass.id}/handover`, teacher.cookie);
    await deny("teacher one cannot open its self-check", `/classes/${otherClass.id}/reflect`, teacher.cookie);
    await deny("teacher one cannot open its self-check results", `/classes/${otherClass.id}/reflect/set`, teacher.cookie);
    await deny("teacher one cannot print its self-check sheet", `/classes/${otherClass.id}/reflect/print`, teacher.cookie);
    await deny("teacher one cannot open its mark import", `/classes/${otherClass.id}/import`, teacher.cookie);

    /* A role that is revoked must stop working immediately, not when the
     * fourteen-day cookie happens to expire. */
    await prisma.user.update({ where: { id: other.id }, data: { role: "STUDENT" } });
    await deny("a role demoted in the database loses access at once", `/tests/${otherPaper.id}/omr`, otherCookie);
    await deny("a demoted account loses the dashboard too", `/dashboard`, otherCookie);
  }
} finally {
  // Always clean up, even if a check threw: leaving a stray teacher and class
  // in the demo database would be worse than a failed run.
  if (fixtureIds.paper) await prisma.paper.deleteMany({ where: { id: fixtureIds.paper } });
  if (fixtureIds.class) await prisma.class.deleteMany({ where: { id: fixtureIds.class } });
  if (fixtureIds.users.length) await prisma.user.deleteMany({ where: { id: { in: fixtureIds.users } } });
}

await prisma.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
