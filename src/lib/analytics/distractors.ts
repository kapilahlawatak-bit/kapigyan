/**
 * Distractor analysis.
 *
 * The success rate of a multiple-choice question tells you very little. A
 * question with four options and a 40% success rate could be:
 *
 *   - doing its job — most of the class holds a specific, nameable
 *     misconception, and the option they chose is the one built to catch it;
 *   - badly worded — a quarter of the class landed on the same wrong answer
 *     for reasons that have nothing to do with the skill;
 *   - noise — the wrong answers are scattered evenly, so the question is
 *     measuring something other than what it claims to.
 *
 * Only the first is useful, and the success rate cannot tell them apart. That
 * is what this module is for: a question that looks "hard" on a dashboard can
 * be a good diagnostic or a badly written one, and only the shape of the wrong
 * answers distinguishes them.
 */

import { prisma, parseJson } from "@/lib/db";
import { MISCONCEPTION_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import { inferMisconceptions } from "@/lib/intelligence/misconception-inference";

/**
 * Ask the real inference engine what the class's wrong answers mean.
 *
 * This matters more than it looks. "The whole class wrote the same wrong
 * answer" reads like a wording fault, but it is usually the opposite: it is
 * the strongest possible evidence that one shared idea is behind it. The
 * difference is only visible by naming the idea, so rather than guessing, run
 * the same detector the marking used and see whether it recognises anything.
 */
export function dominantMisconceptionFor(args: {
  stem: string;
  type: string;
  topicId: string | null;
  strand: string | null;
  markScheme?: string;
  responses: string[];
}): { id: string; name: string; count: number; share: number } | null {
  const votes = new Map<string, number>();
  for (const response of args.responses) {
    const out = inferMisconceptions({
      stem: args.stem,
      response,
      isWrong: true,
      type: args.type,
      topicId: args.topicId ?? "",
      strand: args.strand ?? "",
      diagnoses: [],
      markScheme: parseJson<Record<string, unknown>>(args.markScheme ?? "{}", {}),
    });
    // Only a confident, specific call counts. A vague guess should not be
    // able to promote a question to "diagnosing".
    const best = out.filter((o) => o.confidence >= 0.6).sort((a, b) => b.confidence - a.confidence)[0];
    if (best) votes.set(best.misconceptionId, (votes.get(best.misconceptionId) ?? 0) + 1);
  }
  const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || args.responses.length === 0) return null;
  const meta = MISCONCEPTION_BY_ID.get(top[0]);
  if (!meta) return null;
  return {
    id: top[0],
    name: meta.name,
    count: top[1],
    share: round3(top[1] / args.responses.length),
  };
}

export type DistractorRow = {
  key: string;
  label: string;
  chosen: number;
  /** Share of all answered. */
  share: number;
  isKey: boolean;
  misconceptionId: string | null;
  misconceptionName: string | null;
  /** How many children who *struggle* with this topic chose it, 0..1. */
  appealToStruggling: number;
  /**
   * Separation between children who know the topic and those who do not,
   * roughly 0..1. Above 0.5 means the option is chosen by the children it
   * was written to catch.
   */
  discrimination: number;
};

export type DistractorVerdict = "diagnosing" | "flawed" | "noisy" | "working" | "not_enough_data";

export type DistractorAnalysis = {
  paperId: string;
  questionId: string;
  stem: string;
  type: string;
  topicId: string | null;
  topicName: string;
  answerKey: string;
  isMcq: boolean;
  responses: number;
  correct: number;
  blank: number;
  successRate: number;
  options: DistractorRow[];
  verdict: DistractorVerdict;
  verdictNote: string;
  /** For written answers: the most common wrong thing the class wrote. */
  topWrongResponse: { response: string; count: number; share: number } | null;
};

/** "A. 12" → "A". Tolerates a bare array of keys, or an object form. */
function optionKey(raw: unknown): string {
  if (typeof raw === "string") return raw.replace(/^\s*([A-Za-z])\s*[.)\s].*$/, "$1");
  if (raw && typeof raw === "object" && "key" in raw) return String((raw as { key: unknown }).key);
  return "";
}

