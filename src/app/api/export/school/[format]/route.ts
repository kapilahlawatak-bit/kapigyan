/**
 * Whole-school data export.
 *
 * Answers a DPDP Act 2023 portability request, and gives a school an archive
 * it could actually restore from — which is why raw responses and teacher notes
 * are included, not only scores.
 *
 * Scope is enforced here, not in the bundle: a teacher gets their own classes,
 * a principal gets the school, a parent is refused. A parent wanting their
 * child's data has a separate route that returns one child and nothing else.
 *
 * Every file carries the same manifest, so the thing that left the building
 * says on its own what it does and does not contain.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { buildSchoolExport } from "@/lib/reports/school-export";

export const runtime = "nodejs";

type Ctx = RouteContext<"/api/export/school/[format]">;

export async function GET(_request: Request, ctx: Ctx) {
  const { format } = await ctx.params;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (session.role === "PARENT") {
    // A parent asking for a school-wide file is asking for other children.
    return NextResponse.json(
      { error: "A parent can only export their own child's data." },
      { status: 403 },
    );
  }
  if (session.role !== "TEACHER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  if (!session.schoolId) return NextResponse.json({ error: "No school" }, { status: 403 });

  // A teacher exports their own classes. A principal exports the school.
  let restrictToClasses: string[] | undefined;
  if (session.role === "TEACHER") {
    const mine = await prisma.class.findMany({
      where: { schoolId: session.schoolId, teacherId: session.userId },
      select: { id: true },
    });
    restrictToClasses = mine.map((c) => c.id);
    if (restrictToClasses.length === 0) {
      return NextResponse.json({ error: "You have no classes to export." }, { status: 404 });
    }
  }

  const data = await buildSchoolExport(session.schoolId, { restrictToClasses });
  if (!data) return NextResponse.json({ error: "Nothing to export" }, { status: 404 });

  const stamp = data.generatedAt.slice(0, 10);
  const label = session.role === "ADMIN" ? "school" : "my-classes";

  try {
    switch (format) {
      case "json":
        return download(JSON.stringify(data, null, 2), "application/json", `kapigyan-${label}-${stamp}.json`);
      case "csv":
        return download(csvBundle(data), "text/csv; charset=utf-8", `kapigyan-${label}-${stamp}.csv`);
      case "xlsx":
        return await xlsx(data, `kapigyan-${label}-${stamp}.xlsx`);
      case "docx":
        return await docx(data, `kapigyan-${label}-${stamp}.docx`);
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

function download(body: string | Buffer, type: string, filename: string) {
  return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

/**
 * CSV.
 *
 * Long format rather than wide: a wide CSV with answer-level detail needs a
 * column per question and breaks the moment two papers differ. Each record is
 * one row, and the paper and question columns say which it belongs to.
 */
function csvBundle(d: Awaited<ReturnType<typeof buildSchoolExport>>): string {
  if (!d) return "";
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const line = (cells: unknown[]) => cells.map(esc).join(",");

  const out: string[] = [];
  out.push(line(["# Kapigyan data export", d.school.name, d.generatedAt]));
  d.manifest.forEach((m) => out.push(`# ${m}`));
  out.push("");

  out.push(line(["RECORD", "STUDENT", "CLASS", "TOPIC_OR_SUBJECT", "VALUE", "DETAIL"]));
  for (const s of d.students) {
    out.push(line(["student", s.name, s.className, "", "", s.dob ? `born ${s.dob}` : ""]));
  }
  for (const s of d.submissions) {
    out.push(line([
      "submission", s.studentName, s.className, s.paperTitle,
      `${s.score}/${s.maxScore}`,
      // Null percent stays null; it is not a zero and not a zero-point-something.
      s.percent === null ? "no percentage — the paper carried no marks" : `${s.percent}% ${s.grade ?? ""}`,
    ]));
  }
  for (const a of d.answers) {
    out.push(line([
      "answer", a.studentName, a.className, a.paperTitle,
      `${a.awarded}/${a.maxMarks} (${a.outcome})`,
      `Q${a.questionNo} ${a.topic ?? ""} | ${a.question} | response: ${a.response || "(left blank)"}` +
      (a.needsReview ? " | needs a teacher's decision" : "") +
      (a.note ? ` | note: ${a.note}` : ""),
    ]));
  }
  for (const m of d.otherSubjects) {
    out.push(line(["other-subject", m.studentName, m.className, m.subject, `${m.marks}/${m.maxMarks}`, "context only — never used in mathematics"]));
  }
  for (const a of d.attendance) {
    out.push(line(["attendance", a.studentName, a.className, a.date, a.status, ""]));
  }
  return out.join("\n");
}

