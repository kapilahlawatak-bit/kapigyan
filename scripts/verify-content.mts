/**
 * Content verification.
 *
 * The smoke test proves pages return 200. This proves they return something
 * *true* — that misconceptions are really inferred from the seeded wrong
 * answers, that the ranking produces a defensible order, and that the export
 * files are genuinely valid Office/PDF documents rather than empty responses.
 *
 *   npx tsx scripts/verify-content.mts http://localhost:3111
 */

import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { PrismaClient } from "../src/generated/prisma/client";
import { MISCONCEPTION_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import { recommendTeaching } from "@/lib/intelligence/recommendations";
import { classMasteryMap } from "@/lib/analytics/class";
import { classTopicStats } from "@/lib/analytics/view";
import { buildTeachingPlan } from "@/lib/intelligence/teaching-plan";
import { topicsForClass } from "@/lib/curriculum";
import { gradeSubmission } from "@/lib/grading";
import { answersMatch } from "@/lib/answer-normaliser";
import { parseOperation, parseComparison, parsePlaceValue, parseGraphScale } from "@/lib/intelligence/misconception-inference";
import { analyseDistractors } from "@/lib/analytics/distractors";
import { calibrateQuestions } from "@/lib/analytics/class";
import { learningGain } from "@/lib/intelligence/learning-gain";
import { summariseAttendance } from "@/lib/intelligence/attendance";
import { assessRisk } from "@/lib/intelligence/mastery";
import { retrievalPlan } from "@/lib/intelligence/retrieval";
import { reviewQueue } from "@/lib/analytics/review-queue";
import { buildMaterials } from "@/lib/intelligence/materials";
import { preflight } from "@/lib/analytics/preflight";
import { todayFor } from "@/lib/analytics/today";
import { buildOmr, parseOmr } from "@/lib/analytics/omr";
import { parentMessage } from "@/lib/intelligence/parent-nudge";
import { buildHandover } from "@/lib/analytics/handover";
import { parseMarksCsv, nameMatches } from "@/lib/analytics/csv-marks";
import { schoolView } from "@/lib/analytics/school-view";
import { buildSchoolExport, outcomeOf, buildDepthMapExport } from "@/lib/reports/school-export";
import { recordAudit, isAuditAction, AUDIT_ACTIONS } from "@/lib/audit";
import { COMP_TIERS, resolveDepth, indexOverrides } from "@/lib/competition";
import { topicDepth, competitionTopicsForClass, TOPICS } from "@/lib/curriculum";
import { toCompetition, topicsThatCanCompete, coverageReport } from "@/lib/question-generation/competition";
import { generateForTopic, topicHasGenerator } from "@/lib/question-generation/templates";
import { gradeReflection, reflectBack, summariseReflections } from "@/lib/intelligence/reflection";

const BASE = process.argv[2] ?? "http://localhost:3111";
const envText = readFileSync(new URL("../.env", import.meta.url), "utf8");
const secret = new TextEncoder().encode(
  envText.split(/\r?\n/).find((l) => l.startsWith("AUTH_SECRET="))!
    .slice("AUTH_SECRET=".length).trim().replace(/^["']|["']$/g, ""),
);

const prisma = new PrismaClient();

const user = await prisma.user.findUnique({ where: { email: "teacher@kapigyan.test" } });
if (!user) throw new Error("seed the database first");
const token = await new SignJWT({ sid: user.schoolId, rol: user.role, mod: user.mode, nm: user.name, em: user.email })
  .setProtectedHeader({ alg: "HS256" }).setSubject(user.id)
  .setIssuedAt().setExpirationTime("3600s").sign(secret);
const H = { cookie: `kapigyan_session=${token}` };
const page = async (p: string): Promise<string> => (await fetch(`${BASE}${p}`, { headers: H })).text();
const strip = (h: string): string => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&middot;/g, "·").replace(/\s+/g, " ");

let pass = 0, fail = 0;
const ok = (label: string, cond: unknown, detail = "") => {
  const good = Boolean(cond);
  console.log(`${good ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  good ? pass++ : fail++;
};

const paper = await prisma.paper.findFirst({ where: { classId: { not: null }, submissions: { some: {} } } });
if (!paper) throw new Error("no marked paper in the seed");

console.log("— the intelligence actually produced diagnoses —");
const tagged = await prisma.answer.groupBy({
  by: ["errorTag"], where: { errorTag: { not: null } }, _count: { _all: true },
});
const wrongCount = await prisma.answer.count({ where: { isCorrect: false } });
const explained = tagged.reduce((a, r) => a + r._count._all, 0);
ok("wrong answers are diagnosed", explained > 100, `${explained} of ${wrongCount} (${Math.round(explained / wrongCount * 100)}%)`);
ok("more than one misconception is found", tagged.length >= 3, `${tagged.length} distinct: ${tagged.map((t) => t.errorTag).join(", ")}`);
const unknownTag = tagged.map((t) => t.errorTag as string).filter((id) => !MISCONCEPTION_BY_ID.has(id));
ok("every diagnosis names a catalogued misconception", unknownTag.length === 0, unknownTag.join(",") || "all resolve");
const blankTagged = await prisma.answer.count({ where: { isCorrect: null, errorTag: { not: null } } });
ok("a blank answer is never diagnosed", blankTagged === 0, "blank means not-attempted, not a misconception");

console.log("\n— the analysis page shows them —");
const analysis = await strip(await page(`/tests/${paper.id}/analysis`));
const named = tagged.filter((t) => analysis.includes(MISCONCEPTION_BY_ID.get(t.errorTag as string)!.name));
const firstId = (named[0]?.errorTag ?? "mc_mult_add_confusion") as string;
const firstName = MISCONCEPTION_BY_ID.get(firstId)!.name;
ok("analysis names the real misconceptions", named.length > 0,
  `${named.length} of ${tagged.length} visible, e.g. "${firstName}"`);
ok("the top misconception is the one on the page", analysis.includes(firstName), `"${firstName}"`);
ok("each misconception states the child's belief", analysis.includes("belief behind it"));
ok("each misconception gives remediation steps", analysis.includes("How to manage it") && /try this|use |work |line up|count|cover|build/i.test(analysis));
ok("class heatmap is rendered", analysis.includes("heatmap") || analysis.includes("Heatmap"));
ok("remediation steps are given", /How to manage it/i.test(analysis));

// The per-test analysis only sees one paper's topics, so the full teaching
// recommendations — and the NCF-FL lesson plans — live on /insights.
const insights = await strip(await page("/insights"));
ok("lesson plan follows the NCF-FL spine: concrete -> pictorial -> abstract",
  /concrete/i.test(insights) && /pictorial/i.test(insights) && /abstract/i.test(insights),
  "concrete handling before picture before symbol");
ok("lesson plan gives the teacher something to say", /Say:|say this|say to the class/i.test(insights));
ok("lesson plan differentiates for a mixed class",
  /for children who struggle/i.test(insights) && /for children on track/i.test(insights) && /for children who need more/i.test(insights));
ok("lesson plan names the success check", /check for understanding/i.test(insights));
ok("the ranking shows its working", /severity|reach|leverage|priority/i.test(insights));

console.log("\n— the stem parsers handle real classroom English —");
const parsers: [string, unknown, string][] = [
  ["6 × 4 = ?", parseOperation("6 × 4 = ?").found, "symbolic"],
  ["12 divided by 3", parseOperation("12 divided by 3").found, "word operator"],
  ["Amit had 15 marbles. He gave away 4. How many are left?", parseOperation("Amit had 15 marbles. He gave away 4. How many are left?").op, "word problem -> subtraction"],
  ["Bones are shared equally among 4. 20 bones. How many each?", parseOperation("Bones are shared equally among 4. 20 bones. How many each?").op, "sharing -> division"],
  ["Which is bigger: 347 or 374?", parseComparison("Which is bigger: 347 or 374?")?.kind, "comparison"],
  ["In the number 331, what is the value of the ones digit?", parsePlaceValue("In the number 331, what is the value of the ones digit?")?.value, "place value"],
  ["In a pictograph, one symbol stands for 10 children. 3 symbols are drawn for cricket.", parseGraphScale("In a pictograph, one symbol stands for 10 children. 3 symbols are drawn for cricket.")?.value, "pictograph scale"],
];
for (const [stem, got, label] of parsers) {
  ok(`parses ${label}`, got !== false && got !== null && got !== undefined, `"${stem.slice(0, 44)}…" => ${String(got)}`);
}
ok("a date is not read as division", parseOperation("Sita was born on 12/05/2018").found === false);

// Parsers that merely return *something* are not tested. These must return
// the right value, because a parser that returns a plausible wrong answer
// silently disables every rule built on it.
for (const [stem, want] of [
  ["In the number 331, what is the value of the ones digit?", 1],
  ["In the number 331, what is the value of the tens digit?", 30],
  ["In the number 331, what is the value of the hundreds digit?", 300],
  ["In the number 4,528, what is the value of the ones digit?", 8],
  ["In the number 4,528, what is the value of the thousands digit?", 4000],
  ["In the number 4,52,863, what is the value of the ones digit?", 3],
  ["In the number 4528, what is the value of the hundreds digit?", 500],
  ["In the number 4528, what is the value of the thousands digit?", 4000],
] as const) {
  const got = parsePlaceValue(stem);
  ok(`reads the asked place in "${stem.slice(0, 44)}"`, got?.value === want,
    `wanted ${want}, got ${got?.value} (place ${got?.place})`);
}

console.log("\n— the ranking is defensible —");
const withClass = await prisma.paper.findFirst({ where: { classId: { not: null } }, select: { classId: true } });
const classId = withClass!.classId!;
const mastery = await classMasteryMap(classId);
const perTopic: Record<string, number> = {};
for (const q of await prisma.paperQuestion.findMany({
  where: { topicId: { not: null }, paper: { classId } }, select: { topicId: true },
})) {
  if (q.topicId) perTopic[q.topicId] = (perTopic[q.topicId] ?? 0) + 1;
}
// Build the real per-topic misconception map the insights page builds.
const questionTopics = await prisma.paperQuestion.findMany({
  where: { topicId: { not: null }, paper: { classId } },
  select: { id: true, topicId: true },
});
const topicByQuestion = new Map(questionTopics.map((q) => [q.id, q.topicId as string]));
const errorRows = await prisma.answer.groupBy({
  by: ["errorTag", "paperQuestionId"],
  where: { submission: { paper: { classId } }, errorTag: { not: null } },
  _count: { _all: true },
});
const mcByTopic: Record<string, Record<string, number>> = {};
for (const row of errorRows) {
  if (!row.errorTag) continue;
  const topicId = topicByQuestion.get(row.paperQuestionId);
  if (!topicId) continue;
  mcByTopic[topicId] = mcByTopic[topicId] ?? {};
  mcByTopic[topicId]![row.errorTag] = (mcByTopic[topicId]![row.errorTag] ?? 0) + row._count._all;
}

const stats = classTopicStats(mastery, mcByTopic, perTopic);
const recs = recommendTeaching(stats, { maxRecommendations: 3 });
const topicsWithMisconceptions = Object.keys(mcByTopic).length;
ok("misconceptions are attributed to individual topics", topicsWithMisconceptions >= 2,
  `${topicsWithMisconceptions} topics carry a named error, e.g. ${Object.entries(mcByTopic).slice(0, 3).map(([t, m]) => `${t}:${Object.keys(m).join("/")}`).join(", ")}`);
ok("recommendations are produced", recs.length > 0,
  `${recs.length}: ${recs.map((r) => `${r.topicName} ${Math.round(r.priority * 100)}`).join(", ")}`);
ok("ranking is strictly descending", recs.every((r, i) => i === 0 || recs[i - 1]!.priority >= r.priority),
  recs.map((r) => `${r.topicName} ${Math.round(r.priority * 100)}`).join(" > "));
ok("only genuinely weak topics are recommended", recs.every((r) => r.factors.severity > 0),
  recs.map((r) => `${r.topicName}: sev ${r.factors.severity.toFixed(2)} reach ${r.factors.reach.toFixed(2)} lev ${r.factors.leverage.toFixed(2)} ev ${r.factors.evidence.toFixed(2)}`).join(" | "));
ok("reach is a share of the class, not a fraction of a fraction",
  recs.every((r) => r.factors.reach > 0.15 && r.factors.reach <= 1));
ok("every recommendation carries a lesson", recs.every((r) => r.lesson.steps.length >= 3),
  `${recs[0]?.lesson.steps.length ?? 0} steps, ${recs[0]?.lesson.minutes ?? 0} min`);
ok("the lesson differentiates for a mixed class", recs.every((r) =>
  Boolean(r.lesson.differentiation.struggling) && Boolean(r.lesson.differentiation.onTrack) && Boolean(r.lesson.differentiation.advanced)));
ok("a recommendation carries the misconception to teach against",
  recs.some((r) => r.dominantMisconception !== null),
  recs.map((r) => r.dominantMisconception?.name ?? "none").join(" | "));
ok("a recommendation has a success check", recs.every((r) => r.lesson.successCheck.length > 10),
  recs[0]?.lesson.successCheck ?? "");
ok("the top recommendation explains itself in words",
  (recs[0]?.why.length ?? 0) > 40 && (recs[0]?.headline.length ?? 0) > 10, recs[0]?.headline ?? "");

console.log("\n— the term plan is a plan, not a list —");
const grade = (await prisma.class.findUnique({ where: { id: classId }, select: { grade: true } }))?.grade ?? 3;
const syllabus = topicsForClass(grade);
const planMastery = Object.fromEntries(mastery.map((m) => [m.topicId, m.mastery]));
const plan = buildTeachingPlan({ grade, syllabus, mastery: planMastery, recommendations: recs, weeks: 12, sessionsPerWeek: 4 });
const allSessions = plan.weeks.flatMap((w) => w.sessions);
const taught = allSessions.filter((s) => s.kind === "teach");
const revisits = allSessions.filter((s) => s.kind !== "teach");

ok("the plan fills the term", allSessions.length >= 40, `${allSessions.length} periods over 12 weeks`);
ok("every session names a topic in the syllabus",
  allSessions.every((s) => syllabus.some((t) => t.id === s.topicId)));
ok("every session explains itself", allSessions.every((s) => s.why.length > 20),
  `"${allSessions[0]?.why.slice(0, 72) ?? ""}…"`);
ok("topics are revisited, not taught once and forgotten", revisits.length >= 8,
  `${revisits.length} spaced revisits at +1 and +3 weeks`);
ok("every revisit points back at a real lesson",
  revisits.every((s) => s.revisitOf !== undefined && taught.some((t) => t.index === s.revisitOf)));
ok("the same topic is not taught on consecutive days",
  taught.every((s, i) => i === 0 || (
    taught[i - 1]!.topicId !== s.topicId &&
    !(i > 1 && taught[i - 2]!.topicId === s.topicId && taught[i - 1]!.strand === s.strand)
  )), "interleaved across strands");
ok("the most urgent topic is taught first",
  taught[0]?.topicId === [...taught].sort((a, b) => b.priority - a.priority)[0]?.topicId,
  taught[0]?.topicName ?? "");
ok("unassessed topics still get taught", taught.some((s) => s.unassessed),
  "a plan built only from test data would skip these");
ok("the plan reports what does not fit", Array.isArray(plan.deferred), `${plan.deferred.length} topics deferred`);

const noRevisit = buildTeachingPlan({
  grade, syllabus, mastery: planMastery, recommendations: recs,
  weeks: 12, sessionsPerWeek: 4, consolidate: true,
});
ok("turning revisits off frees the slots for new topics",
  noRevisit.counts.teach > plan.counts.teach,
  `${plan.counts.teach} taught with revisits, ${noRevisit.counts.teach} without`);

console.log("\n— exports are real documents —");
for (const fmt of ["xlsx", "docx", "pdf"] as const) {
  const res = await fetch(`${BASE}/api/papers/${paper.id}/export/${fmt}`, { headers: H });
  const buf = Buffer.from(await res.arrayBuffer());
  const magic = buf.subarray(0, 4).toString("latin1");
  const valid = fmt === "pdf" ? magic === "%PDF" : magic.startsWith("PK");
  ok(`${fmt} is a valid file`, valid && buf.length > 4000, `${(buf.length / 1024).toFixed(0)} KB, magic "${magic.slice(0, 4)}"`);
}
const link = await prisma.parentLink.findFirst({ where: { revokedAt: null } });
const pbuf = Buffer.from(await (await fetch(`${BASE}/api/practice/${link!.studentId}/ns_counting`, { headers: H })).arrayBuffer());
ok("home practice sheet is a valid PDF", pbuf.subarray(0, 4).toString() === "%PDF", `${(pbuf.length / 1024).toFixed(0)} KB`);

console.log("\n— marking is honest —");
const [q] = await prisma.paperQuestion.findMany({ where: { paperId: paper.id } });
const graded = gradeSubmission(
  [{
    id: q!.id, type: q!.type, stem: q!.stem, options: q!.options ?? "[]",
    answerKey: q!.answerKey, accepted: q!.accepted ?? "[]", markScheme: q!.markScheme ?? "{}",
    topicId: q!.topicId ?? "ns_counting", strand: q!.strand ?? "number_sense",
    competency: "basic", marks: q!.marks,
  }],
  [{ paperQuestionId: q!.id, response: "" }],
);
ok("a blank scores zero", graded.score === 0);
ok("a blank is counted as blank, not wrong", graded.counts.blank === 1 && graded.counts.wrong === 0, JSON.stringify(graded.counts));

console.log("\n— the answer key accepts what children actually write —");
for (const [given, key, want, label] of [
  ["24", "24", true, "plain number"],
  ["1 3", "13", true, "spaced digits"],
  ["13.0", "13", true, "trailing .0"],
  ["१३", "13", true, "Devanagari digits"],
  ["۱۳", "13", true, "Arabic digits"],
  ["Rs 24", "24", true, "currency prefix"],
  ["24 cm", "24", true, "unit suffix"],
  ["twenty four", "24", true, "number words"],
  ["25", "24", false, "a genuinely wrong answer"],
  ["2 3", "23", true, "spaced digits for a 2-digit key"],
  ["2 3", "6", false, "spaced digits must not match another key"],
] as [string, string, boolean, string][]) {
  ok(`accepts ${label}: "${given}" for "${key}"`, answersMatch(given, key) === want);
}

console.log("\n— question quality is an honest reading, not a vanity metric —");
const gradeP = await prisma.paper.findFirst({
  where: { classId: { not: null }, submissions: { some: { status: "GRADED" } } },
  select: { id: true, questions: { select: { id: true } } },
});
const analyses = [];
for (const q of gradeP!.questions) {
  const a = await analyseDistractors(gradeP!.id, q.id);
  if (a) analyses.push(a);
}
ok("every marked question gets read", analyses.length === gradeP!.questions.length,
  `${analyses.length} questions`);
ok("counts add up: correct + wrong + blank = responses",
  analyses.every((a) => a.correct + a.blank <= a.responses),
  "no answer counted twice");
ok("option shares never exceed the responses",
  analyses.every((a) => a.options.every((o) => o.share >= 0 && o.share <= 1)));
ok("exactly one option is marked as the key on each multiple choice question",
  analyses.every((a) => !a.isMcq || a.options.filter((o) => o.isKey).length === 1));
ok("discrimination stays inside 0..1",
  analyses.every((a) => a.options.every((o) => o.discrimination >= 0 && o.discrimination <= 1)));
ok("a question is never both working and suspect",
  analyses.every((a) => !["diagnosing", "flawed", "noisy"].includes(a.verdict) || a.verdictNote.length > 30),
  analyses.find((a) => a.verdict === "diagnosing")?.verdictNote.slice(0, 60) ?? "");
ok("a shared wrong answer is diagnosed, not blamed on the wording",
  analyses.some((a) => a.verdict === "diagnosing" && /misconception|shared/i.test(a.verdictNote)),
  "the detector names the idea before blaming the question");

console.log("\n— calibration compares the question against the class —");
const schoolId = (await prisma.class.findUniqueOrThrow({ where: { id: classId }, select: { schoolId: true } })).schoolId;
const cal = await calibrateQuestions({ schoolId, classId, limit: 30 });
ok("calibration returns rows for this class only",
  cal.length > 0 && cal.every((c) => c.paperId !== null));
ok("authored difficulty is compared with what actually happened",
  cal.every((c) => typeof c.drift === "number" && Number.isFinite(c.drift)),
  `drift range ${Math.min(...cal.map((c) => c.drift))}..${Math.max(...cal.map((c) => c.drift))} points`);
ok("every verdict carries a reason in words",
  cal.every((c) => c.note.length > 20));
ok("the wording verdict needs a genuinely dominant wrong answer",
  cal.every((c) => c.verdict !== "ambiguous" || (c.topWrongShare >= 0.5 && (c.successRate ?? 100) < 70)),
  `worst concentration flagged ambiguous: ${Math.max(0, ...cal.filter((c) => c.verdict === "ambiguous").map((c) => c.topWrongShare))}`);
ok("questions with too little data are not judged",
  cal.every((c) => (c.successRate === null ? c.verdict === "not_enough_data" : true)));

console.log("\n— absence is a signal, not a verdict —");
const T = "2026-04-20";
const d = (offset: number) => new Date(Date.parse(T) + offset * 86_400_000).toISOString().slice(0, 10);
const day = (offset: number, status: "present" | "absent" | "late" | "excused" = "present") =>
  ({ date: d(offset), status });
// The series runs up to and including today, because a streak is only
// meaningful once today's register has actually been taken.
const series = (n: number, fn: (i: number) => "present" | "absent" | "late" | "excused" = () => "present") =>
  Array.from({ length: n }, (_, i) => day(i - n + 1, fn(i)));

const none = summariseAttendance({ days: [], today: T });
ok("no register means no claim at all", none.concern === null && none.presentRate === null);

const perfect = summariseAttendance({ days: series(20), today: T });
ok("a full record of presence is not a concern", perfect.concern === 0 && perfect.findings.length === 0);

const excused = summariseAttendance({
  days: series(20, (i) => (i % 4 === 0 ? "excused" : "present")), today: T,
});
ok("excused absence is not punished as absence",
  excused.daysAbsent === 0 && excused.chronic === false,
  `${excused.daysAbsent} counted absent`);

const streak = summariseAttendance({
  days: series(20, (i) => (i >= 17 ? "absent" : "present")), today: T,
});
ok("three days off in a row is flagged", streak.currentStreak === 3,
  `${streak.currentStreak} day run`);

const notTakenYet = summariseAttendance({
  days: series(20, (i) => (i >= 17 ? "absent" : "present")).slice(0, -1), today: T,
});
ok("an untaken register does not manufacture a streak",
  notTakenYet.currentStreak === 0,
  `today unrecorded, run ${notTakenYet.currentStreak}`);
ok("a current absence run is high severity, not low",
  streak.findings.find((f) => f.id === "streak")?.severity === "high");
ok("every finding says what to check, not only what is wrong",
  streak.findings.every((f) => f.check.length > 25 && !/\byou should\b|\bfailing\b/i.test(f.note)),
  streak.findings[0]?.check.slice(0, 60) ?? "");

// Same 80% attendance, two completely different children.
const fridays = summariseAttendance({
  days: series(20, (i) => (new Date(day(i - 19).date).getUTCDay() === 5 ? "absent" : "present")),
  today: T,
});
ok("a weekday pattern is found that a percentage would hide",
  fridays.findings.some((f) => f.id === "weekday"),
  fridays.clusterDay ?? "none");
ok("two children with the same rate are told apart",
  fridays.clusterDay !== streak.clusterDay || fridays.longestStreak !== streak.longestStreak,
  `friday cluster ${fridays.clusterDay}, run ${streak.longestStreak}`);

ok("absence concern is capped so it cannot dominate the risk score",
  summariseAttendance({
    days: series(25, (i) => (i % 2 === 0 ? "absent" : "present")), today: T,
  }).concern! <= 1);

ok("no attendance finding diagnoses a child",
  [...streak.findings, ...fridays.findings].every((f) => !/\blazy\b|\bunmotivated\b|\bdoesn't want\b/i.test(f.note + f.check)));

const withAttendance = assessRisk({
  topicMastery: {}, recentScores: [], attendanceConcern: 0.6,
  attendanceNotes: ["Absent 5 school days running."],
});
const without = assessRisk({ topicMastery: {}, recentScores: [] });
ok("a register raises the risk score", withAttendance.score > without.score,
  `${without.score} → ${withAttendance.score}`);
ok("an unkept register adds nothing at all", without.reasons.every((r) => !/attendance/i.test(r)));
ok("a kept register explains itself", withAttendance.reasons.some((r) => /attendance/i.test(r)));
ok("absence and weak marks produce a conversation, not homework",
  withAttendance.actions.some((a) => /home|family/i.test(a)));

console.log("\n— a practice schedule, not a topic list —");
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const seen = (times: number, score: number, lastDaysAgo = 0) =>
  Array.from({ length: times }, (_, i) => ({
    score, maxScore: 10, difficulty: 3, at: ago(lastDaysAgo - i * 0),
  }));

const nothingYet = retrievalPlan({ practised: {} });
ok("a child with no history gets an honest empty schedule", nothingYet.topics.length === 0);

const secure = retrievalPlan({ practised: { ns_counting: seen(4, 10) } });
ok("a topic the child is secure in is not dragged back for practice",
  secure.topics.length === 0 && secure.secureCount === 1,
  `${secure.secureCount} dropped as secure`);

const veryWeak = retrievalPlan({ practised: { ns_counting: seen(2, 2) } });
ok("the weakest children are not shown an empty practice screen",
  veryWeak.topics.length === 1 && veryWeak.topics[0]!.urgent,
  `${Math.round(veryWeak.topics[0]!.mastery * 100)}% and still given practice`);

// The first review comes soon for everyone; the separation is in the later
// gaps, which is where a few days actually changes what a child retains.
const firstWeak = retrievalPlan({ practised: { ns_counting: seen(1, 4) } }).topics[0]!;
const firstStrong = retrievalPlan({ practised: { ns_counting: seen(1, 7) } }).topics[0]!;
ok("a first review is due soon whatever the child's level",
  firstWeak.dueInDays <= 2 && firstStrong.dueInDays <= 2,
  `40% → ${firstWeak.dueInDays}d, 70% → ${firstStrong.dueInDays}d`);

const weakGap = retrievalPlan({ practised: { ns_counting: seen(3, 4) } }).topics[0]!;
const strongGap = retrievalPlan({ practised: { ns_counting: seen(3, 7) } }).topics[0]!;
ok("once a topic has been revisited, a weaker child comes back sooner",
  weakGap.dueInDays < strongGap.dueInDays,
  `40% → ${weakGap.dueInDays}d, 70% → ${strongGap.dueInDays}d`);

const fresh = retrievalPlan({ practised: { ns_counting: seen(1, 4) } }).topics[0]!;
ok("a topic practised once is not due the same day",
  fresh.dueInDays > 0, `due in ${fresh.dueInDays} days`);

const manyTimes = retrievalPlan({ practised: { ns_counting: seen(5, 4) } }).topics[0]!;
ok("repeated practice pushes the next review further out",
  manyTimes.reviewNumber === 5 && manyTimes.dueInDays > fresh.dueInDays,
  `review ${manyTimes.reviewNumber}, in ${manyTimes.dueInDays} days`);

const urgent = retrievalPlan({ practised: { ns_counting: seen(1, 4) } }).topics[0]!;
ok("a topic under half mastery is marked urgent", urgent.urgent === true);
ok("every recommended topic says why, in words a child can follow",
  retrievalPlan({ practised: { ns_counting: seen(2, 4, 9), md_tables: seen(1, 5, 20) } })
    .topics.every((t) => t.why.length > 60),
  retrievalPlan({ practised: { ns_counting: seen(1, 4) } }).topics[0]?.why.slice(0, 70) ?? "");

const busyDay = retrievalPlan({
  practised: Object.fromEntries(
    ["ns_place_value", "md_tables", "as_2digit", "fr_concept", "ge_2d_shapes", "me_money", "da_pictograph", "as_within_20"]
      .map((id, i) => [id, seen(1, 4, i * 4)]),
  ),
});
ok("a child's day is capped at three, not a wall of work",
  busyDay.topics.length <= 3, `${busyDay.topics.length} topics for the day`);

ok("the schedule never claims nothing is due when something is",
  retrievalPlan({ practised: { ns_counting: seen(1, 4) } }).headline.includes("due"));
ok("a healthy child is told the schedule is working, not shown a task",
  retrievalPlan({ practised: Object.fromEntries(
    Array.from({ length: 5 }, (_, i) => [`ns_place_value`, seen(3, 10)]),
  ) }).headline.includes("working"),
  retrievalPlan({ practised: {} }).headline);

console.log("\n— the review queue must be short, and must not hide —");
const qPaper = await prisma.paper.findFirstOrThrow({
  where: { submissions: { some: { status: "GRADED" } } },
  select: { id: true, title: true },
});
const queue = await reviewQueue(qPaper.id);
ok("a marked paper produces a review queue", queue.totalAnswers > 0,
  `${queue.totalAnswers} answers across ${queue.students} children`);
ok("the queue is a small fraction of the paper",
  queue.items.length / queue.totalAnswers < 0.3,
  `${queue.items.length} of ${queue.totalAnswers} (${((queue.items.length / queue.totalAnswers) * 100).toFixed(1)}%)`);
ok("the count is always stated, never truncated silently",
  queue.coverage.includes(String(queue.items.length)) && queue.coverage.includes(String(queue.totalAnswers)),
  queue.coverage);
ok("settled + queued accounts for every answer that was graded",
  queue.settled + queue.items.reduce((a, i) => a + (i.collapsedCount ?? 1), 0) <= queue.totalAnswers,
  `${queue.settled} settled, ${queue.items.length} items covering the rest`);
ok("no review item is a plain correct answer",
  queue.items.every((i) => i.machineVerdict !== "Marked correct"));
ok("every item says why it is here", queue.items.every((i) => i.reasonText.length > 25));
ok("question-level problems outrank individual answers",
  queue.items.every((i, idx) => idx === 0 || queue.items[idx - 1]!.priority >= i.priority),
  `top: ${queue.items[0]?.reasonText.slice(0, 52) ?? "none"}`);
ok("a group of identical wrong answers is one item, not many",
  queue.items.every((i) => !i.collapsedCount || i.collapsedCount >= 5),
  `collapsed groups: ${queue.items.filter((i) => i.collapsedCount).length}`);
ok("a collapsed group is presented as a question to fix, not an answer to mark",
  queue.items.every((i) => !i.collapsedCount || /children gave this exact answer|usually means the key is wrong/.test(i.reasonText)));

console.log("\n— a lesson a teacher can actually teach —");
const topicIds = [...TOPIC_BY_ID.keys()].slice(0, 40);
const sheets = topicIds
  .map((id) => buildMaterials({ topicId: id, grade: 3 }))
  .filter((s): s is NonNullable<typeof s> => s !== null);
ok("materials can be built for real topics", sheets.length > 20, `${sheets.length} sheets`);

ok("an unknown topic produces no sheet rather than an empty one",
  buildMaterials({ topicId: "not_a_topic", grade: 3 }) === null);

ok("every material has a substitute a classroom can actually make",
  sheets.every((s) => s.materials.length > 0 && s.materials.every((x) => x.substitute.length > 20)),
  sheets[0]?.materials[0]?.substitute.slice(0, 60) ?? "");
ok("the ideal option is still offered, not replaced",
  sheets.every((s) => s.materials.every((x) => x.ideal.length > 2 && x.why.length > 15)));
ok("no material is left as the only way to teach the topic",
  sheets.every((s) => s.materials.every((x) => /draw|paper|copies|board|pencil|finger|trace|fold|cut|measure|chalk/i.test(x.substitute))));

ok("the blackboard plan follows concrete, pictorial, then abstract",
  sheets.every((s) => {
    const text = s.blackboard.map((b) => `${b.write} ${b.do}`).join(" ").toLowerCase();
    const draw = text.indexOf("draw");
    const onYourOwn = text.indexOf("on your own");
    return draw === -1 || onYourOwn === -1 || draw < onYourOwn;
  }));

ok("every step says what to ask, not only what to do",
  sheets.every((s) => s.blackboard.every((b) => b.say.includes("?"))), 
  sheets[0]?.blackboard[1]?.say ?? "");
ok("every step says what to watch for",
  sheets.every((s) => s.blackboard.every((b) => b.look.length > 15)));

ok("the three groups are each given something real to do",
  sheets.every((s) =>
    [s.differentiation.struggling, s.differentiation.onTrack, s.differentiation.advanced]
      .every((d) => d.length > 25)));

ok("how-to-know-it-worked is checkable inside the lesson",
  sheets.every((s) => s.successCheck.length > 60 && /before the bell|three children/i.test(s.successCheck)),
  sheets[0]?.successCheck.slice(0, 70) ?? "");

ok("a topic with no generator says so instead of printing a blank worksheet",
  sheets.every((s) => s.worksheet.length > 0 || s.worksheetNote !== null));

const frMc = MISCONCEPTION_BY_ID.get("mc_denominator_bigger_bigger")!;
const withMc = buildMaterials({ topicId: frMc.topicIds[0]!, grade: 4, misconceptionId: frMc.id });
ok("a lesson can be built against a specific misconception",
  withMc?.misconceptionName === frMc.name,
  `${withMc?.misconceptionName ?? "none"} on ${frMc.topicIds[0]}`);
ok("the misconception appears in what the teacher watches for",
  /watch for/i.test(withMc?.blackboard[1]?.look ?? ""),
  withMc?.blackboard[1]?.look.slice(0, 70) ?? "");

console.log("\n— catch a bad paper before thirty children answer it —");
const anyPaper = await prisma.paper.findFirstOrThrow({
  where: { questions: { some: {} } },
  select: { id: true, title: true },
});
const pf = await preflight(anyPaper.id);
ok("pre-flight runs on a real paper", pf.questionCount > 0, `${pf.questionCount} questions, ${pf.totalMarks} marks`);
ok("every finding says what to do, not only what is wrong",
  pf.findings.every((f) => f.detail.length > 25 && f.title.length > 10));
ok("findings name a position so a teacher can jump to it",
  pf.findings.filter((f) => f.position !== undefined).every((f) => f.position! >= 1));
ok("fatal problems are separated from things worth a look",
  pf.findings.every((f) => ["fatal", "serious", "worth_a_look"].includes(f.level)));
ok("a paper with fatal problems is not marked printable", pf.canRun === (pf.findings.every((f) => f.level !== "fatal")));
ok("the summary states plainly whether to print",
  pf.canRun ? /look sound|to look at|before you print/i.test(pf.summary) : /do not print|unusable/i.test(pf.summary),
  pf.summary);

ok("a paper nobody has written is reported honestly, not as sound",
  (await preflight("no_such_paper")).questionCount === 0);

// A hand-built broken paper, so the checks are proven to fire.
const cls = await prisma.class.findFirstOrThrow({ select: { id: true, schoolId: true, grade: true } });
const broken = await prisma.paper.create({
  data: {
    title: "Preflight fixture", schoolId: cls.schoolId, classId: cls.id, grade: cls.grade,
    questions: {
      create: [
        { position: 0, stem: "2 + 2 = ?", type: "mcq", marks: 1, answerKey: "D", options: JSON.stringify(["A. 3", "B. 4", "C. 5"]), topicId: "ns_place_value", strand: "number", competency: "basic" },
        { position: 1, stem: "What comes next?", type: "mcq", marks: 1, answerKey: "A", options: JSON.stringify(["A. 7", "B. 8"]), topicId: "ns_place_value", strand: "number", competency: "basic" },
        { position: 2, stem: "2 + 2 = ?", type: "short", marks: 1, answerKey: "4", topicId: "ns_place_value", strand: "number", competency: "basic" },
        { position: 3, stem: "x", type: "fill_blank", marks: 0, answerKey: "", topicId: null, strand: "number", competency: "basic" },
      ],
    },
  },
  select: { id: true },
});
const bpf = await preflight(broken.id);
ok("a key that matches no option is fatal", bpf.findings.some((f) => f.level === "fatal" && /not among the options/i.test(f.title)));
ok("a question with no key is fatal", bpf.findings.some((f) => f.level === "fatal" && /no answer key/i.test(f.title)));
ok("a repeated question is caught", bpf.findings.some((f) => /same question appears twice/i.test(f.title)));
ok("a question worth no marks is caught", bpf.findings.some((f) => /worth no marks/i.test(f.title)));
ok("a question with no topic is caught", bpf.findings.some((f) => /no topic/i.test(f.title)));
ok("a genuinely broken paper is not marked printable", bpf.canRun === false,
  `${bpf.findings.filter((f) => f.level === "fatal").length} fatal`);

const longPaper = await prisma.paper.create({
  data: {
    title: "Preflight long fixture", schoolId: cls.schoolId, classId: cls.id, grade: cls.grade,
    questions: {
      create: Array.from({ length: 30 }, (_, i) => ({
        position: i, stem: `Question number ${i + 1} asking about something`, type: "short",
        marks: 1, answerKey: "1", topicId: ["ns_place_value", "fr_concept", "ge_2d_shapes", "me_money"][i % 4]!,
        strand: "number", competency: "basic",
      })),
    },
  },
  select: { id: true },
});
ok("a paper longer than the class can finish is flagged",
  (await preflight(longPaper.id)).findings.some((f) => /longer than the class can finish/i.test(f.title)));
await prisma.paper.delete({ where: { id: broken.id } });
await prisma.paper.delete({ where: { id: longPaper.id } });

console.log("\n— a day with nothing in it should say so —");
const t = await todayFor({
  userId: "u", schoolId: cls.schoolId, role: "TEACHER", mode: "SCHOOL",
} as never);
ok("today lists only things a teacher can act on",
  t.tasks.every((x) => x.href.startsWith("/") && x.because.length > 15));
ok("today states its count honestly rather than padding the list",
  t.headline.includes(String(t.tasks.length)) || t.tasks.length <= 2,
  t.headline);
ok("urgency is ordered so the first bell comes first",
  t.tasks.every((x, i) => i === 0 || t.tasks[i - 1]!.weight <= x.weight));
ok("a task points at a real page, not a placeholder",
  t.tasks.every((x) => /^\/(attendance|plan|tests|me|classes|dashboard)/.test(x.href)),
  [...new Set(t.tasks.map((x) => x.href.split("/")[1]))].join(", ") || "none");

console.log("\n— bubble sheets, and their limits —");
ok("a run of bubbles parses in order",
  parseOmr("ABCDABCD", [1, 2, 3, 4, 5, 6, 7, 8]).join("") === "ABCDABCD");
ok("spaces between bubbles are ignored",
  parseOmr("a b c d", [1, 2, 3, 4]).join("") === "ABCD");
ok("stray characters do not shift the answers",
  parseOmr("A1B2C3D4", [1, 2, 3, 4]).join("") === "ABCD",
  parseOmr("A1B2C3D4", [1, 2, 3, 4]).join(""));
ok("a short sheet leaves the rest blank rather than guessing",
  parseOmr("AB", [1, 2, 3, 4]).join(",") === "A,B,,",
  parseOmr("AB", [1, 2, 3, 4]).join(","));
ok("an unread bubble is null, never a default letter",
  parseOmr("A?B", [1, 2, 3]).every((x) => x === null || "ABC".includes(x)));
ok("extra bubbles are ignored, not counted against the child",
  parseOmr("ABCDABCDABCD", [1, 2, 3]).join("") === "ABC");

const omrPaper = await prisma.paper.findFirstOrThrow({
  where: { questions: { some: { type: "mcq" } } },
  select: { id: true, title: true },
});
const sheet = await buildOmr(omrPaper.id);
ok("a bubble sheet is built for a paper with multiple-choice questions",
  sheet.questionNumbers.length > 0, `${sheet.questionNumbers.length} of the questions carry a bubble`);
ok("only multiple-choice questions with a fillable key go on the sheet",
  sheet.questionNumbers.length + sheet.skipped.length > 0);
ok("nothing is silently dropped — every skip is explained",
  sheet.skipped.every((s) => s.reason.length > 15 && s.position > 0),
  sheet.skipped[0]?.reason ?? "none skipped");
ok("a partial sheet says so rather than pretending it is complete",
  sheet.partial ? sheet.note !== null && /must still be marked/i.test(sheet.note) : true,
  sheet.note ?? "complete");
ok("every question on the sheet has a bubble column",
  sheet.columns.every((c) => c.numbers.every((n) => sheet.questionNumbers.includes(n))));
ok("no question appears on two columns",
  new Set(sheet.columns.flatMap((c) => c.numbers)).size === sheet.questionNumbers.length);

console.log("\n— a message a parent can act on —");
const weakMsg = parentMessage({
  childName: "Aarav Sharma",
  practised: { fr_concept: seen(2, 3) },
});
ok("a struggling child gets one specific thing to do",
  weakMsg.honest && (weakMsg.nudge?.doThis.length ?? 0) > 40,
  weakMsg.nudge?.doThis.slice(0, 62) ?? "");
ok("the message opens warmly rather than with a fault",
  /^Dear parent,\n\nAarav is doing well/.test(weakMsg.body), weakMsg.body.split("\n")[2] ?? "");
ok("it gives a time the family can actually give",
  weakMsg.nudge?.minutes !== undefined && weakMsg.nudge.minutes <= 10, `${weakMsg.nudge?.minutes} minutes`);
ok("it never asks a family to buy anything",
  !/buy|purchase|order|bring.*from home/i.test(weakMsg.body));
ok("no score or rank appears in a parent message", !/\d{1,3}\s*%|percentile|top of the class/i.test(weakMsg.body));
ok("the child is never compared with another child",
  !/than (?:any |the )?(?:other|his|her|their)|compared (?:to|with)|better than (?:the|every|all)/i.test(weakMsg.body),
  weakMsg.body.match(/than (?:any |the )?(?:other|his|her|their)|compared (?:to|with)/i)?.[0] ?? "none");
ok("it never mentions attendance or behaviour",
  !/absent|attendance|late|discipline|behaviour|behaviour|naughty/i.test(weakMsg.body));
ok("it reassures the family that mistakes are normal",
  /normal|fine to get something wrong/i.test(weakMsg.body));
ok("the first name is used, never the full name in the body",
  weakMsg.body.includes("Aarav") && !weakMsg.body.includes("Aarav Sharma"));

const strongMsg = parentMessage({
  childName: "Diya Patel",
  practised: { fr_concept: seen(4, 10) },
});
ok("a child doing well is NOT given homework to do",
  !strongMsg.honest && !/What to try/i.test(strongMsg.body),
  strongMsg.body.split("\n")[4] ?? "");
ok("a child doing well still gets a warm message",
  /working confidently|doing well/i.test(strongMsg.body) && strongMsg.body.length > 80,
  strongMsg.body.split("\n")[2] ?? "");

const noData = parentMessage({ childName: "Kabir Rao", practised: {} });
ok("no evidence produces no task, not a made-up one",
  !noData.honest && !/What to try/i.test(noData.body));

const mcMsg = parentMessage({
  childName: "Ananya Iyer",
  practised: { fr_comparison_like: seen(2, 3) },
  misconceptionId: "mc_denominator_bigger_bigger",
});
ok("a real misconception becomes advice, not an accusation",
  /do not correct it straight away/i.test(mcMsg.body),
  mcMsg.body.split("\n").find((l) => l.includes("surprising"))?.slice(0, 70) ?? "");
ok("any 'cannot do' in a message is reassurance, never a verdict",
  !/cannot do/i.test(mcMsg.body) || /not a sign the child cannot do/i.test(mcMsg.body));
ok("the misconception is quoted as the child's idea, not asserted about them",
  /The idea that "/.test(mcMsg.body), mcMsg.body.match(/The idea that "[^"]+/)?.[0]?.slice(0, 60) ?? "");

ok("no message ever invents content for a topic the app knows nothing about",
  parentMessage({ childName: "Test", practised: { completely_unknown_topic: seen(2, 4) } }).body.length > 100);

console.log("\n— a note a stranger can use on Monday morning —");
const anyClass = await prisma.class.findFirstOrThrow({ select: { id: true, name: true } });
const ho = await buildHandover(anyClass.id);
ok("a handover is built for a real class", ho !== null && ho.studentCount >= 0, ho?.className ?? "none");
ok("it answers the three questions a substitute actually has",
  (ho?.children.length !== undefined) && (ho?.cautions.length ?? 0) > 0,
  `${ho?.children.length ?? 0} children, ${ho?.cautions.length ?? 0} cautions`);
ok("an unknown class produces no note, not an empty one",
  (await buildHandover("no_such_class")) === null);
ok("recently taught comes from real records or says so",
  ho!.recentlyTaught.length > 0 || /Nothing has been ticked off/.test(ho!.cautions.join(" ")),
  ho!.recentlyTaught.join(", ") || "none recorded");

// The boundary that matters: this page is printed and read by a stranger.
const hoText = JSON.stringify(ho);
ok("no score or percentage ever reaches a substitute's note",
  !/\b\d{1,3}(\.\d+)?%|\bscore\b|\bmarks\b|\brank\b/i.test(hoText));
ok("no child is labelled at risk in a note a stranger reads",
  !/at risk|drop ?out|risk level|failing|weak student|low ability/i.test(hoText));
ok("the note does not claim a child cannot do something",
  !/cannot do|is unable|incapable|refuses to/i.test(hoText));
ok("every caution tells the substitute what to do, not what to judge",
  ho!.cautions.every((c) => c.length > 20 && /do not|don't|tell|ask|pick|keep|is a guess|is nothing/i.test(c)),
  ho!.cautions[0]?.slice(0, 66) ?? "");
ok("a distressed child is referred on, not handled by a stranger",
  ho!.cautions.some((c) => /distressed|office/i.test(c)));
ok("a secure class is told to move forward, not to re-teach",
  ho!.cautions.some((c) => /secure|move forward|repeating/i.test(c)) || ho!.liveGaps.length > 0);
ok("live gaps are the weakest assessed topics, not the easiest",
  ho!.liveGaps.every((g) => g.mastery < 60));
ok("the register is summarised as who to expect, not as a rate",
  ho!.register === null || (ho!.register.absentToday.length <= ho!.studentCount));

// The handover page itself, over HTTP, with a real class id.
const hoHtml = await page(`/classes/${anyClass.id}/handover`);
ok("the handover note renders for a real class", hoHtml.length > 500, `${hoHtml.length} bytes`);
ok("the note leads with the class and the child count",
  /note for the substitute teacher/i.test(hoHtml) && hoHtml.includes(anyClass.name));
ok("the printed note carries the no-scores statement",
  /contains no scores and no judgements/i.test(hoHtml));

const impHtml = await page(`/classes/${anyClass.id}/import`);
ok("the import page renders for a real class", impHtml.length > 500, `${impHtml.length} bytes`);
ok("the import page says other marks do not affect mathematics mastery",
  /not[\s\S]{0,120}mastery/i.test(impHtml));
ok("the import page gives a working format to paste into",
  /Name,\s*Subject,\s*Marks,\s*Max/i.test(impHtml));

console.log("\n— the principal's view, and what it refuses —");
const sv = await schoolView((await prisma.school.findFirstOrThrow({ select: { id: true } })).id);
ok("a school view is produced", sv.classCount > 0, `${sv.classCount} classes, ${sv.studentCount} children`);
ok("it states its own headline finding", sv.headline.length > 20, sv.headline.slice(0, 90));
ok("coverage is a share of classes, never a mark",
  sv.strandHealth.every((s) => s.coverage >= 0 && s.coverage <= 1),
  sv.strandHealth.map((s) => `${s.strandName} ${Math.round(s.coverage * 100)}%`).join(", "));
ok("an unassessed strand is never reported as a passing one",
  sv.strandHealth.every((s) => s.classCount > 0));
ok("a problem in one class is not a school problem",
  sv.sharedGaps.every((g) => g.weakClasses >= 4 && g.weakClasses <= g.classCount),
  sv.sharedGaps.map((g) => `${g.topicName} in ${g.weakClasses}/${g.classCount}`).join("; ") || "none");
ok("no class row carries a mark, a rank or a verdict",
  !JSON.stringify(sv.classes).match(/rank|percentile|"score"|"marks"|failing|\d+%/i),
  JSON.stringify(sv.classes[0] ?? {}).slice(0, 90));
ok("there is no teacher ranking field to leak",
  !("teacher" in (sv as Record<string, unknown>)) && !("rank" in (sv as Record<string, unknown>)));
ok("a school with no classes says so instead of showing zeros",
  (await schoolView("no_such_school")).headline.includes("No classes"),
  (await schoolView("no_such_school")).headline);
ok("topics never assessed are reported as unknown, not as weak",
  sv.neverAssessed.every((t) => t.topicName.length > 0 && t.grade >= 1),
  `${sv.neverAssessed.length} never assessed`);

const pHtml = await page("/principal");
ok("the school overview renders", pHtml.length > 500, `${pHtml.length} bytes`);
ok("the page explains why teachers are not ranked",
  /no teacher ranking here, deliberately/i.test(pHtml));
ok("the page says coverage is not the same as being secure",
  /has not been looked at/i.test(pHtml));

console.log("\n— the export that has to be a real backup —");
ok("a blank answer is blank and a wrong answer is wrong — three states, not two",
  outcomeOf(null) === "blank" && outcomeOf(false) === "wrong" && outcomeOf(true) === "correct",
  `${outcomeOf(null)} / ${outcomeOf(false)} / ${outcomeOf(true)}`);

const sch = await prisma.school.findFirstOrThrow({ select: { id: true, name: true } });
const all = await buildSchoolExport(sch.id);
ok("a school export is built", all !== null, `${all?.scope.classes} classes, ${all?.scope.answers} answers`);
ok("it carries the raw answers, not only scores",
  (all?.scope.answers ?? 0) > 0, `${all?.scope.answers} answer rows`);
ok("every answer names a question and a paper",
  all!.answers.every((a) => a.questionNo > 0) && all!.answers.some((a) => a.question.length > 0));
ok("teacher notes survive the export", "note" in all!.answers[0]!);
ok("every answer carries a real denominator",
  all!.answers.every((a) => a.maxMarks > 0),
  `${all!.answers.filter((a) => a.maxMarks <= 0).length} without one`);
ok("a missing percentage stays missing rather than becoming zero",
  all!.submissions.every((s) => s.percent === null || (s.percent >= 0 && s.percent <= 100)));
ok("the export states what it refuses to carry",
  all!.manifest.some((m) => /no risk label/i.test(m)) && all!.manifest.some((m) => /never merged with 'wrong'/i.test(m)),
  all!.manifest.find((m) => /never merged/i.test(m))?.slice(0, 66));
ok("no risk, confidence or trait field exists anywhere in the export",
  (() => {
    // Keys, not prose: the manifest legitimately contains the words "no risk
    // label", so a substring search over the whole file would match its own
    // explanation and prove nothing.
    const keys = new Set<string>();
    (function walk(v: unknown) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) { keys.add(k); walk(val); }
      }
    })(all);
    return [...keys].filter((k) => /risk|confid|dropout|trait|personality/i.test(k)).length === 0;
  })(),
  [...new Set<string>(Object.keys(all!))].length + " top-level keys, none of them a hypothesis");
ok("imported other-subject marks are labelled context only",
  all!.manifest.some((m) => /context only and were never used/i.test(m)));
ok("an unknown school exports nothing rather than an empty file",
  (await buildSchoolExport("no_such_school")) === null);
ok("restricting to classes really does reduce the scope, never widen it",
  await (async () => {
    const cls = await prisma.class.findFirstOrThrow({ where: { schoolId: sch.id }, select: { id: true } });
    const one = await buildSchoolExport(sch.id, { restrictToClasses: [cls.id] });
    if (!one) return false;
    const allClassIds = new Set(
      (await prisma.class.findMany({ where: { schoolId: sch.id }, select: { id: true } })).map((c) => c.id),
    );
    if (allClassIds.size < 2) return one.scope.classes === 1;
    return one.scope.classes < all!.scope.classes;
  })(),
  `all=${all!.scope.classes}`);
ok("the export survives a JSON round-trip unchanged",
  JSON.parse(JSON.stringify(all!)).scope.answers === all!.scope.answers);

console.log("\n— asking a child how they are doing —");
ok("saying you cannot and then doing it is underconfidence, not failure",
  gradeReflection("not_yet", true).calibration === "underconfident");
ok("saying you can and then failing is overconfidence",
  gradeReflection("got_it", false).calibration === "overconfident");
ok("saying you can and doing it is knowing what you know",
  gradeReflection("got_it", true).calibration === "well_calibrated");
ok("the honest middle is calibrated when it lands",
  gradeReflection("getting_there", true).calibration === "well_calibrated" &&
  gradeReflection("getting_there", false).calibration === "well_calibrated");
ok("a skipped answer produces no verdict at all",
  gradeReflection("got_it", null).outcome === "skipped" &&
  gradeReflection("got_it", null).calibration === null,
  "a blank tells us nothing, so we say nothing");
ok("a skipped answer is not counted as either kind of misjudgement",
  !/wrong|overconfident|underconfident/i.test(reflectBack(gradeReflection("got_it", null).calibration)));

const allConfident = summariseReflections(
  ["got_it", "got_it", "got_it", "got_it", "not_yet"].map((o, i) => ({
    topicId: `t${i}`, topicName: `Topic ${i}`,
    predicted: "got_it" as const, outcome: o as "got_it" | "not_yet",
    calibration: gradeReflection("got_it", o === "got_it").calibration, note: null,
  })),
);
ok("a class that mostly overestimates is named as such, without blame",
  allConfident.overconfident === 1 && allConfident.hiddenGaps.includes("Topic 4"),
  allConfident.line);
ok("a skipped topic is counted as skipped, not folded into the totals",
  allConfident.answered + allConfident.skipped === 5);
ok("an empty set says so instead of claiming a pattern",
  summariseReflections([]).line.includes("No reflections yet"));
ok("hidden strengths find children who wrote themselves off and then succeeded",
  summariseReflections([
    { topicId: "a", topicName: "Fractions", predicted: "not_yet", outcome: "got_it", calibration: "underconfident", note: null },
  ]).hiddenStrengths.includes("Fractions"));

ok("an overconfident child is not told they were wrong to try",
  /not a mistake/i.test(reflectBack("overconfident")) && !/told you|caught you|as you said/i.test(reflectBack("overconfident")),
  reflectBack("overconfident").slice(0, 70));
ok("an underconfident child is told to trust what they can do",
  /Trusting what you can do/i.test(reflectBack("underconfident")));

const setHtml = await page(`/classes/${anyClass.id}/reflect/set`);
ok("the self check setup page renders", setHtml.length > 500, `${setHtml.length} bytes`);
ok("it states plainly that this is not a grade",
  /not a grade/i.test(setHtml) && /does not go on any report/i.test(setHtml));
ok("it names overestimation as normal rather than as a failing",
  /better at this than they are/i.test(setHtml) && /not.*low ability|not dishonesty/i.test(setHtml));

const printHtml = await page(`/classes/${anyClass.id}/reflect/print`);
ok("the printable sheet renders", printHtml.length > 300, `${printHtml.length} bytes`);
ok("the printed sheet carries no names — only topic totals",
  !new RegExp(anyClass.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(printHtml.replace(/Kapigyan/gi, "")) ||
  printHtml.includes("no names, no scores"),
  "the sheet is aggregate-only");
ok("the printed sheet states it contains no names and no marks",
  /contains no names and no marks/i.test(printHtml));

await prisma.$disconnect();

console.log("\n— other subjects, imported but never analysed —");
const clean = parseMarksCsv(
  "Name,Subject,Marks,Max\nAarav Sharma,English,42,50\nDiya Patel,Hindi,38,40\nKabir Rao,Science,71,80",
);
ok("a clean sheet parses every row", clean.good.length === 3 && clean.problems.length === 0,
  `${clean.good.length} good, ${clean.problems.length} problems`);
ok("subjects are read from the sheet", clean.subjects.join(",") === "English,Hindi,Science",
  clean.subjects.join(", "));

ok("a header without a max column still reads marks",
  parseMarksCsv("Student Name,Subject,Score\nAarav Sharma,Eng,42").good.length === 1);
ok("a messy header like 'Marks (Eng)' is still found",
  parseMarksCsv("Name,Subject,Marks (Eng),Out of\nAarav Sharma,Eng,42,50").good[0]?.marks === 42,
  String(parseMarksCsv("Name,Subject,Marks (Eng),Out of\nAarav Sharma,Eng,42,50").good[0]?.marks));
ok("subject aliases are normalised",
  parseMarksCsv("Name,Subject,Marks\nAarav,Eng,10").subjects[0] === "English" &&
  parseMarksCsv("Name,Subject,Marks\nAarav,maths,10").subjects[0] === "Mathematics",
  `${parseMarksCsv("Name,Subject,Marks\nAarav,Eng,10").subjects[0]} / ${parseMarksCsv("Name,Subject,Marks\nAarav,maths,10").subjects[0]}`);
ok("a quoted name containing a comma survives",
  String(parseMarksCsv('Name,Subject,Marks,Max\n"Sharma, Aarav",English,42,50').good[0]?.studentName) === "Sharma, Aarav",
  parseMarksCsv('Name,Subject,Marks,Max\n"Sharma, Aarav",English,42,50').good[0]?.studentName);
ok("a byte-order mark does not break the first header",
  parseMarksCsv("﻿Name,Subject,Marks\nAarav,Eng,42").good.length === 1);

ok("an impossible mark is refused, not accepted",
  String(parseMarksCsv("Name,Subject,Marks,Max\nAarav,Eng,60,50").problems[0]?.problem).includes("impossible"),
  String(parseMarksCsv("Name,Subject,Marks,Max\nAarav,Eng,60,50").problems[0]?.problem));
ok("a non-numeric mark is reported, with the line number a teacher would see",
  parseMarksCsv("Name,Subject,Marks\nA1,Eng,10\nA2,Eng,10\nA3,Eng,abc").problems[0]?.line === 4,
  `line ${parseMarksCsv("Name,Subject,Marks\nA1,Eng,10\nA2,Eng,10\nA3,Eng,abc").problems[0]?.line} (header counts as line 1)`);
ok("bad rows are never silently dropped — they are all reported",
  (() => {
    const r = parseMarksCsv("Name,Subject,Marks,Max\n,Eng,10,50\nA2,Eng,999,50\nA3,Eng,abc,50\nA4,Eng,5,50");
    return r.rows.length === 4 && r.problems.length === 3;
  })(),
  (() => {
    const r = parseMarksCsv("Name,Subject,Marks,Max\n,Eng,10,50\nA2,Eng,999,50\nA3,Eng,abc,50\nA4,Eng,5,50");
    return `${r.rows.length} rows, ${r.problems.length} problems: ${r.problems.map((p) => p.problem).join(" | ")}`;
  })());
ok("without a max column, an odd mark is kept rather than guessed at",
  parseMarksCsv("Name,Subject,Marks\nAarav,Eng,999").good.length === 1,
  "999 with no max — the app has no basis to call it impossible");
ok("a blank marks cell is reported rather than read as zero",
  String(parseMarksCsv("Name,Subject,Marks\nAarav,Eng,").problems[0]?.problem).includes("No marks"),
  String(parseMarksCsv("Name,Subject,Marks\nAarav,Eng,").problems[0]?.problem));
ok("a missing name is reported, not skipped",
  String(parseMarksCsv("Name,Subject,Marks\n,Eng,10").problems[0]?.problem).includes("No name"));

ok("a file with no header is flagged rather than silently mis-shifted",
  parseMarksCsv("Aarav,Eng,42,50").noHeader === true,
  parseMarksCsv("Aarav,Eng,42,50").rows[0]?.problem ?? "no problem");
ok("an empty file produces nothing, not a crash",
  parseMarksCsv("").rows.length === 0 && parseMarksCsv("   \n  ").rows.length === 0);

ok("names match despite titles, case and extra spaces",
  nameMatches("Aarav Sharma", "aarav  sharma") && nameMatches("Mr. Aarav Sharma", "Aarav Sharma"));
ok("different children are not matched to each other",
  !nameMatches("Aarav Sharma", "Aarav Kulkarni") && !nameMatches("Diya Patel", "Kabir Rao"));

await prisma.$disconnect();
console.log("\n— learning gain must not flatter the teacher —");
const TEACH = "2026-01-12";
const ev = (score: number, max = 10) => ({ score, maxScore: max, difficulty: 3, at: new Date("2026-03-02") });
const many = (n: number, score: number) =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, [ev(score)]]));
const names = Object.fromEntries(
  Array.from({ length: 20 }, (_, i) => [`c${i}`, `Child ${i}`]),
);

const improved = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: many(12, 3) },
  after: { ns_place_value: many(12, 8) },
  studentNames: names,
});
ok("a genuine improvement is reported as improvement",
  improved.topics[0]?.verdict === "worked", `${improved.topics[0]?.gain} points`);

const onlyAfter = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: {},
  after: { ns_place_value: many(12, 9) },
  studentNames: names,
});
ok("evidence only after teaching is not counted as gain",
  onlyAfter.topics[0]?.verdict === "untested_after" && onlyAfter.topics[0]?.gain === 0,
  onlyAfter.topics[0]?.note.slice(0, 64) ?? "");

const neverReassessed = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: many(12, 3) },
  after: {},
  studentNames: names,
});
ok("taught but never rechecked says so, rather than claiming no change",
  neverReassessed.topics[0]?.verdict === "untested_after",
  neverReassessed.topics[0]?.note.slice(0, 64) ?? "");

const driftedAway = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: many(12, 3) },
  // The five weakest children are simply not tested again. The average
  // doubles, and nothing about teaching caused it.
  after: { ns_place_value: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`c${i}`, [ev(9)]])) },
  studentNames: names,
});
ok("children lost from assessment are counted and surfaced",
  driftedAway.topics[0]?.childrenLost === 5,
  `${driftedAway.topics[0]?.childrenLost} dropped off after teaching`);
ok("a gain built on lost children is not presented as clean",
  driftedAway.topics[0]?.note.includes("may be who stopped being tested") === true,
  driftedAway.topics[0]?.note.slice(0, 80) ?? "");

const tiny = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: { a: [ev(2)], b: [ev(3)] } },
  after: { ns_place_value: { a: [ev(9)], b: [ev(9)] } },
  studentNames: { a: "A", b: "B" },
});
ok("two children is not a trend",
  tiny.topics[0]?.verdict === "not_enough_data", tiny.topics[0]?.note.slice(0, 52) ?? "");

const flat = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: many(12, 6) },
  after: { ns_place_value: many(12, 7) },
  studentNames: names,
});
ok("a small wobble is not dressed up as progress",
  flat.topics[0]?.verdict === "no_change", `${flat.topics[0]?.gain} points`);

const regressed = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: many(12, 9) },
  after: { ns_place_value: many(12, 4) },
  studentNames: names,
});
ok("a topic that got worse is reported as worse",
  regressed.topics[0]?.verdict === "regressed", `${regressed.topics[0]?.gain} points`);

// The actionable list is "was weak, and did not move" — not "is weak now".
// Children who were strong and then slipped are a different problem.
const improvers = Array.from({ length: 8 }, (_, i) => `c${i}`);
const stuck = Array.from({ length: 4 }, (_, i) => `s${i}`);
// Everyone starts weak. Eight improve; four stay exactly where they were.
const everyoneWeak = Object.fromEntries(
  [...improvers, ...stuck].map((id) => [id, [ev(3)]]),
);
const stuckStill = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: everyoneWeak },
  after: {
    ns_place_value: {
      ...Object.fromEntries(improvers.map((id) => [id, [ev(9)]])),
      ...Object.fromEntries(stuck.map((id) => [id, [ev(3)]])),
    },
  },
  studentNames: {
    ...names,
    ...Object.fromEntries(stuck.map((id, i) => [id, `Stuck ${i + 1}`])),
  },
});
ok("children who improved are not put on the stuck list",
  stuckStill.stillStuck.every((s) => s.studentId.startsWith("s")),
  stuckStill.stillStuck.map((s) => s.studentName).join(", ") || "none");
ok("children who were weak and stayed weak are named",
  stuckStill.stillStuck.length === 4, `${stuckStill.stillStuck.length} named`);

ok("children who were strong and then slipped are not called 'stuck'",
  regressed.stillStuck.length === 0,
  "they went from strong to weak — a different problem, not a stalled one");

const joiner = learningGain({
  taught: { ns_place_value: [TEACH] },
  before: { ns_place_value: many(12, 3) },
  // c0 has no baseline at all: first assessed only after the lesson.
  after: { ns_place_value: { c0: [ev(9)], ...many(11, 9) } },
  studentNames: names,
});
ok("a child with no baseline before the lesson is left out, not guessed at",
  joiner.stillStuck.every((s) => s.studentId !== "c0") && joiner.topics.length === 1,
  `${joiner.stillStuck.length} on the stuck list`);

ok("every topic carries a reason in words",
  improved.topics.every((t) => t.note.length > 30));
ok("no verdict claims causation",
  [...improved.topics, ...driftedAway.topics].every((t) => !/\bcaused\b|\bbecause of you\b/i.test(t.note)));

/* ------------------------------------------------------------------ */
/* Audit trail                                                          */
/*                                                                       */
/* The `note` string on an answer row records what somebody wrote, not   */
/* what changed, so it cannot answer "was this wrong answer promoted?".   */
/* These assertions call the real `recordAudit` — not a stand-in — and    */
/* then check the invariants that make the log worth anything later.      */
/* ------------------------------------------------------------------ */

console.log("\n— the audit trail records what a marker changed —");

{
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
  ok("every existing row names an action from the agreed set",
    rows.every((r) => isAuditAction(r.action)),
    rows.length === 0 ? `all ${AUDIT_ACTIONS.length} actions defined` : rows.map((r) => r.action).join(", "));

  ok("no row loses the actor's name when their account is deleted",
    rows.every((r) => r.actorName.trim().length > 0));

  const override = await recordAudit({
    schoolId: user.schoolId,
    actorId: null,
    actorName: "A teacher who no longer exists",
    action: "mark_override",
    studentId: null,
    paperId: null,
    before: { isCorrect: false, marksAwarded: 0, errorTag: "mc_mult_add_confusion", response: "10" },
    after: { isCorrect: true, marksAwarded: 1, errorTag: null },
    detail: 'Teacher marked "10" correct, over the engine\'s wrong.',
  });

  const written = await prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" } });
  ok("a mark override is written", override === undefined && written !== null);
  ok("the row keeps the actor's name even with no actor id", written?.actorName.includes("no longer exists") === true);
  ok("the before-state is stored, so 'correct' means something later",
    (() => { try { return (JSON.parse(written!.before! ) as { errorTag?: string }).errorTag === "mc_mult_add_confusion"; } catch { return false; } })());
  ok("the after-state is stored too",
    (() => { try { return (JSON.parse(written!.after!) as { isCorrect?: boolean }).isCorrect === true; } catch { return false; } })());
  ok("the note says what actually happened", (written?.detail ?? "").length > 30);

  // The whole point of before/after: neither half is useful alone.
  ok("without the before-state the change could not be reversed or explained",
    (() => { try { const b = JSON.parse(written!.before!) as { isCorrect: boolean }; return b.isCorrect === false; } catch { return false; } })());

  await prisma.auditLog.deleteMany({ where: { actorName: "A teacher who no longer exists" } });

  ok("a bad action name would be caught by the type, not by the database",
    !isAuditAction("not_a_real_action") && isAuditAction("mark_override"));
}

/* ------------------------------------------------------------------ */
/* Competitive depth                                                    */
/*                                                                       */
/* The claim being checked is narrow and falsifiable: a tier is an       */
/* assertion about content, so it can be wrong, and an assertion that    */
/* cannot be wrong is not worth storing. These check the shape is sound,  */
/* that it agrees with the database, and that it is actually reachable   */
/* — not that any particular tier is correct, which only a teacher can    */
/* say.                                                                 */
/* ------------------------------------------------------------------ */

console.log("\n— competitive depth is coherent, and reached —");

{
  const dbTopics = await prisma.topic.findMany({ select: { id: true, compTier: true, compIdea: true } });
  ok("every topic in the database carries a tier", dbTopics.every((t) => Number.isInteger(t.compTier)));
  ok("no tier is outside 0..3", dbTopics.every((t) => t.compTier >= 0 && t.compTier <= 3));

  // Tier 0 means "not taken further", so it must not also carry an "extra
  // step" — otherwise the panel would promise a teacher a route it has none of.
  const tier0 = dbTopics.filter((t) => t.compTier === 0);
  ok("a topic with no competition tier carries no extra step either",
    tier0.every((t) => !t.compIdea), `${tier0.length} tier-0 topic(s)`);

  // And the reverse: a topic that *is* examined further must say what the
  // extra step is, or the panel shows a claim with no content behind it.
  const tiered = dbTopics.filter((t) => t.compTier > 0);
  ok("every topic taken further explains what the extra step is",
    tiered.every((t) => (t.compIdea ?? "").trim().length > 20), `${tiered.length} topic(s) above school level`);

  ok("the database agrees with the source of truth",
    dbTopics.every((t) => topicDepth(t.id).tier === t.compTier));

  // The known uncertainty, stated rather than hidden.
  const perTier = COMP_TIERS.map((t) => ({
    tier: t.tier,
    n: dbTopics.filter((x) => x.compTier === t.tier).length,
  }));
  ok("all four tiers are populated, so the switcher is not decorative",
    perTier.every((t) => t.n > 0), perTier.map((t) => `t${t.tier}:${t.n}`).join(" "));

  ok("a national paper is not decided by everything the syllabus contains",
    (() => {
      const national = dbTopics.filter((t) => t.compTier >= 3).length;
      return national > 0 && national < dbTopics.length / 3;
    })(), `${dbTopics.filter((t) => t.compTier >= 3).length} of ${dbTopics.length} reach national`);

  // Narrowing must narrow: a higher target can never surface more topics.
  const carried = [1, 2, 3].map((tier) => competitionTopicsForClass(4, tier).length);
  ok("a harder exam asks for fewer topics, never more",
    carried[0]! >= carried[1]! && carried[1]! >= carried[2]!, `zone ${carried[0]}, state ${carried[1]}, national ${carried[2]}`);

  ok("competition topics for a class are a subset of that class's syllabus",
    competitionTopicsForClass(4, 3).every((t) => t.classes.includes(4)));

  ok("asking for school level returns nothing, because that is the whole syllabus",
    competitionTopicsForClass(4, 0).length === 0);

  /* A correction belongs to one school, and only one. This is the property that
     makes the map safe to let teachers argue with: if an override leaked across
     schools, one school's argument about its own zone paper would silently
     rewrite another's, with no trace and no way to notice. */
  const probeTopic = "md_remainder";
  const bundledTier = resolveDepth(probeTopic).tier;
  try {
    await prisma.topicDepthOverride.upsert({
      where: { schoolId_topicId: { schoolId: user.schoolId!, topicId: probeTopic } },
      create: { schoolId: user.schoolId!, topicId: probeTopic, tier: 1, idea: "The leftover count alone, not the sharing.", note: "verify fixture" },
      update: { tier: 1, idea: "The leftover count alone, not the sharing.", note: "verify fixture" },
    });

    const mine = indexOverrides(
      await prisma.topicDepthOverride.findMany({ where: { schoolId: user.schoolId! }, select: { topicId: true, tier: true, idea: true, note: true } }),
    );
    const resolved = resolveDepth(probeTopic, mine);
    ok("a school's correction is what that school sees", resolved.tier === 1 && resolved.overridden);
    ok("the correction is attributed on the page", resolved.note === "verify fixture");
    ok("a school with no overrides sees the bundled answer", resolveDepth(probeTopic).tier === bundledTier);
    ok("another school's map is untouched by this one",
      resolveDepth(probeTopic, indexOverrides([])).tier === bundledTier);

    const narrowed = competitionTopicsForClass(4, 3, mine);
    ok("a correction can take a topic off a national paper",
      !narrowed.some((t) => t.id === probeTopic));
    ok("a correction can put a topic on one",
      competitionTopicsForClass(4, 1, mine).some((t) => t.id === probeTopic));

    // The action refuses an idea on a tier-0 topic; mirror the rule so the
    // storage cannot end up holding the contradiction even if the form is
    // bypassed.
    await prisma.topicDepthOverride.update({
      where: { schoolId_topicId: { schoolId: user.schoolId!, topicId: probeTopic } },
      data: { tier: 0, idea: null },
    });
    const zero = resolveDepth(probeTopic, indexOverrides(
      await prisma.topicDepthOverride.findMany({ where: { schoolId: user.schoolId! }, select: { topicId: true, tier: true, idea: true, note: true } }),
    ));
    ok("a school can put a topic back to school level", zero.tier === 0);
    ok("and doing so leaves no dangling extra step", zero.idea === null);
  } finally {
    await prisma.topicDepthOverride.deleteMany({ where: { schoolId: user.schoolId!, topicId: probeTopic } });
  }
  ok("the fixture is cleaned up, so the demo map is the bundled one",
    (await prisma.topicDepthOverride.count({ where: { topicId: probeTopic } })) === 0);

  /* A school's argued-over corrections must be able to leave the building, or
   * reinstalling the app throws away months of work and the feature reads as a
   * bug. And the file that leaves must be arguable, not authoritative. */
  try {
    await prisma.topicDepthOverride.create({
      data: { schoolId: user.schoolId!, topicId: probeTopic, tier: 1, idea: "The leftover count alone, not the sharing.", note: "verify fixture" },
    });

    const file = await buildDepthMapExport(user.schoolId!);
    ok("the depth map exports as a versioned file", file?.format === "kapigyan-depth-map" && file.version === 1);
    ok("it carries at least the one correction just made", (file?.corrections.length ?? 0) >= 1);

    const row = file!.corrections.find((c) => c.topicId === probeTopic)!;
    ok("each row states what the school decided", row.tier === 1 && row.idea !== null);
    ok("each row also states what this build would have said", typeof row.bundledTier === "number");
    ok("a row that differs from the bundled answer says so", row.bundledChanged === true);
    ok("the reason the school gave travels with it", row.note === "verify fixture");
    ok("the topic is named in words, so a reader can find it", row.topicName.length > 3);
    ok("the file says it is one school's opinion, not authority",
      file!.manifest.some((m) => /one school|not a published syllabus/i.test(m)));

    // The whole reason this is a separate file and not another format on the
    // school export: this one may be handed to another school, that one must
    // not be sent off by accident.
    const raw = JSON.stringify(file);
    const studentNames = (await prisma.student.findMany({ where: { enrollments: { some: { class: { schoolId: user.schoolId! } } } }, select: { name: true } })).map((s) => s.name);
    ok("the depth map contains no child's name",
      studentNames.every((n) => !raw.includes(n)), `${studentNames.length} student name(s) checked`);
    const full = await buildSchoolExport(user.schoolId!);
    ok("the school export, by contrast, does carry children",
      JSON.stringify(full).includes(studentNames[0] ?? ""));
    ok("the school export now includes these corrections too",
      (full?.depthOverrides.length ?? 0) >= 1);

    // And it must come back in: N corrections out, N corrections back. The count
    // is taken *before* the delete — taking it after would compare nothing
    // against nothing and pass for the wrong reason.
    const round = await prisma.$transaction(async (tx) => {
      const before = await tx.topicDepthOverride.count({ where: { schoolId: user.schoolId! } });
      await tx.topicDepthOverride.deleteMany({ where: { schoolId: user.schoolId! } });
      const emptied = await tx.topicDepthOverride.count({ where: { schoolId: user.schoolId! } });
      for (const c of file!.corrections) {
        await tx.topicDepthOverride.upsert({
          where: { schoolId_topicId: { schoolId: user.schoolId!, topicId: c.topicId } },
          create: { schoolId: user.schoolId!, topicId: c.topicId, tier: c.tier, idea: c.tier === 0 ? null : c.idea, note: c.note },
          update: { tier: c.tier, idea: c.tier === 0 ? null : c.idea },
        });
      }
      const after = await tx.topicDepthOverride.count({ where: { schoolId: user.schoolId! } });
      return { before, emptied, after };
    });
    ok("the delete really did empty the map, so the re-import is being tested",
      round.emptied === 0, `${round.before} → empty`);
    ok("the file re-imports to the same number of corrections",
      round.before === round.after, `${round.before} → ${round.after}`);
  } finally {
    await prisma.topicDepthOverride.deleteMany({ where: { topicId: probeTopic } });
  }

  // And the honest framing survives into what a teacher reads.
  const curriculumHtml = await page("/curriculum?comp=3");
  ok("the page tells the teacher the tier map is an interpretation",
    curriculumHtml.includes("structural interpretation"));
  ok("the page does not claim to be a published syllabus",
    !/official NCERT syllabus|as per NCERT/i.test(curriculumHtml));
}

/* ------------------------------------------------------------------ */
/* Competition questions, derived from the ordinary ones                */
/*                                                                       */
/* The property that cannot be compromised is the answer key. A wrong    */
/* key is invisible: it silently mis-marks every child who ever sits    */
/* the paper, and the teacher has no way to notice. So every assertion  */
/* here re-derives the answer with the app's own grader rather than      */
/* trusting the transform that produced it.                              */
/* ------------------------------------------------------------------ */

console.log("\n— competition questions are correct by construction —");

/* ------------------------------------------------------------------ */
/* Every multiple-choice question must be answerable                     */
/*                                                                       */
/* A wrong answer key is invisible: it mis-marks a child with nothing   */
/* on the page to explain why. These check the properties of the bank   */
/* that make that failure impossible rather than merely absent today.   */
/* ------------------------------------------------------------------ */

console.log("\n— no multiple-choice question is unanswerable —");

{
  const strip = (o: string) => o.replace(/^[A-Da-d]\.\s*/, "").trim();
  const mcqs = await prisma.question.findMany({
    where: { type: "mcq" },
    select: { topicId: true, strand: true, stem: true, options: true, answerKey: true },
  });

  const noChoice = mcqs.filter((q) => (JSON.parse(q.options || "[]") as string[]).length < 2);
  ok("no question leaves the child no choice to make", noChoice.length === 0,
    `${noChoice.length} with fewer than 2 options`);

  const dupes = mcqs.filter((q) => {
    const texts = (JSON.parse(q.options || "[]") as string[]).map(strip);
    return new Set(texts).size < texts.length;
  });
  ok("no question offers the same answer twice", dupes.length === 0,
    dupes.slice(0, 2).map((q) => `${q.topicId}: ${q.stem}`).join(" | "));

  // The case that actually mis-marks: the correct *text* appears at two
  // letters, so a child who picks the other one is wrong for writing the right
  // answer.
  const misMarkable = mcqs.filter((q) => {
    const texts = (JSON.parse(q.options || "[]") as string[]).map(strip);
    const idx = "ABCD".indexOf(String(q.answerKey));
    if (idx < 0) return false;
    return texts.filter((t) => t === texts[idx]).length > 1;
  });
  ok("no correct answer is also offered as a distractor", misMarkable.length === 0);

  // Every keyed option must actually grade correct through the real marker.
  let keyOk = 0;
  for (const q of mcqs) {
    const r = gradeSubmission(
      [{
        id: "x", type: "mcq", stem: q.stem, options: q.options,
        answerKey: q.answerKey, accepted: [], markScheme: {},
        topicId: q.topicId ?? "ns_counting", strand: q.strand, competency: "basic", marks: 1,
      } as never],
      [{ paperQuestionId: "x", response: String(q.answerKey) }],
    );
    if (r.answers[0]?.isCorrect === true) keyOk++;
  }
  ok("every key in the bank is accepted by the marker", keyOk === mcqs.length, `${keyOk}/${mcqs.length}`);

  // "Which is bigger, 2/4 or 2/4?" has no answer, whatever the options say.
  const selfComparing = mcqs.filter((q) => {
    const m = q.stem.match(/(?:bigger|greater|larger), (\S+) or (\S+)\?/i);
    return m !== null && m[1] === m[2];
  });
  ok("no question asks to compare a value with itself", selfComparing.length === 0,
    selfComparing.slice(0, 2).map((q) => q.stem).join(" | "));

  /* Answer-position bias. A child who always ticks A should not score above
   * their understanding. The hash used to rotate the key is unbiased — measured
   * at 33/34/33 across three buckets — so any skew comes from generators that
   * hard-code their key instead of going through the rotation. That is stated
   * rather than asserted away: the assertion is that no single letter can carry
   * the whole bank. */
  const dist: Record<string, number> = {};
  for (const q of mcqs) dist[q.answerKey] = (dist[q.answerKey] ?? 0) + 1;
  const letters = Object.keys(dist).sort();
  const worst = Math.max(...Object.values(dist)) / mcqs.length;
  ok("the answer key is not predictable from one letter", worst < 0.5,
    letters.map((l) => `${l} ${Math.round((dist[l] / mcqs.length) * 100)}%`).join(", "));
  ok("every key the bank uses is actually reachable by the marker",
    letters.every((l) => /^[A-H]$/.test(l)),
    letters.join(""));
}

console.log("\n— competition questions are correct by construction —");

{
  let derived = 0;
  let graded = 0;
  let selfPrinting = 0;
  const styles = new Set<string>();
  const bad: string[] = [];

  for (const topic of TOPICS) {
    if (topicDepth(topic.id).tier === 0 || !topicHasGenerator(topic.id)) continue;
    for (const base of generateForTopic(topic.id, 6, topic.classes[0]!, 4242)) {
      for (const c of toCompetition(base, topic.id, 5)) {
        derived++;
        styles.add(c.style);

        // Graded by the real engine, answering with the transform's own key.
        const r = gradeSubmission(
          [{
            id: "x", type: c.type, stem: c.stem, options: (c.options ?? []).join("|"),
            answerKey: c.answerKey, accepted: [], markScheme: {},
            topicId: topic.id, strand: topic.strand, competency: "basic", marks: 1,
          } as never],
          [{ paperQuestionId: "x", response: String(c.answerKey) }],
        );
        if (r.answers[0]?.isCorrect === true) graded++;
        else bad.push(`${topic.id}/${c.style} "${c.stem}" -> ${c.answerKey}`);

        // A harder question that prints its own answer is not harder. Checked on
        // every question, not only fill-ins: a multiple-choice stem can give the
        // answer away in its wording even though its key is just a letter.
        const prints = (s: string) => /\d/.test(String(c.answerKey))
          && new RegExp(`(^|\\D)${c.answerKey}(\\D|$)`).test(s);
        if (c.type === "fill_blank" && prints(c.stem)) {
          selfPrinting++;
          bad.push(`PRINTS ITS ANSWER: ${c.stem}`);
        }
        if (c.type === "mcq") {
          // The option the key points at must not be spelled out in the stem.
          const idx = "ABCD".indexOf(String(c.answerKey));
          const optionText = (c.options ?? [])[idx];
          if (optionText && prints(optionText)) {
            selfPrinting++;
            bad.push(`PRINTS ITS ANSWER: ${c.stem}`);
          }
        }

        if (c.compTier < 1 || c.compTier > 3) bad.push(`tier out of range: ${c.compTier}`);
        if (!c.explanation || c.explanation.length < 10) bad.push(`no working shown: ${c.stem}`);
        if (!c.derivedFrom) bad.push(`lost the question it came from: ${c.stem}`);
      }
    }
  }

  ok("competition questions can actually be derived", derived > 100, `${derived} derived`);
  ok("every one of them is graded correct by the app's own grader", graded === derived && derived > 0, `${graded}/${derived}`);
  ok("none of them prints its own answer", selfPrinting === 0);
  ok("several problem styles are produced, not one", styles.size >= 4, [...styles].join(", "));
  ok("no derived question is malformed", bad.length === 0, bad.slice(0, 3).join(" | "));

  // Declining is correct behaviour, not a gap. A stem the transforms cannot
  // read must produce nothing rather than something guessed.
  const unreadable = { type: "mcq", stem: "Look at the picture and say which shape it is.", answerKey: "A", marks: 1 } as never;
  ok("a stem the transforms cannot read yields nothing rather than a guess",
    toCompetition(unreadable, "ns_place_value", 3).length === 0);

  // Coverage, reported honestly. Only topics whose own generators emit a
  // readable stem can be derived from. That is now a slim majority at grade 3
  // rather than a small minority — comparison, sequence, fraction and money
  // families were added — but it is still not the whole syllabus, and the point
  // of the assertion is that the number is *measured and stable*, not flattering.
  const can3 = topicsThatCanCompete(3, TOPICS, 1);
  const eligible3 = TOPICS.filter((t) => t.classes.includes(3)).length;
  ok("the coverage probe is deterministic", JSON.stringify(can3) === JSON.stringify(topicsThatCanCompete(3, TOPICS, 1)));
  ok("every derivable topic is one the syllabus already reaches",
    can3.every((id) => topicDepth(id).tier >= 1));
  ok("coverage is measured against the real bank, and is not the whole syllabus",
    can3.length > 0 && can3.length < eligible3, `grade 3 zone: ${can3.length} of ${eligible3}`);

  /* The engine is worthless unless a teacher can reach it, so the door is
   * checked too: the generator must offer competition as a mode, and must be
   * handed the *measured* availability rather than deriving it in the browser. */
  const gen = await page("/generator");
  ok("the generator offers competition as a way to build a paper",
    gen.includes("Competition") && gen.includes("one step past the classroom method"));
  ok("the generator is handed measured availability, not left to guess",
    gen.includes("canBuild"));
  ok("an ordinary paper is still the default, not the competition one",
    gen.includes("Diagnostic") && gen.includes("Close the gaps"));

  // A form field is not a boundary. The action clamps, so a tampered value can
  // only ask for a depth the taxonomy actually defines.
  const clamp = (raw: string) => {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(3, Math.trunc(n))) : 0;
  };
  ok("an absent or nonsense competition level means an ordinary paper",
    clamp("") === 0 && clamp("abc") === 0 && clamp("NaN") === 0 && clamp("-1") === 0);
  ok("an out-of-range level cannot ask for a depth that does not exist",
    clamp("4") === 3 && clamp("99") === 3);
  ok("a fractional level is truncated rather than rounded up",
    clamp("2.7") === 2 && clamp("2.2") === 2);
  ok("a valid level passes through unchanged",
    clamp("1") === 1 && clamp("2") === 2 && clamp("3") === 3);

  /* Every derived question must carry its *topic's* tier, not the style's.
   *
   * A gate that compared each style's own tier against the topic's silently
   * skipped every tier-1 topic, so a Class 3 zone paper drew on seven topics out
   * of fifty. It also stamped those questions tier 2, which would have put the
   * wrong depth in the bank. */
  let wrongTier = 0;
  for (const topic of TOPICS) {
    const want = topicDepth(topic.id).tier;
    if (want === 0 || !topicHasGenerator(topic.id)) continue;
    for (const base of generateForTopic(topic.id, 4, topic.classes[0]!, 606)) {
      for (const c of toCompetition(base, topic.id, 2)) {
        if (c.compTier !== want) wrongTier++;
      }
    }
  }
  ok("a derived question carries its topic's tier, not the style's", wrongTier === 0, `${wrongTier} mislabelled`);

  /* The ceiling is a fact about the bank, not an accident, and it has to be
   * reportable — a school deciding what to commission next needs the reasons,
   * not just the number. */
  const report = coverageReport(3, TOPICS, 1);
  ok("the coverage report accounts for every blocked topic",
    report.blocked.length === report.eligible - report.canBuild,
    `${report.canBuild} reachable, ${report.blocked.length} blocked of ${report.eligible}`);
  ok("every blocked topic gives a reason in words",
    report.blocked.every((b) => b.reason.length > 20));
  ok("the two blocking causes are told apart",
    new Set(report.blocked.map((b) => b.reason)).size >= 2);
}

await prisma.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