export async function analyseDistractors(paperId: string, questionId: string): Promise<DistractorAnalysis | null> {
  const pq = await prisma.paperQuestion.findUnique({
    where: { id: questionId },
    include: {
      answers: {
        select: {
          response: true,
          isCorrect: true,
          submission: { select: { studentId: true } },
        },
      },
    },
  });
  if (!pq) return null;

  const topicId = pq.topicId;
  const topicName = TOPIC_BY_ID.get(topicId ?? "")?.name ?? "Untagged";

  const answers = pq.answers;
  const correct = answers.filter((a) => a.isCorrect === true).length;
  const blank = answers.filter((a) => a.isCorrect === null).length;
  const graded = answers.length - blank;
  const successRate = graded > 0 ? Math.round((correct / graded) * 100) : 0;

  const base = {
    paperId,
    questionId,
    stem: pq.stem,
    type: pq.type,
    topicId,
    topicName,
    answerKey: pq.answerKey,
    responses: answers.length,
    correct,
    blank,
    successRate,
  };

  /* --- Who is secure on this topic? --------------------------------- */

  const topicScores = new Map<string, { got: number; total: number }>();
  if (topicId) {
    const topicAnswers = await prisma.answer.findMany({
      where: { submission: { paperId }, paperQuestion: { topicId } },
      select: {
        marksAwarded: true,
        maxMarks: true,
        submission: { select: { studentId: true } },
      },
    });
    for (const a of topicAnswers) {
      const e = topicScores.get(a.submission.studentId) ?? { got: 0, total: 0 };
      e.got += a.marksAwarded;
      e.total += a.maxMarks || 1;
      topicScores.set(a.submission.studentId, e);
    }
  }
  const secure = new Map<string, boolean>();
  for (const [studentId, e] of topicScores) {
    secure.set(studentId, e.total > 0 && e.got / e.total >= 0.6);
  }
  const secureCount = [...secure.values()].filter(Boolean).length;
  const strugglingCount = secure.size - secureCount;

  /* --- Multiple choice ---------------------------------------------- */

  const rawOptions = parseJson<unknown[]>(pq.options ?? "[]", []);
  const keys = rawOptions.map(optionKey).filter(Boolean);

  if (keys.length > 0) {
    const scheme = parseJson<{ optionDiagnosis?: Record<string, string> }>(pq.markScheme ?? "{}", {});
    const diagnosis = scheme.optionDiagnosis ?? {};

    const rows: DistractorRow[] = keys.map((key) => {
      const raw = rawOptions.find((o) => optionKey(o) === key);
      return {
        key,
        label: typeof raw === "string" ? raw.replace(/^\s*[A-Za-z]\s*[.)\s]/, "") : key,
        chosen: 0,
        share: 0,
        isKey: key.toUpperCase() === pq.answerKey.trim().toUpperCase(),
        misconceptionId: diagnosis[key] ?? null,
        misconceptionName: diagnosis[key] ? MISCONCEPTION_BY_ID.get(diagnosis[key])?.name ?? null : null,
        appealToStruggling: 0,
        discrimination: 0,
      };
    });

    for (const a of answers) {
      if (a.isCorrect === null) continue;
      const key = (a.response ?? "").trim().toUpperCase().replace(/[^\w]/g, "").slice(0, 1);
      const row = rows.find((r) => r.key.toUpperCase() === key);
      if (!row) continue;
      row.chosen += 1;
      if (!secure.get(a.submission.studentId)) row.appealToStruggling += 1;
    }

    for (const row of rows) {
      row.share = graded > 0 ? round3(row.chosen / graded) : 0;
      const byStruggling = strugglingCount > 0 ? row.appealToStruggling / strugglingCount : 0;
      const bySecure = secureCount > 0 ? row.chosen - row.appealToStruggling : 0;
      const secureShare = secureCount > 0 ? bySecure / secureCount : 0;
      // 0.5 = chosen equally by both groups, i.e. tells you nothing.
      row.discrimination = round3(clamp01(0.5 + (byStruggling - secureShare)));
      row.appealToStruggling = round3(clamp01(byStruggling));
    }

    const wrong = rows.filter((r) => !r.isKey && r.chosen > 0);
    const totalWrong = wrong.reduce((a, r) => a + r.chosen, 0);
    const best = [...wrong].sort((a, b) => b.chosen - a.chosen)[0];
    const concentration = best && totalWrong > 0 ? best.chosen / totalWrong : 0;

    // When the class converges on an unauthored option, do not assume bad
    // wording — ask the detector whether it recognises the error. A named
    // misconception means the question is diagnosing, and rewriting it would
    // throw away the most useful question in the paper.
    const detected = best && !best.misconceptionId && totalWrong >= 3
      ? dominantMisconceptionFor({
          stem: pq.stem,
          type: pq.type,
          topicId,
          strand: pq.strand,
          markScheme: pq.markScheme ?? "{}",
          responses: answers.filter((a) => a.isCorrect === false).map((a) => a.response ?? ""),
        })
      : null;

    let verdict: DistractorVerdict;
    let verdictNote: string;

    if (graded < 5) {
      verdict = "not_enough_data";
      verdictNote = `Only ${graded} ${graded === 1 ? "child" : "children"} answered, so there is no pattern to read yet.`;
    } else if (successRate >= 90) {
      verdict = "working";
      verdictNote = "Almost everyone has this. It is not telling you much about the class.";
    } else if (best && concentration >= 0.5 && best.misconceptionId) {
      verdict = "diagnosing";
      verdictNote = `${Math.round(concentration * 100)}% of the wrong answers went to option ${best.key}, which was written to catch "${best.misconceptionName}". This question is working as intended.`;
    } else if (detected && detected.share >= 0.5) {
      verdict = "diagnosing";
      verdictNote = `${Math.round(detected.share * 100)}% of the wrong answers share one idea — "${detected.name}". The option itself was not authored for it, but the class is consistent, so this question is diagnosing. Tag the option so this is picked up automatically next time.`;
    } else if (best && concentration >= 0.5) {
      verdict = "flawed";
      verdictNote = `${Math.round(concentration * 100)}% of the class chose option ${best.key}, and nothing recognises the error. One shared wrong answer with no explanation behind it is more often the wording than the children — read the question before using it again.`;
    } else {
      verdict = "noisy";
      verdictNote = `The wrong answers are spread across ${wrong.length} options instead of concentrating on one. This question is not pointing at a specific idea.`;
    }

    return {
      ...base,
      isMcq: true,
      options: rows.sort((a, b) => b.chosen - a.chosen || (a.isKey ? -1 : 1)),
      verdict,
      verdictNote,
      topWrongResponse: null,
    };
  }

  /* --- Written answers: look at the text instead -------------------- */

  const groups = new Map<string, number>();
  for (const a of answers) {
    if (a.isCorrect !== false) continue;
    const key = (a.response ?? "").trim().toLowerCase();
    if (!key) continue;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const totalWrong = [...groups.values()].reduce((a, b) => a + b, 0);
  const top = [...groups.entries()].sort((a, b) => b[1] - a[1])[0];
  const distinct = groups.size;

  // Same rule as the multiple-choice branch: a shared wrong answer is a
  // diagnosis until proven otherwise, so ask the detector before telling a
  // teacher to go and rewrite their question.
  const detected = totalWrong >= 3
    ? dominantMisconceptionFor({
        stem: pq.stem,
        type: pq.type,
        topicId,
        strand: pq.strand,
        markScheme: pq.markScheme ?? "{}",
        responses: answers.filter((a) => a.isCorrect === false).map((a) => a.response ?? ""),
      })
    : null;

  let verdict: DistractorVerdict;
  let verdictNote: string;

  if (totalWrong < 3) {
    verdict = "not_enough_data";
    verdictNote = "Not enough wrong answers to see a pattern.";
  } else if (detected && detected.share >= 0.5) {
    verdict = "diagnosing";
    verdictNote = `${Math.round(detected.share * 100)}% of the wrong answers point at one idea — "${detected.name}" (${detected.count} children). That is a shared misconception, not a badly worded question.`;
  } else if (distinct === 1) {
    verdict = "flawed";
    verdictNote = `Every wrong answer is identical — "${top![0]}" — and nothing recognises it. One shared answer with no idea behind it points at the wording. Read the question before using it again.`;
  } else if (top && top[1] / totalWrong >= 0.5) {
    verdict = "diagnosing";
    verdictNote = `${Math.round((top[1] / totalWrong) * 100)}% of the wrong answers are the same ("${top[0]}"). That is one shared idea rather than a scatter, so the question is diagnosing.`;
  } else if (distinct >= 5) {
    verdict = "noisy";
    verdictNote = `${distinct} different wrong answers. The children are not making the same mistake, so the question is not telling you what it claims to.`;
  } else {
    verdict = "working";
    verdictNote = "The wrong answers are spread out, and there is no dominant error to teach against.";
  }

  return {
    ...base,
    isMcq: false,
    options: [],
    verdict,
    verdictNote,
    topWrongResponse: top
      ? { response: top[0], count: top[1], share: round3(top[1] / totalWrong) }
      : null,
  };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
