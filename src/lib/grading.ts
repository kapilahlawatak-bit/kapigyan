/**
 * Auto-grading.
 *
 * Marks a set of responses against a paper, and — crucially — records *why*
 * each wrong answer was wrong, because that is what every downstream feature
 * (gap analysis, heatmaps, the parent's report, the next practice set) is
 * built on.
 *
 * Design rules:
 *  - Never silently guess. Anything the rules are not confident about is
 *    flagged `needsReview` and left for a human, with the marks as computed so
 *    far. A teacher must always be able to see the machine's work.
 *  - A blank is not a wrong answer. It is recorded as `isCorrect: null` and
 *    excluded from misconception analysis, because "did not attempt" and
 *    "attempted with a misconception" call for completely different teaching.
 *  - Partial credit is real. `medium` and `picture` questions can earn a
 *    fraction when the method is right and only the arithmetic is wrong.
 */

import {
  answersMatch,
  gradeFreeText,
  normalise,
  splitParts,
  toNumber,
  type MarkScheme,
} from "@/lib/answer-normaliser";
import { inferMisconceptions } from "@/lib/intelligence/misconception-inference";
import { parseJson } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type QuestionToGrade = {
  id: string;
  type: string;
  stem: string;
  options: string;
  answerKey: string;
  accepted: string;
  markScheme: string;
  topicId: string | null;
  strand: string;
  competency: string;
  marks: number;
};

export type ResponseToGrade = {
  paperQuestionId: string;
  response: string;
};

export type GradedAnswer = {
  paperQuestionId: string;
  response: string;
  /** null when blank. */
  isCorrect: boolean | null;
  marksAwarded: number;
  maxMarks: number;
  /** Misconception id, when one could be identified. */
  errorTag: string | null;
  /** Plain-language reason for the tag. */
  reason: string | null;
  confidence: number;
  needsReview: boolean;
  /** Method was right, arithmetic wrong — worth surfacing to the teacher. */
  methodCredit: boolean;
};

export type GradingResult = {
  answers: GradedAnswer[];
  score: number;
  maxScore: number;
  percentage: number;
  /** Share of marks the marker must still decide. */
  manualShare: number;
  counts: { correct: number; wrong: number; blank: number; partial: number };
  topicBreakdown: Record<string, { score: number; max: number; attempts: number; correct: number }>;
  misconceptionCounts: Record<string, number>;
};

/* ------------------------------------------------------------------ */
/* Per-type marking                                                    */
/* ------------------------------------------------------------------ */

/** Below this, the machine is guessing and should defer to a person. */
const REVIEW_THRESHOLD = 0.55;

