/**
 * The term plan as a PDF.
 *
 * Same content as the print route. A planning sheet is emailed to a head
 * teacher, dropped into a shared drive, or opened on a phone in a staff
 * meeting, so it has to survive outside this building.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { loadPlanData } from "@/lib/analytics/plan-data";
import { buildTeachingPlan } from "@/lib/intelligence/teaching-plan";
import { topicsForClass, MISCONCEPTION_BY_ID } from "@/lib/curriculum";

export const runtime = "nodejs";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

type Ctx = RouteContext<"/api/plan/[classId]">;

export async function GET(request: Request, ctx: Ctx) {
  const { classId } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.role !== "TEACHER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Teachers only" }, { status: 403 });
  }

  // The teacher must own the class. loadPlanData applies the same scoping the
  // page does, so re-using it keeps the two in step.
  const data = await loadPlanData(session, classId);
  if (!data || data.classId !== classId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const weeks = Math.min(24, Math.max(4, Number(url.searchParams.get("weeks")) || 12));
  const perWeek = Math.min(5, Math.max(1, Number(url.searchParams.get("sessions")) || 4));
  const consolidate = url.searchParams.get("consolidate") === "1";

  const plan = buildTeachingPlan({
    grade: data.grade,
    syllabus: topicsForClass(data.grade),
    mastery: data.mastery,
    recommendations: data.recommendations,
    weeks,
    sessionsPerWeek: perWeek,
    consolidate,
  });

  const { default: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const right = W - M;

  const school = await prisma.school.findUnique({ where: { id: session.schoolId ?? "" }, select: { name: true } });

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("Mathematics Teaching Plan", W / 2, 15, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(
    `${school?.name ?? "Kapigyan"} · ${data.className} (Class ${data.grade}) · ${data.studentCount} children`,
    W / 2, 20, { align: "center" },
  );
  doc.text(
    `${weeks} weeks · ${perWeek} periods a week · ${plan.counts.teach} topics · ${plan.counts.check} revisits${consolidate ? " · no spaced revisits" : ""}`,
    W / 2, 24.5, { align: "center" },
  );
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.line(M, 28, right, 28);

  let y = 36;

  for (const w of plan.weeks) {
    if (y > H - 30) {
      doc.addPage();
      y = 18;
    }

    // Keep a week header with at least its first row.
    if (y > H - 45) {
      doc.addPage();
      y = 18;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(`Week ${w.week}`, M, y);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    const focus = doc.splitTextToSize(w.focus, right - M - 22)[0] ?? "";
    doc.text(focus, M + 20, y);
    doc.setFont("helvetica", "normal");
    y += 1.8;
    doc.setDrawColor(160, 160, 170);
    doc.setLineWidth(0.3);
    doc.line(M, y, right, y);
    y += 4;

    if (w.sessions.length === 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      doc.text("Free — assessment or catch-up.", M + 2, y);
      doc.setFont("helvetica", "normal");
      y += 6;
      continue;
    }

    for (const s of w.sessions) {
      if (y > H - 24) {
        doc.addPage();
        y = 18;
      }

      // Strand colour chip.
      const rgb = hexToRgb(s.strandColor);
      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.circle(M + 1.5, y - 1, 1.2, "F");

      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(110, 110, 120);
      doc.text(DAY_NAMES[s.day]!, M + 5, y);

      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", "bold");
      const topic = `${s.topicName}${s.kind !== "teach" ? `  (${s.kind === "check" ? "check" : "consolidate"} · after ${s.revisitOf})` : ""}`;
      doc.text(doc.splitTextToSize(topic, 58)[0] ?? "", M + 16, y);
      doc.setFont("helvetica", "normal");

      const why = doc.splitTextToSize(s.why, right - (M + 16) - 8, { lineHeightFactor: 1.25 });
      doc.setFontSize(7.8);
      doc.setTextColor(80, 80, 92);
      doc.text(why.slice(0, 2), M + 76, y);
      doc.setTextColor(0, 0, 0);

      y += Math.max(4.2, Math.min(2, why.length) * 3.4) + 1.6;
    }
    y += 3;
  }

  // Errors the plan is designed against.
  const miscs = Object.entries(data.misconceptionTotals).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (miscs.length > 0) {
    doc.addPage();
    y = 18;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Errors this plan is designed against", M, y);
    y += 7;
    for (const [id, n] of miscs) {
      const m = MISCONCEPTION_BY_ID.get(id);
      if (!m) continue;
      if (y > H - 26) {
        doc.addPage();
        y = 18;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text(`${m.name}  (${n} answers)`, M + 2, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(90, 90, 100);
      const belief = doc.splitTextToSize(`“${m.belief}”`, right - M - 4);
      doc.text(belief, M + 2, y);
      y += belief.length * 3.4 + 1;
      const fix = doc.splitTextToSize(`Fix: ${m.remediation[0]}`, right - M - 4);
      doc.text(fix, M + 2, y);
      y += fix.length * 3.4 + 4;
      doc.setTextColor(0, 0, 0);
    }
  }

  const name = data.className.replace(/[^\wऀ-ॿ -]+/g, "").trim().replace(/\s+/g, "-") || "class";
  return new NextResponse(new Uint8Array(Buffer.from(doc.output("arraybuffer"))), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="kapigyan-plan-${name}.pdf"`,
    },
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [
    parseInt(full.slice(0, 2), 16) || 136,
    parseInt(full.slice(2, 4), 16) || 136,
    parseInt(full.slice(4, 6), 16) || 136,
  ];
}
