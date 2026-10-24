/**
 * Report export.
 *
 * One route, three formats, because all three are built from the same bundle
 * and share the same access check. Everything is generated server-side and
 * returned as a download — no CDN, no third-party converter, and no data
 * leaving the school server.
 *
 * The fonts and layout are chosen for the actual destination: these reports
 * get printed on school laser printers and filed, so the PDF uses A4 with
 * generous margins and a repeat-header table rather than a screen-first layout.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApi } from "@/lib/auth/guard";
import { canTeach } from "@/lib/auth/roles";
import { buildReport, reportHeading, type ReportBundle } from "@/lib/reports/bundle";
import { MISCONCEPTION_BY_ID, gradeBand } from "@/lib/curriculum";

export const runtime = "nodejs";

type Ctx = RouteContext<"/api/papers/[id]/export/[format]">;

export async function GET(_request: Request, ctx: Ctx) {
  const { id, format } = await ctx.params;

  const auth = await requireApi();
  if ("response" in auth) return auth.response;
  const session = auth.session;
  if (!canTeach(session.role)) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  if (!session.schoolId) return NextResponse.json({ error: "No school" }, { status: 403 });

  // Ownership, not just school membership. `buildReport` returning a bundle was
  // previously enough, which meant any teacher could export a full register of
  // every child's marks for a colleague's class.
  const cls = await prisma.paper.findUnique({
    where: { id },
    select: { class: { select: { teacherId: true } } },
  });
  if (!cls) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.role === "TEACHER" && cls.class?.teacherId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bundle = await buildReport(id, session.schoolId);
  if (!bundle) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const safe = `${bundle.paper.title}`.replace(/[^\wऀ-ॿ -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "report";

  try {
    switch (format) {
      case "xlsx":
        return await xlsx(bundle, safe);
      case "docx":
        return await docx(bundle, safe);
      case "pdf":
        return await pdf(bundle, safe);
      default:
        return NextResponse.json({ error: "Unknown format" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not build the file" },
      { status: 500 },
    );
  }
}

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

async function xlsx(b: ReportBundle, filename: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kapigyan";
  wb.created = b.generatedAt;

  // --- Summary ---
  const sum = wb.addWorksheet("Summary");
  sum.columns = [{ width: 30 }, { width: 22 }];
  const heading = sum.addRow(["SCHOOL REPORT"]);
  heading.font = { bold: true, size: 14 };
  reportHeading(b).forEach((line) => sum.addRow([line]));
  sum.addRow([]);
  const a = b.analysis;
  const stats: [string, string | number][] = [
    ["Students marked", a.gradedCount],
    ["Class average %", a.averagePercent],
    ["Median %", a.medianPercent],
    ["Highest %", a.highest ? `${a.highest.percent.toFixed(1)} (${a.highest.name})` : "—"],
    ["Lowest %", a.lowest ? `${a.lowest.percent.toFixed(1)} (${a.lowest.name})` : "—"],
    ["Total questions", b.paper.totalQuestions],
    ["Total marks", b.paper.maxMarks],
    ["Answers needing a teacher's judgement", a.needsReviewCount],
  ];
  stats.forEach(([k, v]) => {
    const row = sum.addRow([k, v]);
    row.getCell(1).font = { bold: true };
  });

  sum.addRow([]);
  const bandTitle = sum.addRow(["Grade distribution"]);
  bandTitle.font = { bold: true };
  sum.addRow(["Grade", "Students"]);
  Object.entries(a.bandCounts).forEach(([band, count]) => sum.addRow([band, count]));

  // --- Students ---
  const st = wb.addWorksheet("Student marks");
  st.columns = [
    { header: "Roll", key: "roll", width: 7 },
    { header: "Student", key: "name", width: 24 },
    { header: "Marks", key: "marks", width: 9 },
    { header: "Out of", key: "out", width: 8 },
    { header: "%", key: "pct", width: 8 },
    { header: "Grade", key: "grade", width: 8 },
    { header: "Correct", key: "correct", width: 9 },
    { header: "Partial", key: "partial", width: 9 },
    { header: "Wrong", key: "wrong", width: 8 },
    { header: "Not attempted", key: "blank", width: 13 },
    { header: "Main difficulty", key: "mc", width: 34 },
  ];
  st.getRow(1).font = { bold: true };
  st.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0FA" } };
  st.views = [{ state: "frozen", ySplit: 1 }];
  for (const s of b.students) {
    st.addRow({
      roll: s.rollNo ?? "", name: s.name, marks: s.score, out: s.maxScore,
      pct: s.percent, grade: s.grade, correct: s.correct, partial: s.partial,
      wrong: s.wrong, blank: s.blank,
      mc: s.topMisconception ? MISCONCEPTION_BY_ID.get(s.topMisconception)?.name ?? s.topMisconception : "—",
    });
  }
  st.getColumn("pct").numFmt = "0.0";

  // --- Topics ---
  const tp = wb.addWorksheet("Topic analysis");
  tp.columns = [
    { header: "Topic", key: "name", width: 34 },
    { header: "Strand", key: "strand", width: 24 },
    { header: "% correct", key: "rate", width: 11 },
    { header: "% not attempted", key: "blank", width: 15 },
    { header: "Most common wrong idea", key: "mc", width: 36 },
    { header: "Children affected", key: "count", width: 16 },
  ];
  tp.getRow(1).font = { bold: true };
  tp.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0FA" } };
  tp.views = [{ state: "frozen", ySplit: 1 }];
  for (const t of b.topics) {
    tp.addRow({
      name: t.name, strand: t.strandName, rate: t.correctRate / 100, blank: t.blankRate / 100,
      mc: t.misconceptions[0]?.name ?? "—", count: t.misconceptions[0]?.count ?? 0,
    });
  }
  tp.getColumn("rate").numFmt = "0%";
  tp.getColumn("blank").numFmt = "0%";

  // --- Questions ---
  const qs = wb.addWorksheet("Question analysis");
  qs.columns = [
    { header: "Q", key: "no", width: 5 },
    { header: "Question", key: "stem", width: 60 },
    { header: "Topic", key: "topic", width: 30 },
    { header: "Marks", key: "marks", width: 7 },
    { header: "Answer", key: "ans", width: 12 },
    { header: "% correct", key: "rate", width: 11 },
    { header: "Most common wrong answer", key: "wrong", width: 26 },
  ];
  qs.getRow(1).font = { bold: true };
  qs.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0FA" } };
  qs.views = [{ state: "frozen", ySplit: 1 }];
  for (const q of b.questions) {
    qs.addRow({
      no: q.position, stem: q.stem, topic: q.topicName, marks: q.marks, ans: q.answerKey,
      rate: q.successRate / 100, wrong: q.topWrong[0] ? `${q.topWrong[0].response} (${q.topWrong[0].count})` : "—",
    });
  }
  qs.getColumn("rate").numFmt = "0%";
  qs.getColumn("stem").alignment = { wrapText: true, vertical: "top" };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="kapigyan-${filename}.xlsx"`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Word                                                               */