function gradeOne(
  q: QuestionToGrade,
  rawResponse: string,
): Omit<GradedAnswer, "errorTag" | "reason"> & { inferences: { misconceptionId: string; confidence: number; reason: string }[] } {
  const response = (rawResponse ?? "").trim();
  const accepted = parseJson<string[]>(q.accepted, []);
  const scheme = parseJson<MarkScheme & { optionDiagnosis?: Record<string, string> }>(q.markScheme, {});

  // Blank is its own case and never becomes a misconception.
  if (!response) {
    return {
      paperQuestionId: q.id,
      response: "",
      isCorrect: null,
      marksAwarded: 0,
      maxMarks: q.marks,
      confidence: 1,
      needsReview: false,
      methodCredit: false,
      inferences: [],
    };
  }

  switch (q.type) {
    /* -------- multiple choice -------- */
    case "mcq": {
      const options = parseJson<string[]>(q.options, []);
      const given = normalise(response);
      const correct = answersMatch(response, q.answerKey);
      return {
        paperQuestionId: q.id,
        response,
        isCorrect: correct,
        marksAwarded: correct ? q.marks : 0,
        maxMarks: q.marks,
        confidence: options.length > 0 ? 0.98 : 0.7,
        needsReview: false,
        methodCredit: false,
        inferences: correct
          ? []
          : inferMisconceptions({
              stem: q.stem,
              response,
              isWrong: true,
              type: q.type,
              topicId: q.topicId,
              strand: q.strand,
              diagnoses: parseJson<string[]>(scheme.optionDiagnosis ? JSON.stringify(Object.values(scheme.optionDiagnosis)) : "[]", []),
              markScheme: scheme,
              options,
            }),
      };
    }

    /* -------- true / false -------- */
    case "true_false": {
      const given = normalise(response);
      const expected = normalise(q.answerKey);
      // Guard: "1" and "0" are valid true/false marks but also valid numbers.
      const correct = given === expected;
      return {
        paperQuestionId: q.id,
        response,
        isCorrect: correct,
        marksAwarded: correct ? q.marks : 0,
        maxMarks: q.marks,
        confidence: 0.95,
        needsReview: false,
        methodCredit: false,
        inferences: correct ? [] : inferMisconceptions({ stem: q.stem, response, isWrong: true, type: q.type, topicId: q.topicId, strand: q.strand, diagnoses: parseJson<string[]>(scheme.steps ? "[]" : "[]", []) }),
      };
    }

    /* -------- match the following -------- */
    case "match": {
      // Response is "1-b, 2-c" or "1b 2c". One mark per correct pair.
      const pairs = parseJson<{ left: string; right: string }[]>(q.options, []);
      const given = response
        .split(/[,;/\n]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const m = p.match(/(\w+)\s*[-–>→=:]?\s*(\w+)/);
          return m ? { left: normalise(m[1]), right: normalise(m[2]) } : { left: normalise(p), right: "" };
        });

      let got = 0;
      pairs.forEach((pair, i) => {
        const g = given[i];
        if (g && g.left === normalise(pair.left) && g.right === normalise(pair.right)) got += 1;
        else if (g && g.left === normalise(pair.left) && g.right === normalise(pair.right.replace(/\s/g, ""))) got += 1;
      });

      const perPair = pairs.length > 0 ? q.marks / pairs.length : 0;
      const marksAwarded = Math.round(got * perPair * 100) / 100;
      const correct = got === pairs.length;
      return {
        paperQuestionId: q.id,
        response,
        isCorrect: correct,
        marksAwarded,
        maxMarks: q.marks,
        confidence: pairs.length > 0 && given.length === pairs.length ? 0.9 : 0.5,
        needsReview: given.length !== pairs.length,
        methodCredit: false,
        inferences: [],
      };
    }

    /* -------- fill in the blank, very short answer -------- */
    case "fill_blank":
    case "short":
    case "picture": {
      const result = gradeExactLike(response, q, accepted);
      return {
        paperQuestionId: q.id,
        response,
        isCorrect: result.correct,
        marksAwarded: result.correct ? q.marks : 0,
        maxMarks: q.marks,
        confidence: 0.92,
        needsReview: false,
        methodCredit: false,
        inferences: result.correct
          ? []
          : inferMisconceptions({
              stem: q.stem,
              response,
              isWrong: true,
              type: q.type,
              topicId: q.topicId,
              strand: q.strand,
              diagnoses: [],
              markScheme: scheme,
            }),
      };
    }

    /* -------- short answer: method marks possible -------- */
    case "medium": {
      const res = gradeFreeText(response, scheme, q.marks);
      if (res.correct) {
        return {
          paperQuestionId: q.id, response, isCorrect: true, marksAwarded: res.marksAwarded,
          maxMarks: q.marks, confidence: res.confidence, needsReview: false, methodCredit: false, inferences: [],
        };
      }
      // If the expected answer is a plain number, try an exact match first —
      // a child who wrote the right number should not lose to a mark scheme.
      const exact = gradeExactLike(response, q, accepted);
      if (exact.correct) {
        return {
          paperQuestionId: q.id, response, isCorrect: true, marksAwarded: q.marks,
          maxMarks: q.marks, confidence: 0.95, needsReview: false, methodCredit: false, inferences: [],
        };
      }
      return {
        paperQuestionId: q.id,
        response,
        isCorrect: false,
        marksAwarded: res.marksAwarded,
        maxMarks: q.marks,
        confidence: res.confidence,
        needsReview: res.needsReview,
        methodCredit: res.methodCredit,
        inferences: inferMisconceptions({
          stem: q.stem, response, isWrong: true, type: q.type,
          topicId: q.topicId, strand: q.strand, diagnoses: [], markScheme: scheme,
        }),
      };
    }

    /* -------- long answer: rubric, always reviewed -------- */
    case "long":
    default: {
      const res = gradeFreeText(response, scheme, q.marks);
      return {
        paperQuestionId: q.id,
        response,
        isCorrect: res.correct,
        marksAwarded: res.marksAwarded,
        maxMarks: q.marks,
        confidence: res.confidence,
        // Long answers are marked by a person by definition.
        needsReview: true,
        methodCredit: res.methodCredit,
        inferences: inferMisconceptions({
          stem: q.stem, response, isWrong: true, type: q.type,
          topicId: q.topicId, strand: q.strand, diagnoses: [], markScheme: scheme,
        }),
      };
    }
  }
}

