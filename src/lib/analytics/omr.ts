/**
 * OMR answer sheets.
 *
 * Marking thirty answer sheets by hand is the single largest block of a
 * teacher's week, and in most Indian schools the children are already used to
 * filling bubble sheets from competitive exams. The school owns the hardware;
 * what it does not have is software that reads them.
 *
 * ## What this does and does not do
 *
 * It produces a properly laid-out OMR sheet — bubbles large enough to fill
 * with a 2B pencil, a clear name block, and the sheet ID printed on every
 * page — and then takes answers typed or pasted in, one letter per question.
 * That is genuinely faster than the general marking page: a full sheet is one
 * short string rather than thirty form fields.
 *
 * **It does not read photographs.** Automatic bubble detection needs image
 * processing that this app does not have, and a misread bubble produces a
 * wrong mark on a child's report with no obvious way for anyone to notice. A
 * tool that silently guesses here is worse than no tool, so the boundary is
 * explicit rather than faked.
 *
 * The alternative — an OMR scanner that reports its confidence and asks a
 * human when it is unsure — is the right answer, and is deliberately left for
 * a real implementation rather than mocked.
 */

import { prisma } from "@/lib/db";
export { parseOmr } from "@/lib/omr-parse";

/** How many answer columns to lay out on one sheet. */
const COLUMNS = 2;

export type OmrSheet = {
  paperId: string;
  paperTitle: string;
  /** Only the questions a bubble sheet can actually carry. */
  questionNumbers: number[];
  /** Everything skipped, and why — a sheet must never hide a question. */
  skipped: { position: number; stem: string; reason: string }[];
  columns: OmrColumn[];
  studentCount: number;
  /** True when some questions could not go on the sheet. */
  partial: boolean;
  note: string | null;
};

export type OmrColumn = {
  /** 1-based question numbers in this column. */
  numbers: number[];
  options: ("A" | "B" | "C" | "D" | "E")[];
};

export async function buildOmr(paperId: string): Promise<OmrSheet> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true, title: true,
      class: { select: { name: true } },
      submissions: { select: { student: { select: { name: true, rollNo: true } } } },
      questions: {
        select: { position: true, stem: true, type: true, options: true, answerKey: true },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!paper) {
    return {
      paperId, paperTitle: "Not found", questionNumbers: [], skipped: [], columns: [],
      studentCount: 0, partial: false, note: "Paper not found.",
    };
  }

  const skipped: OmrSheet["skipped"] = [];
  const usable: number[] = [];
  const maxOptions = { A: false, B: false, C: false, D: false, E: false };

  for (const q of paper.questions) {
    const n = q.position + 1;
    if (q.type !== "mcq") {
      skipped.push({ position: n, stem: q.stem, reason: "Not multiple choice — a bubble sheet cannot carry it." });
      continue;
    }
    let opts: string[] = [];
    try {
      const parsed = JSON.parse(q.options);
      if (Array.isArray(parsed)) opts = parsed.map(String);
    } catch { /* an unparseable options list is treated as none */ }

    if (opts.length < 2) {
      skipped.push({ position: n, stem: q.stem, reason: "Fewer than two options to fill." });
      continue;
    }
    // The key has to be fillable, or the sheet would collect an answer the
    // teacher cannot mark. Better to leave the question off entirely.
    const keyLetters = opts.map((o) => o.trim().split(/[.)]/)[0]?.toUpperCase() ?? "").filter(Boolean);
    if (!keyLetters.includes(q.answerKey.trim().toUpperCase())) {
      skipped.push({ position: n, stem: q.stem, reason: `Key "${q.answerKey}" is not one of the options.` });
      continue;
    }
    keyLetters.slice(0, 5).forEach((l) => { if (l === "A" || l === "B" || l === "C" || l === "D" || l === "E") maxOptions[l] = true; });
    usable.push(n);
  }

  const options = (Object.keys(maxOptions) as (keyof typeof maxOptions)[]).filter((k) => maxOptions[k]) as OmrColumn["options"];
  const perColumn = Math.max(1, Math.ceil(usable.length / COLUMNS));
  const columns: OmrColumn[] = [];
  for (let i = 0; i < usable.length; i += perColumn) {
    columns.push({ numbers: usable.slice(i, i + perColumn), options });
  }

  const note = skipped.length === 0
    ? null
    : `${skipped.length} of ${paper.questions.length} questions are not on the sheet and must still be marked the usual way. They are listed on the printed page.`;

  return {
    paperId,
    paperTitle: paper.title,
    questionNumbers: usable,
    skipped,
    columns,
    studentCount: paper.submissions.length,
    partial: skipped.length > 0,
    note,
  };
}