/* ------------------------------------------------------------------ */

async function docx(b: ReportBundle, filename: string) {
  const {
    Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell,
    TextRun, WidthType, BorderStyle,
  } = await import("docx");

  const cell = (text: string, bold = false, shade?: string) =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })],
      shading: shade ? { fill: shade } : undefined,
    });

  const rows = [
    new TableRow({
      tableHeader: true,
      children: ["Roll", "Student", "Marks", "%", "Grade", "Not attempted", "Main difficulty"].map((h) => cell(h, true, "EEF0FA")),
    }),
    ...b.students.map((s) =>
      new TableRow({
        children: [
          cell(String(s.rollNo ?? "")),
          cell(s.name),
          cell(`${s.score}/${s.maxScore}`),
          cell(`${s.percent}%`),
          cell(s.grade),
          cell(String(s.blank)),
          cell(s.topMisconception ? MISCONCEPTION_BY_ID.get(s.topMisconception)?.name ?? s.topMisconception : "—"),
        ],
      }),
    ),
  ];

  const topicRows = [
    new TableRow({ tableHeader: true, children: ["Topic", "Strand", "% correct", "Main wrong idea"].map((h) => cell(h, true, "EEF0FA")) }),
    ...b.topics.map((t) =>
      new TableRow({
        children: [cell(t.name), cell(t.strandName), cell(`${t.correctRate}%`), cell(t.misconceptions[0]?.name ?? "—")],
      }),
    ),
  ];

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 900, right: 900 } } },
        children: [
          new Paragraph({ text: "Class Test Report", heading: HeadingLevel.TITLE }),
          ...reportHeading(b).map((l) => new Paragraph({ children: [new TextRun({ text: l, size: 20, color: "555555" })] })),
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [
              new TextRun({ text: "Class average ", bold: true, size: 22 }),
              new TextRun({ text: `${b.analysis.averagePercent}%  (${gradeBand(b.analysis.averagePercent).label})`, size: 22 }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: `Students marked: ${b.analysis.gradedCount}`, size: 20, color: "555555" })] }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "Student results", heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
              left: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
              right: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "EEEEEE" },
              insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "EEEEEE" },
            },
            rows,
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "Topic analysis", heading: HeadingLevel.HEADING_2 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: topicRows,
          }),
          new Paragraph({ text: "" }),
          new Paragraph({ text: "What to do next", heading: HeadingLevel.HEADING_2 }),
          ...b.topics
            .filter((t) => t.correctRate < 60)
            .slice(0, 5)
            .flatMap((t) => {
              const m = t.misconceptions[0]?.id ? MISCONCEPTION_BY_ID.get(t.misconceptions[0].id) : null;
              return [
                new Paragraph({ children: [new TextRun({ text: `${t.name} — ${t.correctRate}% correct`, bold: true, size: 22 })] }),
                new Paragraph({ children: [new TextRun({ text: m ? m.remediation.join(" ") : "Revisit this topic with the concrete-pictorial-abstract approach.", size: 20 })] }),
              ];
            }),
          new Paragraph({ text: "" }),
          new Paragraph({
            children: [new TextRun({ text: `Generated by Kapigyan on ${b.generatedAt.toLocaleDateString("en-IN")}`, size: 16, color: "999999" })],
          }),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return new NextResponse(Buffer.from(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="kapigyan-${filename}.docx"`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* PDF                                                                */
/* ------------------------------------------------------------------ */

async function pdf(b: ReportBundle, filename: string) {
  const { default: JsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(63, 81, 200);
  doc.rect(0, 0, pageWidth, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.text("Class Test Report", 14, 11);
  doc.setFontSize(9);
  doc.text(b.school.name, 14, 18);
  const sub = [b.class ? `Class ${b.class.grade} · ${b.class.name}` : `Class ${b.paper.grade}`, b.paper.term, b.paper.date.toLocaleDateString("en-IN")].join("  ·  ");
  doc.text(sub, 14, 23);
  doc.setTextColor(30, 30, 30);

  // Summary tiles
  let y = 34;
  const tiles: [string, string][] = [
    ["Class average", `${b.analysis.averagePercent}%`],
    ["Median", `${b.analysis.medianPercent}%`],
    ["Students", String(b.analysis.gradedCount)],
    ["Questions", String(b.paper.totalQuestions)],
  ];
  const tw = (pageWidth - 28 - 6) / 4;
  tiles.forEach(([label, value], i) => {
    const x = 14 + i * (tw + 2);
    doc.setDrawColor(224, 224, 230);
    doc.setFillColor(249, 249, 252);
    doc.roundedRect(x, y, tw, 16, 2, 2, "FD");
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 135);
    doc.text(label.toUpperCase(), x + 3, y + 6);
    doc.setFontSize(13);
    doc.setTextColor(25, 25, 35);
    doc.text(value, x + 3, y + 13);
  });
  y += 22;

  doc.setFontSize(11);
  doc.setTextColor(25, 25, 35);
  doc.text("Student results", 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [["Roll", "Student", "Marks", "%", "Grade", "Not done", "Main difficulty"]],
    body: b.students.map((s) => [
      String(s.rollNo ?? ""),
      s.name,
      `${s.score}/${s.maxScore}`,
      `${s.percent}%`,
      s.grade,
      String(s.blank),
      s.topMisconception ? MISCONCEPTION_BY_ID.get(s.topMisconception)?.name ?? "" : "—",
    ]),
    styles: { fontSize: 8, cellPadding: 1.6, textColor: [40, 40, 50], lineColor: [235, 235, 240], lineWidth: 0.1 },
    headStyles: { fillColor: [63, 81, 200], textColor: 255, fontStyle: "bold", fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 253] },
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(150, 150, 160);
      doc.text(
        `${b.school.name} · ${b.paper.title}`,
        14,
        doc.internal.pageSize.getHeight() - 8,
      );
      doc.text(
        `Page ${doc.getNumberOfPages()}`,
        pageWidth - 14,
        doc.internal.pageSize.getHeight() - 8,
        { align: "right" },
      );
    },
  });

  // Topic analysis on a fresh page
  doc.addPage();
  doc.setFontSize(13);
  doc.setTextColor(25, 25, 35);
  doc.text("Topic analysis — what the class has not understood", 14, 16);
  doc.setFontSize(8.5);
  doc.setTextColor(110, 110, 125);
  doc.text("Sorted weakest first. Anything below 60% needs another lesson before moving on.", 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [["Topic", "Strand", "% correct", "Not attempted", "Most common wrong idea"]],
    body: b.topics.map((t) => [t.name, t.strandName, `${t.correctRate}%`, `${t.blankRate}%`, t.misconceptions[0]?.name ?? "—"]),
    styles: { fontSize: 8, cellPadding: 1.8, textColor: [40, 40, 50], lineColor: [235, 235, 240], lineWidth: 0.1 },
    headStyles: { fillColor: [63, 81, 200], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [250, 250, 253] },
    margin: { left: 14, right: 14 },
  });

  // Remediation
  const weak = b.topics.filter((t) => t.correctRate < 60).slice(0, 4);
  if (weak.length > 0) {
    doc.addPage();
    doc.setFontSize(13);
    doc.setTextColor(25, 25, 35);
    doc.text("What to teach next", 14, 16);

    let ry = 24;
    for (const t of weak) {
      const m = t.misconceptions[0]?.id ? MISCONCEPTION_BY_ID.get(t.misconceptions[0].id) : null;
      doc.setFontSize(10);
      doc.setTextColor(25, 25, 35);
      doc.text(`${t.name} — ${t.correctRate}% correct`, 14, ry);
      ry += 4.5;
      doc.setFontSize(8.5);
      doc.setTextColor(90, 90, 105);
      if (m) {
        doc.text(`Common cause: ${m.name}. ${m.belief}`, 14, ry, { maxWidth: pageWidth - 28 });
        ry += 4;
        const text = doc.splitTextToSize(`How to fix it: ${m.remediation.join(" ")}`, pageWidth - 28);
        doc.text(text, 14, ry);
        ry += text.length * 4 + 5;
      } else {
        const text = doc.splitTextToSize(
          "Revisit this topic following the concrete-pictorial-abstract method, then re-test with three questions.",
          pageWidth - 28,
        );
        doc.text(text, 14, ry);
        ry += text.length * 4 + 5;
      }
    }
  }

  const buf = Buffer.from(doc.output("arraybuffer"));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="kapigyan-${filename}.pdf"`,
    },
  });
}