/** Exact match with the accepted-answer list, plus a numeric special case. */
function gradeExactLike(
  response: string,
  q: QuestionToGrade,
  accepted: string[],
): { correct: boolean; methodCredit: boolean } {
  const targets = [q.answerKey, ...accepted].filter(Boolean);
  if (targets.length === 0) return { correct: false, methodCredit: false };

  if (targets.some((t) => answersMatch(response, t))) return { correct: true, methodCredit: false };

  // A multi-part answer such as "12 and 15" is fully correct if every part
  // matches a target, or if the targets themselves are the parts.
  const targetParts = splitParts(targets.join(", "));
  const givenParts = splitParts(response);
  if (targetParts.length > 1 && givenParts.length === targetParts.length) {
    const matched = targetParts.filter((t) => givenParts.includes(t)).length;
    if (matched === targetParts.length) return { correct: true, methodCredit: false };
    if (matched >= Math.ceil(targetParts.length / 2)) {
      return { correct: false, methodCredit: true };
    }
  }

  // Numeric with a unit or a sign the child did not write exactly.
  const givenNum = toNumber(response);
  const targetNum = toNumber(targets[0]);
  if (givenNum !== null && targetNum !== null) {
    if (Math.abs(givenNum - targetNum) < 1e-9) return { correct: true, methodCredit: false };
    // Off by one digit, a common regrouping slip — method credit.
    if (Math.abs(Math.abs(givenNum) - Math.abs(targetNum)) === 1) {
      return { correct: false, methodCredit: true };
    }
  }

  return { correct: false, methodCredit: false };
}

/* ------------------------------------------------------------------ */
/* Whole-submission marking                                            */
/* ------------------------------------------------------------------ */

export function gradeSubmission(
  questions: QuestionToGrade[],
  responses: ResponseToGrade[],
): GradingResult {
  const byId = new Map(responses.map((r) => [r.paperQuestionId, r.response]));
  const answers: GradedAnswer[] = [];
  const topicBreakdown: GradingResult["topicBreakdown"] = {};
  const misconceptionCounts: Record<string, number> = {};

  let score = 0;
  let maxScore = 0;
  let manualMarks = 0;
  const counts = { correct: 0, wrong: 0, blank: 0, partial: 0 };

  for (const q of questions) {
    const raw = byId.get(q.id) ?? "";
    const g = gradeOne(q, raw);

    // Attach the strongest inferred misconception.
    let errorTag: string | null = null;
    let reason: string | null = null;
    if (g.isCorrect === false && g.inferences.length > 0) {
      const best = g.inferences[0];
      if (best.confidence >= REVIEW_THRESHOLD) {
        errorTag = best.misconceptionId;
        reason = best.reason;
        misconceptionCounts[best.misconceptionId] = (misconceptionCounts[best.misconceptionId] ?? 0) + 1;
      }
    }

    answers.push({
      paperQuestionId: g.paperQuestionId,
      response: g.response,
      isCorrect: g.isCorrect,
      marksAwarded: g.marksAwarded,
      maxMarks: g.maxMarks,
      errorTag,
      reason,
      confidence: g.confidence,
      needsReview: g.needsReview,
      methodCredit: g.methodCredit,
    });

    score += g.marksAwarded;
    maxScore += q.marks;
    if (g.needsReview) manualMarks += q.marks;

    if (g.isCorrect === null) counts.blank += 1;
    else if (g.isCorrect) counts.correct += 1;
    else if (g.marksAwarded > 0) counts.partial += 1;
    else counts.wrong += 1;

    const key = q.topicId ?? "untagged";
    const bucket = (topicBreakdown[key] ??= { score: 0, max: 0, attempts: 0, correct: 0 });
    bucket.score += g.marksAwarded;
    bucket.max += q.marks;
    bucket.attempts += 1;
    if (g.isCorrect) bucket.correct += 1;
  }

  // Round to a quarter mark, the smallest unit a primary paper realistically uses.
  score = Math.round(score * 4) / 4;

  return {
    answers,
    score,
    maxScore,
    percentage: maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : 0,
    manualShare: maxScore > 0 ? Math.round((manualMarks / maxScore) * 100) / 100 : 0,
    counts,
    topicBreakdown,
    misconceptionCounts,
  };
}
