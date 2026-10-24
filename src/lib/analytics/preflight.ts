/**
 * Pre-flight check.
 *
 * A paper is printed, photocopied and given to thirty children. By the time a
 * teacher discovers the answer key is wrong on question 7, the damage is done
 * and unfixable. Every other quality tool in this app works *after* the test;
 * this one works before, which is the only point where it is cheap.
 *
 * It does not block. A teacher who knowingly wants an open-ended paper can
 * teach it — but the app says plainly what it found, so the decision is
 * informed rather than accidental.
 *
 * ## What it checks
 *
 * The checks are chosen by how badly each one ruins a paper, not by how easy
 * they are to compute:
 *
 * - **No answer key.** Fatal, and trivially avoidable.
 * - **An MCQ with no options**, or options that do not include the key. A
 *   child cannot answer this correctly even if they understand it.
 * - **More than one correct option** in an MCQ. Also unanswerable, and the
 *   child who spots it is penalised for thinking.
 * - **Duplicate stems** — the same question twice, wasting marks and looking
 *   careless to a parent.
 * - **A very long paper.** Class 3 with 40 questions is not a test, it is a
 *   punishment, and the marks stop meaning anything.
 * - **A topic taught after the test date** — the clearest sign a plan slipped.
 * - **Every question on one topic**, so a low score measures the topic and
 *   nothing else.
 */

import { prisma } from "@/lib/db";
import { TOPIC_BY_ID } from "@/lib/curriculum";

export type PreflightLevel = "fatal" | "serious" | "worth_a_look";

export type PreflightFinding = {
  level: PreflightLevel;
  title: string;
  detail: string;
  /** 1-based position in the paper, when the finding is about one question. */
  position?: number;
};

export type PreflightReport = {
  paperId: string;
  findings: PreflightFinding[];
  /** True only when something makes the paper unusable as printed. */
  canRun: boolean;
  summary: string;
  questionCount: number;
  totalMarks: number;
};

/** Marks a class can plausibly finish, by grade. Beyond this, scores distort. */
const MAX_SENSIBLE_QUESTIONS: Record<number, number> = { 1: 8, 2: 10, 3: 14, 4: 18, 5: 20 };