async function xlsx(d: NonNullable<Awaited<ReturnType<typeof buildSchoolExport>>>, filename: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Kapigyan";
  wb.created = new Date(d.generatedAt);

  const head = (ws: { columns: unknown; getRow: (n: number) => { font?: unknown; fill?: unknown } }, cols: { header: string; key: string; width: number }[]) => {
    ws.columns = cols;
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF0FA" } };
  };

  const info = wb.addWorksheet("What this is");
  info.columns = [{ width: 110 }];
  info.addRow(["Kapigyan data export"]).font = { bold: true, size: 14 };
  info.addRow([`School: ${d.school.name}`]);
  info.addRow([`Generated: ${d.generatedAt}`]);
  info.addRow([]);
  d.manifest.forEach((m) => info.addRow([m]));
  info.addRow([]);
  info.addRow([`Classes ${d.scope.classes} · Students ${d.scope.students} · Papers ${d.scope.papers} · Submissions ${d.scope.submissions} · Answers ${d.scope.answers}`]);

  const st = wb.addWorksheet("Students");
  head(st, [
    { header: "Class", key: "cls", width: 16 },
    { header: "Roll", key: "roll", width: 7 },
    { header: "Name", key: "name", width: 24 },
    { header: "Date of birth", key: "dob", width: 14 },
    { header: "Note", key: "note", width: 30 },
  ]);
  for (const s of d.students) {
    st.addRow({ cls: s.className, roll: s.rollNo ?? "", name: s.name, dob: s.dob ?? "", note: s.note ?? "" });
  }

  const sub = wb.addWorksheet("Test results");
  head(sub, [
    { header: "Paper", key: "paper", width: 28 },
    { header: "Class", key: "cls", width: 16 },
    { header: "Student", key: "name", width: 24 },
    { header: "Marks", key: "marks", width: 9 },
    { header: "%", key: "pct", width: 10 },
    { header: "Grade", key: "grade", width: 8 },
  ]);
  for (const s of d.submissions) {
    sub.addRow({
      paper: s.paperTitle, cls: s.className, name: s.studentName,
      marks: `${s.score}/${s.maxScore}`,
      // Left empty rather than zero when the paper carried no marks.
      pct: s.percent === null ? "" : s.percent,
      grade: s.grade ?? "",
    });
  }

  const ans = wb.addWorksheet("Every answer");
  head(ans, [
    { header: "Student", key: "name", width: 22 },
    { header: "Class", key: "cls", width: 14 },
    { header: "Paper", key: "paper", width: 26 },
    { header: "Q", key: "no", width: 5 },
    { header: "Topic", key: "topic", width: 26 },
    { header: "Question", key: "q", width: 52 },
    { header: "Response", key: "resp", width: 20 },
    // Blank is its own column value. Merging it with "wrong" here would lose
    // the distinction the whole analysis rests on.
    { header: "Outcome", key: "out", width: 10 },
    { header: "Awarded", key: "aw", width: 9 },
    { header: "Out of", key: "mx", width: 7 },
    { header: "Needs review", key: "rev", width: 13 },
    { header: "Teacher's note", key: "note", width: 30 },
  ]);
  for (const a of d.answers) {
    ans.addRow({
      name: a.studentName, cls: a.className, paper: a.paperTitle, no: a.questionNo,
      topic: a.topic ?? "", q: a.question, resp: a.response, out: a.outcome,
      aw: a.awarded, mx: a.maxMarks, rev: a.needsReview ? "yes" : "", note: a.note ?? "",
    });
  }

  const att = wb.addWorksheet("Attendance");
  head(att, [
    { header: "Date", key: "date", width: 13 },
    { header: "Class", key: "cls", width: 16 },
    { header: "Student", key: "name", width: 24 },
    { header: "Status", key: "st", width: 12 },
  ]);
  for (const a of d.attendance) att.addRow({ date: a.date, cls: a.className, name: a.studentName, st: a.status });

  const other = wb.addWorksheet("Other subjects");
  head(other, [
    { header: "Class", key: "cls", width: 16 },
    { header: "Student", key: "name", width: 24 },
    { header: "Subject", key: "sub", width: 18 },
    { header: "Marks", key: "marks", width: 9 },
    { header: "Out of", key: "mx", width: 8 },
  ]);
  for (const m of d.otherSubjects) other.addRow({ cls: m.className, name: m.studentName, sub: m.subject, marks: m.marks, mx: m.maxMarks });
  other.addRow([]);
  other.addRow(["Imported marks are context only and were never used in any mathematics calculation."]);

  const buf = await wb.xlsx.writeBuffer();
  return download(Buffer.from(buf), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename);
}

async function docx(d: NonNullable<Awaited<ReturnType<typeof buildSchoolExport>>>, filename: string) {
  const { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType, BorderStyle } = await import("docx");
  const cell = (text: string, bold = false) =>
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, size: 16 })] })] });
  const table = (head: string[], rows: string[][]) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: Object.fromEntries(["top", "bottom", "left", "right", "insideHorizontal", "insideVertical"].map((k) => [k, { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" }])),
      rows: [
        new TableRow({ tableHeader: true, children: head.map((h) => cell(h, true)) }),
        ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
      ],
    });

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 900, right: 900 } } },
      children: [
        new Paragraph({ text: "Data Export", heading: HeadingLevel.TITLE }),
        new Paragraph({ children: [new TextRun({ text: `${d.school.name} · ${d.generatedAt.slice(0, 10)}`, size: 20, color: "555555" })] }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "What this file is", heading: HeadingLevel.HEADING_2 }),
        ...d.manifest.map((m) => new Paragraph({ children: [new TextRun({ text: m, size: 20 })] })),
        new Paragraph({ text: "" }),
        new Paragraph({ text: `Classes ${d.scope.classes} · Students ${d.scope.students} · Papers ${d.scope.papers} · Submissions ${d.scope.submissions} · Answers ${d.scope.answers}`, children: [new TextRun({ bold: true, size: 20 })] }),
        new Paragraph({ text: "" }),
        new Paragraph({ text: "Test results", heading: HeadingLevel.HEADING_2 }),
        table(["Paper", "Class", "Student", "Marks", "%"],
          d.submissions.map((s) => [
            s.paperTitle, s.className, s.studentName, `${s.score}/${s.maxScore}`,
            s.percent === null ? "—" : `${s.percent}%`,
          ])),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  return download(Buffer.from(buf), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename);
}
