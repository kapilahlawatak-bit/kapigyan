/**
 * Printable practice sheet as a PDF.
 *
 * Same content as the on-screen print route, generated server-side so a
 * parent on a phone can save it and print it later at a print shop, which is
 * how a great many Indian families will actually use it.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApi, assertStudentAccess, AuthError } from "@/lib/auth/guard";
import { generateForTopic, topicHasGenerator } from "@/lib/question-generation/templates";
import { TOPIC_BY_ID } from "@/lib/curriculum";

export const runtime = "nodejs";

type Ctx = RouteContext<"/api/practice/[studentId]/[topicId]">;

export async function GET(_request: Request, ctx: Ctx) {
  const { studentId, topicId } = await ctx.params;

  const auth = await requireApi();
  if ("response" in auth) return auth.response;
  const session = auth.session;

  // One guard for every audience: a parent only their own child and only while
  // consent stands, a teacher only a child inside their own school, and a
  // student their own record. Previously a signed-in child got a flat 403 here
  // while `/me/practice` rendered them the very same sheet — so the practice
  // feature worked on screen and failed the moment a child tried to save it.
  try {
    await assertStudentAccess(session, studentId);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, name: true } });
  if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!topicHasGenerator(topicId)) {
    return NextResponse.json({ error: "No practice set for that topic" }, { status: 404 });
  }
  const meta = TOPIC_BY_ID.get(topicId);
  if (!meta) return NextResponse.json({ error: "Unknown topic" }, { status: 404 });

  const enrolment = await prisma.enrollment.findFirst({
    where: { studentId },
    select: { class: { select: { grade: true } } },
  });
  const grade = (enrolment?.class.grade ?? 3) as 1 | 2 | 3 | 4 | 5;
  const questions = generateForTopic(topicId, 8, grade, hash(topicId + grade + studentId));
  if (questions.length === 0) {
    return NextResponse.json({ error: "Nothing to generate" }, { status: 404 });
  }

  const { default: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 16;
  const first = student.name.split(" ")[0];

  // Header
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(meta.name, W / 2, 16, { align: "center" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`For ${student.name}  ·  Class ${grade}  ·  ${questions.length} questions  ·  about 10 minutes`, W / 2, 21, { align: "center" });
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.line(M, 24, W - M, 24);

  // Parent note
  doc.setFillColor(247, 247, 250);
  doc.roundedRect(M, 27, W - M * 2, 20, 2, 2, "F");
  doc.setFontSize(8.5);
  doc.text(
    doc.splitTextToSize(
      `For the parent: ask ${first} to do these slowly and show any working. If an answer is wrong, do not correct it straight away — ask "show me how you got that" first, because the way of working usually shows what needs teaching. Mark it together using the answers on the last page.`,
      W - M * 2 - 8,
    ),
    M + 4,
    33,
  );

  let y = 54;
  doc.setFontSize(11);

  questions.forEach((q, i) => {
    if (y > doc.internal.pageSize.getHeight() - 30) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    const stem = doc.splitTextToSize(`${i + 1}.  ${q.stem}`, W - M * 2 - 6);
    doc.text(stem, M, y);
    y += stem.length * 5;

    if (q.options && q.options.length > 0) {
      doc.setFontSize(10);
      const half = Math.ceil(q.options.length / 2);
      for (let col = 0; col < 2; col += 1) {
        const slice = q.options.slice(col * half, (col + 1) * half);
        slice.forEach((o, oi) => {
          doc.text(`    ${o}`, M + 6 + col * ((W - M * 2) / 2), y + oi * 5.5);
        });
      }
      y += half * 5.5 + 3;
    } else {
      doc.setDrawColor(200, 200, 210);
      doc.line(M + 4, y + 8, W - M - 4, y + 8);
      y += 16;
    }
  });

  // Answers on their own page
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Answers", M, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 120);
  doc.text(`Cut along the line above, or fold the page, before handing this sheet to ${first}.`, M, 25);
  doc.setTextColor(0, 0, 0);

  let ay = 34;
  questions.forEach((q, i) => {
    if (ay > doc.internal.pageSize.getHeight() - 24) {
      doc.addPage();
      ay = 20;
    }
    doc.setFontSize(10.5);
    doc.text(`${i + 1}.`, M, ay);
    doc.setFont("courier", "normal");
    doc.text(q.answerKey, M + 6, ay);
    doc.setFont("helvetica", "normal");
    if (q.explanation) {
      const note = doc.splitTextToSize(q.explanation, W - M * 2 - 40);
      doc.setFontSize(8.5);
      doc.setTextColor(105, 105, 120);
      doc.text(note, M + 34, ay);
      doc.setTextColor(0, 0, 0);
      ay += Math.max(5, note.length * 4.2) + 1.5;
    } else {
      ay += 5.5;
    }
  });

  const name = student.name.replace(/[^\wऀ-ॿ -]+/g, "").trim().replace(/\s+/g, "-") || "child";
  return new NextResponse(new Uint8Array(Buffer.from(doc.output("arraybuffer"))), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="practice-${meta.id}-${name}.pdf"`,
    },
  });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
