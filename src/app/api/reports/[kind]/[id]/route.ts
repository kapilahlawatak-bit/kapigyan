/**
 * Individual reports: one child, one parent-readable page.
 *
 * Separate from the class report export because the audience and the tone
 * are different. A class report is for a register; this one is handed to a
 * family. No mastery jargon, no ranking against other children, no red
 * "at risk" label on a document a parent may read in front of their child —
 * the same facts, phrased so they can be acted on at a kitchen table.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApi, assertStudentAccess, AuthError } from "@/lib/auth/guard";
import { studentMasteryMap } from "@/lib/analytics/class";
import { asArray, meanMastery, riskFor, planFrom } from "@/lib/analytics/view";
import { STRAND_BY_ID, TOPIC_BY_ID, gradeBand } from "@/lib/curriculum";
import { planForStudent } from "@/lib/intelligence/recommendations";

export const runtime = "nodejs";

type Ctx = RouteContext<"/api/reports/[kind]/[id]">;

export async function GET(_request: Request, ctx: Ctx) {
  const { kind, id } = await ctx.params;
  if (kind !== "student" && kind !== "parent") {
    return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  }

  const auth = await requireApi();
  if ("response" in auth) return auth.response;
  const session = auth.session;

  // Authorise *before* reading anything about the child. This route used to
  // fetch the whole submission set first and check consent afterwards, which
  // meant the data was already in memory before the decision was made.
  //
  // The single guard below covers all three audiences: a parent only their own
  // child and only while consent stands, a student only themselves, a teacher
  // only a child on a roll inside their own school.
  try {
    await assertStudentAccess(session, id);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const student = await prisma.student.findUnique({
    where: { id },
    include: { submissions: { include: { paper: { select: { id: true, title: true, date: true, maxMarks: true } } } } },
  });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Scoped to the caller's school. The unscoped version could pick an enrolment
  // belonging to a different school and compute the report against the wrong
  // class's data.
  const enrolment = session.schoolId
    ? await prisma.enrollment.findFirst({
        where: { studentId: id, class: { schoolId: session.schoolId } },
        select: { classId: true, class: { select: { grade: true } } },
      })
    : null;
  const grade = enrolment?.class.grade ?? null;

  const mastery = await studentMasteryMap(id, enrolment?.classId);
  const rows = asArray(mastery);
  const avg = meanMastery(rows);
  const strong = [...rows].sort((a, b) => b.mastery - a.mastery).slice(0, 3);
  const weak = rows.filter((m) => m.mastery < 0.65).sort((a, b) => a.mastery - b.mastery);
  const risk = riskFor(mastery, student.submissions.filter((s) => s.maxScore > 0).map((s) => (s.score / s.maxScore) * 100));
  const plan = planFrom(student.name, mastery, 0.65, 3);

  const last = student.submissions[student.submissions.length - 1];
  const lastPct = last && last.maxScore > 0 ? (last.score / last.maxScore) * 100 : null;

  const { default: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 16;

  // Header
  doc.setFillColor(63, 81, 200);
  doc.rect(0, 0, W, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(`${student.name} — Maths Progress`, M, 12);
  doc.setFontSize(9);
  doc.text(
    student.submissions.length > 0
      ? `Most recent test: ${last!.paper.title} (${last!.paper.date.toLocaleDateString("en-IN")})`
      : "No marked tests yet",
    M,
    19,
  );
  doc.setFontSize(11);
  doc.text(
    lastPct !== null
      ? `Latest result ${Math.round(lastPct)}% — ${gradeBand(lastPct).label}`
      : `Overall understanding ${Math.round(avg * 100)}%`,
    M,
    25,
  );
  doc.setTextColor(30, 30, 30);

  let y = 36;

  // Summary sentence
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(
    `${student.name} currently understands about ${Math.round(avg * 100)}% of the ${
      grade ? `Class ${grade} ` : ""
    }mathematics syllabus.`,
    M,
    y,
  );
  doc.setFont("helvetica", "normal");
  y += 9;

  // Going well
  const section = (title: string) => {
    doc.setFontSize(11.5);
    doc.setFont("helvetica", "bold");
    doc.text(title, M, y);
    doc.setFont("helvetica", "normal");
    y += 5;
  };

  if (strong.length > 0) {
    section("Going well");
    for (const m of strong) {
      doc.setFontSize(9.5);
      doc.text(`•  ${TOPIC_BY_ID.get(m.topicId)?.name ?? m.topicId}  (${Math.round(m.mastery * 100)}%)`, M + 3, y);
      y += 5;
    }
    y += 3;
  }

  if (weak.length > 0) {
    section("Needs more practice at home");
    for (const m of weak.slice(0, 5)) {
      const topic = TOPIC_BY_ID.get(m.topicId);
      doc.setFontSize(9.5);
      doc.text(`•  ${topic?.name ?? m.topicId}  (${Math.round(m.mastery * 100)}%)`, M + 3, y);
      y += 4.4;
      if (topic?.blurb) {
        doc.setFontSize(8.5);
        doc.setTextColor(105, 105, 120);
        const lines = doc.splitTextToSize(topic.blurb, W - M * 2 - 6);
        doc.text(lines, M + 7, y);
        y += lines.length * 4;
        doc.setTextColor(30, 30, 30);
      }
      y += 1.5;
    }
    y += 3;
  }

  if (plan.items.length > 0) {
    section("What to do at home — 10 minutes a day is enough");
    for (const item of plan.items) {
      doc.setFontSize(9.5);
      doc.text(`${item.topicName}:`, M + 3, y);
      y += 4.6;
      for (const step of item.whatToDo.slice(0, 3)) {
        doc.setFontSize(8.8);
        const lines = doc.splitTextToSize(`– ${step}`, W - M * 2 - 10);
        doc.text(lines, M + 7, y);
        y += lines.length * 4;
      }
      y += 1.5;
    }
    y += 3;
  }

  // Strand bars
  if (y > 200) {
    doc.addPage();
    y = 20;
  }
  section("By subject area");
  const byStrand = new Map<string, number[]>();
  for (const m of rows) {
    const s = STRAND_BY_ID.get(TOPIC_BY_ID.get(m.topicId)?.strand ?? "");
    if (s) byStrand.set(s.id, [...(byStrand.get(s.id) ?? []), m.mastery]);
  }
  for (const [id, vals] of byStrand) {
    const s = STRAND_BY_ID.get(id);
    const pct = (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
    doc.setFontSize(9);
    doc.text(s?.name ?? id, M, y);
    doc.text(`${Math.round(pct)}%`, W - M, y, { align: "right" });
    doc.setFillColor(235, 235, 242);
    doc.rect(M, y + 1.5, W - M * 2, 3, "F");
    doc.setFillColor(pct >= 70 ? 22 : pct >= 50 ? 190 : 208, pct >= 70 ? 163 : pct >= 50 ? 140 : 40, pct >= 70 ? 94 : pct >= 50 ? 50 : 40);
    doc.rect(M, y + 1.5, ((W - M * 2) * pct) / 100, 3, "F");
    y += 8;
  }

  // Footer
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 160);
    doc.text(`Generated by Kapigyan on ${new Date().toLocaleDateString("en-IN")}`, M, doc.internal.pageSize.getHeight() - 8);
    doc.text(`Page ${i} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 8, { align: "right" });
  }

  const name = student.name.replace(/[^\wऀ-ॿ -]+/g, "").trim().replace(/\s+/g, "-") || "child";
  return new NextResponse(new Uint8Array(Buffer.from(doc.output("arraybuffer"))), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${kind === "parent" ? "inline" : "attachment"}; filename="kapigyan-${name}.pdf"`,
    },
  });
}