function parseList(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function preflight(paperId: string): Promise<PreflightReport> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: {
      id: true, title: true, date: true,
      class: { select: { id: true, name: true, grade: true } },
      questions: {
        select: {
          id: true, position: true, stem: true, type: true, marks: true,
          answerKey: true, accepted: true, options: true, topicId: true,
        },
        orderBy: { position: "asc" },
      },
    },
  });
  if (!paper) return { paperId, findings: [], canRun: true, summary: "Paper not found.", questionCount: 0, totalMarks: 0 };

  const findings: PreflightFinding[] = [];
  const grade = paper.class?.grade ?? 3;
  const add = (level: PreflightLevel, title: string, detail: string, position?: number) =>
    findings.push({ level, title, detail, ...(position !== undefined ? { position } : {}) });

  if (paper.questions.length === 0) {
    add("fatal", "The paper is empty", "There are no questions on it. Nothing to print.");
  }

  // --- Per-question checks ---------------------------------------------
  const stemCounts = new Map<string, number[]>();
  for (const q of paper.questions) {
    const key = q.stem.trim().toLowerCase().replace(/\s+/g, " ");
    if (key) (stemCounts.get(key) ?? stemCounts.set(key, []).get(key)!).push(q.position + 1);

    if (!q.answerKey.trim()) {
      add("fatal", "A question has no answer key", "It cannot be marked, and the analysis it feeds will be wrong.", q.position + 1);
    }

    if (q.type === "mcq") {
      const options = parseList(q.options);
      const accepted = parseList(q.accepted);
      const keys = new Set([q.answerKey.trim(), ...accepted].map((k) => k.toUpperCase()));

      if (options.length === 0) {
        add("fatal", "A multiple-choice question has no options", "Children cannot choose between nothing.", q.position + 1);
        continue;
      }
      const missing = [...keys].filter((k) => !options.some((o) => o.trim().toUpperCase().startsWith(k)));
      if (missing.length > 0) {
        add(
          "fatal",
          "The answer key is not among the options",
          `Key is ${missing.join(", ")} but the options are ${options.map((o) => o.trim().split(/[.)]/)[0]).join(", ")}. Every child would be marked wrong.`,
          q.position + 1,
        );
      }

      // A second correct option is nearly as bad: the child who spots it loses.
      const correct = options.filter((o) => {
        const letter = o.trim().split(/[.)]/)[0]?.toUpperCase() ?? "";
        return keys.has(letter);
      });
      if (correct.length > 1) {
        add(
          "serious",
          "More than one option is marked correct",
          `${correct.length} options match the key. The child who notices this is penalised for thinking.`,
          q.position + 1,
        );
      }
      const dupes = options.map((o) => o.trim().toLowerCase()).filter((o, i, arr) => arr.indexOf(o) !== i);
      if (dupes.length > 0) {
        add("worth_a_look", "Repeated options", `"${dupes[0]}" appears more than once.`, q.position + 1);
      }
    }

    if (q.marks <= 0) {
      add("serious", "A question is worth no marks", "It will not affect any score.", q.position + 1);
    }

    if (q.stem.trim().length < 8) {
      add("worth_a_look", "A question stem looks unfinished", `"${q.stem.trim()}"`, q.position + 1);
    }

    if (!q.topicId) {
      add("serious", "A question has no topic", "It will be marked but never appear in the topic analysis.", q.position + 1);
    } else if (!TOPIC_BY_ID.has(q.topicId)) {
      add("serious", "A question points at a topic that does not exist", `Topic id "${q.topicId}" is not in the curriculum.`, q.position + 1);
    }
  }

  for (const [, positions] of stemCounts) {
    if (positions.length > 1) {
      add("serious", "The same question appears twice", `Positions ${positions.join(" and ")}. Marks are wasted and a parent will notice.`, positions[0]);
    }
  }

  // --- Whole-paper checks ----------------------------------------------
  const cap = MAX_SENSIBLE_QUESTIONS[grade] ?? 15;
  if (paper.questions.length > cap) {
    add(
      "serious",
      "The paper is longer than the class can finish",
      `${paper.questions.length} questions for Class ${grade}. A sensible maximum is about ${cap}; past that the score measures stamina as much as understanding.`,
    );
  }

  const topicCounts = new Map<string, number>();
  for (const q of paper.questions) if (q.topicId) topicCounts.set(q.topicId, (topicCounts.get(q.topicId) ?? 0) + 1);
  if (paper.questions.length >= 4 && topicCounts.size === 1) {
    const only = [...topicCounts.keys()][0]!;
    add(
      "worth_a_look",
      "Every question is on one topic",
      `${TOPIC_BY_ID.get(only)?.name ?? only} only. That is a fine diagnostic paper, but the result will say nothing about the rest of the term.`,
    );
  }

  // Taught after the test date: the plan slipped and nobody noticed.
  if (paper.class?.id) {
    const after = await prisma.taughtSession.findMany({
      where: { classId: paper.class.id, taughtAt: { gt: paper.date } },
      select: { topicId: true, taughtAt: true },
      take: 5,
    });
    const lateTopics = [...new Set(after.map((a) => a.topicId))];
    const askedLate = lateTopics.filter((t) => topicCounts.has(t));
    if (askedLate.length > 0) {
      add(
        "serious",
        "The paper tests topics recorded as taught after the test date",
        askedLate.map((t) => TOPIC_BY_ID.get(t)?.name ?? t).join(", ") + " — check the test date, or children were asked about something not yet covered.",
      );
    }
  }

  const fatal = findings.filter((f) => f.level === "fatal").length;
  const serious = findings.filter((f) => f.level === "serious").length;
  const canRun = fatal === 0;

  const summary =
    findings.length === 0
      ? "This paper looks sound. Nothing found that would spoil it."
      : fatal > 0
        ? `${fatal} ${fatal === 1 ? "problem" : "problems"} that would make this paper unusable as printed. Fix these before copying it.`
        : serious > 0
          ? `${serious} ${serious === 1 ? "issue" : "issues"} to look at before you print. Not fatal, but worth two minutes.`
          : `${findings.length} minor ${findings.length === 1 ? "thing" : "things"} to look at.`;

  return {
    paperId,
    findings,
    canRun,
    summary,
    questionCount: paper.questions.length,
    totalMarks: paper.questions.reduce((a, q) => a + q.marks, 0),
  };
}
