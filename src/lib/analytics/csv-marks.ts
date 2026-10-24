/**
 * Importing marks for subjects this app does not teach.
 *
 * A school's real mark sheet does not stop at mathematics. A teacher has
 * English, Hindi, EVS and Science in the same register, and a principal wants
 * one report. Right now none of that is in here.
 *
 * So this accepts an existing mark sheet and stores it as context — *not* as
 * assessed mathematics. That boundary is the whole design:
 *
 * - These marks are **never** mixed into mastery, the misconception engine, or
 *   the risk score. There is no evidence here about how a child reasons.
 * - They are **never** analysed for errors, because there is no marking scheme
 *   to compare against and inventing one would be fabrication.
 * - They are shown as a context column on the student page, and exported with
 *   the rest.
 *
 * That is a deliberately small promise, and it is one the app can actually
 * keep.
 *
 * ## Parsing is defensive
 *
 * Real school spreadsheets are messy: a name with a stray space, a blank
 * total, a subject column named "Marks (Eng)". Every row that cannot be read
 * is reported back with its line number rather than silently dropped, because
 * a teacher who imports thirty rows and gets twenty-six needs to know which
 * four.
 */

export type ImportedRow = {
  line: number;
  studentName: string;
  subject: string;
  marks: number | null;
  maxMarks: number | null;
  /** Set when the row could not be read. The row is never dropped silently. */
  problem: string | null;
};

export type ParseResult = {
  rows: ImportedRow[];
  good: ImportedRow[];
  problems: ImportedRow[];
  subjects: string[];
  /** True when the file had no header we could recognise at all. */
  noHeader: boolean;
};

const SUBJECT_ALIASES: Record<string, string> = {
  eng: "English", english: "English",
  hin: "Hindi", hindi: "Hindi",
  evs: "EVS", "environmental studies": "EVS",
  sci: "Science", science: "Science",
  math: "Mathematics", mathematics: "Mathematics", maths: "Mathematics",
  sst: "Social Studies", "social studies": "Social Studies", "social science": "Social Studies",
  hin_math: "Hindi", "hindi maths": "Hindi",
  computer: "Computer", comp: "Computer",
  art: "Art", drawing: "Art",
  pe: "Physical Education", games: "Physical Education",
};

function isHeader(cell: string): boolean {
  return /^(name|student|student name|pupil)/i.test(cell.trim());
}

function findColumn(header: string[], ...patterns: RegExp[]): number {
  return header.findIndex((h) => patterns.some((p) => p.test(h)));
}

function canonicalSubject(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\(.*\)/g, "").trim();
  return SUBJECT_ALIASES[key] ?? (raw.trim() || "Unspecified");
}

/**
 * Parse a CSV of `name,subject,marks,max`.
 *
 * Deliberately not a full RFC 4180 parser: quoted fields containing commas
 * are the one case school spreadsheets produce, and those are handled.
 */
export function parseMarksCsv(text: string): ParseResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) {
    return { rows: [], good: [], problems: [], subjects: [], noHeader: true };
  }

  const split = (line: string): string[] => {
    const out: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) {
        out.push(cell); cell = "";
      } else cell += ch;
    }
    out.push(cell);
    return out.map((c) => c.trim());
  };

  let start = 0;
  let header = split(lines[0]!);
  let noHeader = false;
  if (!header.some(isHeader)) {
    // No header row — assume the documented column order and say so, rather
    // than guessing silently and shifting every column.
    noHeader = true;
    header = ["name", "subject", "marks", "max"];
    start = -1;
  }

  const nameCol = header.findIndex(isHeader);
  const subjectCol = findColumn(header, /subject|subjects/i);
  const marksCol = findColumn(header, /^(marks?|score|obtained|got)(?!\s*max)/i, /\bmarks?\b/i);
  const maxCol = findColumn(header, /\bmax|out\s*of|total|maximum/i);

  const rows: ImportedRow[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const cells = split(lines[i]!);
    const line = i + 1;
    const name = (cells[nameCol] ?? "").replace(/\s+/g, " ").trim();
    const subject = canonicalSubject(cells[subjectCol] ?? "");

    if (!name) {
      rows.push({ line, studentName: "", subject, marks: null, maxMarks: null, problem: "No name in this row." });
      continue;
    }
    if (subject === "Unspecified") {
      rows.push({ line, studentName: name, subject: "Unspecified", marks: null, maxMarks: null, problem: "No subject column found." });
      continue;
    }

    const rawMarks = cells[marksCol];
    const rawMax = cells[maxCol];
    const marks = rawMarks === undefined || rawMarks === "" ? null : Number(rawMarks);
    const maxMarks = rawMax === undefined || rawMax === "" ? null : Number(rawMax);

    let problem: string | null = null;
    if (marks === null) problem = "No marks value.";
    else if (!Number.isFinite(marks)) problem = `"${rawMarks}" is not a number.`;
    else if (marksCol === -1) problem = "No marks column found in the header.";
    else if (maxMarks !== null && Number.isFinite(maxMarks) && marks > maxMarks) {
      problem = `Got ${marks} out of ${maxMarks}, which is impossible — check the row.`;
      rows.push({ line, studentName: name, subject, marks, maxMarks, problem });
      continue;
    } else if (marks < 0) {
      problem = "Negative marks.";
    }

    rows.push({ line, studentName: name, subject, marks, maxMarks, problem });
  }

  return {
    rows,
    good: rows.filter((r) => r.problem === null),
    problems: rows.filter((r) => r.problem !== null),
    subjects: [...new Set(rows.map((r) => r.subject))].filter((s) => s !== "Unspecified").sort(),
    noHeader,
  };
}

/** Match an imported name to a student, tolerating the differences real files have. */
export function nameMatches(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\b(mr|mrs|ms|miss|shri|smt)\b/g, "").replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}
