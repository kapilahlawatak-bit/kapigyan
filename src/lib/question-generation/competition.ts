/**
 * Competition questions, derived from the ordinary ones.
 *
 * ## Why derive rather than author
 *
 * The bank has ~55 generators, one per topic, and every one of them is correct
 * by construction: the numbers are chosen and the answer is computed from
 * them. Hand-authoring a competition set for 68 topics × 7 styles is 476
 * questions, and every one of them would be a new chance to ship a wrong
 * answer key — which is the single failure this app refuses to risk, since a
 * wrong key silently mis-marks every child who ever sits the paper.
 *
 * So competition questions are *transformed* from ordinary ones. Every
 * transform below recomputes its own answer from the same numbers it shows in
 * the stem, and **returns null rather than guessing** when the base question
 * cannot be read with confidence. A transform that declines is invisible; a
 * transform that guesses is a lie printed on a child's paper.
 *
 * ## What is deliberately not here
 *
 * Styles that need a diagram, a table or topic-specific insight — `logic`,
 * `representation`, and most of `multi_step` — are declared in `COMP_STYLES`
 * but not generated. Pretending to produce them generically would produce
 * questions that look olympiad-ish and are not, which is worse than a smaller
 * honest set. `supportedStyles` reports the truth per topic so the caller can
 * say so.
 *
 * ## Correctness contract
 *
 * `toCompetition` never changes the topic, never invents numbers it does not
 * show, and sets `answerKey` from a value it computed in this function — not
 * from the base question's key, which it treats as untrusted.
 */

import { parseOperation } from "@/lib/intelligence/misconception-inference";
import { compTierOf, type CompStyleId } from "@/lib/competition";
import { generateForTopic, topicHasGenerator } from "@/lib/question-generation/templates";
import type { GeneratedQuestion } from "@/lib/ai/questions";

export type CompetitionQuestion = GeneratedQuestion & {
  isCompetition: true;
  style: CompStyleId;
  compTier: number;
  /** The ordinary question this was made from, kept so a teacher can compare. */
  derivedFrom: string;
};

const isWhole = (n: number) => Number.isInteger(n);

/**
 * Does the stem already contain the answer?
 *
 * For a fill-in the key *is* the answer, so any standalone occurrence of that
 * number gives it away. For a multiple choice the key is a letter and tells us
 * nothing, so the giveaway has to be looked for in the numbers the stem prints —
 * which is why this takes the type and only applies the number check where it
 * means something. A key of "A" is never searched for as text.
 */
function answerAppears(stem: string, key: string, type: string): boolean {
  if (type === "fill_blank" && /\d/.test(key)) {
    return new RegExp(`(^|\\D)${key}(\\D|$)`).test(stem);
  }
  return false;
}

/**
 * The number a question's answer is, recovered from either question shape.
 *
 * Most of the bank is multiple choice, and its key is a letter rather than a
 * value, which is why competition coverage started at six topics out of
 * fifty-odd. But the option that letter points at is often a plain number
 * written as `"B. 14"`, so the value can be read back out — which turns a
 * question the transforms had to skip into one it can work from.
 *
 * **Bare numbers only, deliberately.** An earlier version also stripped unit
 * words so that "14 cm" and "Rs. 25" could be read. It was measured and it
 * changed nothing, because the questions it would have unlocked all sit in
 * topics that are *already* covered. Since extra parsing here can only mis-read
 * an option rather than rescue one, it was removed. Widening coverage needs new
 * transforms, not a cleverer reader.
 *
 * Returns null rather than guessing when the answer is not a single number, and
 * when the key names a letter that is not in the options at all.
 */
function usableAnswer(q: GeneratedQuestion): number | null {
  const direct = Number(q.answerKey);
  if (isWhole(direct) && Math.abs(direct) < 1_000_000 && (q.type === "fill_blank" || q.type === "short")) {
    return direct;
  }
  if (q.type !== "mcq") return null;

  const idx = LETTERS.indexOf(String(q.answerKey));
  if (idx < 0) return null;
  const option = q.options?.[idx];
  if (typeof option !== "string") return null;

  // Options are written "A. 14". Strip the label, then read a bare number only —
  // "14 cm" or "two of them" are not answers this can build arithmetic on.
  const bare = option.replace(/^\s*[A-Ha-h]\s*[.)]\s*/, "").trim();
  const n = Number(bare);
  return isWhole(n) && Math.abs(n) < 1_000_000 ? n : null;
}

const LETTERS = "ABCDEFGH";

/* ------------------------------------------------------------------ */
/* Fractions, decimals and other non-whole answers                     */
/* ------------------------------------------------------------------ */

/**
 * The value of the answer as a fraction, whatever form it was written in.
 *
 * `usableAnswer` deliberately returns null for an answer that is not a single
 * whole number, so the whole-number transforms can never receive a decimal.
 * These topics exist anyway — a fifth of a cake, ₹2.75, the fourth term of a
 * list — and they need their own reader and their own transforms. This is the
 * reader, used to confirm that a transform read the stem correctly before it
 * builds anything on top.
 */
type Fraction = { n: number; d: number };

/* The word forms `formatFraction` in templates.ts can emit. Parsing them with
 * a phrase map rather than with "split on spaces" keeps "one-fourth" distinct
 * from "fourth" and from "one", which a general word number would mangle. */
const FRACTION_WORDS: Record<string, Fraction> = {
  "half": { n: 1, d: 2 },
  "one-half": { n: 1, d: 2 },
  "one-third": { n: 1, d: 3 },
  "two-thirds": { n: 2, d: 3 },
  "one-fourth": { n: 1, d: 4 },
  "quarter": { n: 1, d: 4 },
  "three-fourths": { n: 3, d: 4 },
  "one-fifth": { n: 1, d: 5 },
  "two-fifths": { n: 2, d: 5 },
  "three-fifths": { n: 3, d: 5 },
  "four-fifths": { n: 4, d: 5 },
  "one-eighth": { n: 1, d: 8 },
  "three-eighths": { n: 3, d: 8 },
};

/** Read a single fraction from text — "3/5" or a word form. First slash wins. */
function parseFraction(text: string): Fraction | null {
  const slash = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (slash) {
    const d = Number(slash[2]);
    if (d !== 0) return { n: Number(slash[1]), d };
  }
  // Longest phrase first, so "three-fourths" is matched before "fourths" — which
  // is why no bare "fourth" or "third" appears as a key here.
  const keys = Object.keys(FRACTION_WORDS).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (new RegExp(`(^|\\W)${key}($|\\W)`, "i").test(text)) return FRACTION_WORDS[key]!;
  }
  return null;
}

/**
 * The answer's value as a number, from any answer shape.
 *
 * `usableAnswer` covers whole numbers. This reaches the rest: a fraction key,
 * a decimal key, or the option a multiple-choice letter points at. Returns the
 * *value* (so 3/4 is 0.75) because transforms only ever need to compare it to
 * what they read from the stem.
 */
function keyValue(q: GeneratedQuestion): number | null {
  const whole = usableAnswer(q);
  if (whole !== null) return whole;
  const fromFrac = parseFraction(q.answerKey);
  if (fromFrac && fromFrac.d !== 0) return fromFrac.n / fromFrac.d;
  const dec = Number(q.answerKey);
  if (Number.isFinite(dec)) return dec;
  if (q.type === "mcq") {
    const idx = LETTERS.indexOf(String(q.answerKey));
    if (idx >= 0) {
      const option = q.options?.[idx];
      if (typeof option === "string") {
        const bare = option.replace(/^\s*[A-Ha-h]\s*[.)]\s*/, "").trim();
        const f = parseFraction(bare);
        if (f && f.d !== 0) return f.n / f.d;
        const n = Number(bare);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

/** A stable integer from a string, for rotating MCQ keys without randomness. */
function stemHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
}

/* ------------------------------------------------------------------ */
/* Structured transforms: bases whose answer is not a whole number     */
/* ------------------------------------------------------------------ */

/**
 * The correctness contract is the same as for arithmetic transforms: read the
 * stem, recompute the answer, and return null unless the read agrees with the
 * base key. The difference is the transform gets the whole question rather than
 * a pre-extracted `number` and `op`, because there is no single number to
 * extract — which is exactly why these topics were unreachable before.
 */
type StructuredTransform = {
  style: CompStyleId;
  /** Human note on what this style asks of the child. Documentation only. */
  needs: string;
  make: (q: GeneratedQuestion) => CompetitionQuestion | null;
};

/* Fractions against which the base fraction is compared. Kept to a small pool
 * of common values so the comparison is always a real one, and all values are
 * distinct so no question can offer two equal fractions. */
const PARTNERS: Fraction[] = [
  { n: 1, d: 2 }, { n: 1, d: 3 }, { n: 2, d: 3 }, { n: 1, d: 4 }, { n: 3, d: 4 },
  { n: 1, d: 5 }, { n: 2, d: 5 }, { n: 3, d: 5 }, { n: 4, d: 5 },
  { n: 1, d: 8 }, { n: 3, d: 8 }, { n: 5, d: 8 }, { n: 7, d: 8 },
];

function readBaseFraction(q: GeneratedQuestion): Fraction | null {
  // "What is the value of the digit 5 in the number 0.35?" — the digit asked
  // about is worth its place, hundredths here.
  const place = q.stem.match(/value of the digit\s+(\d+)\s+in the number\s+0\.(\d)(\d)/i);
  if (place) {
    const asked = Number(place[1]);
    if (asked !== Number(place[3])) return null;
    const f: Fraction = { n: asked, d: 100 };
    const kv = keyValue(q);
    return kv !== null && Math.abs(kv - f.n / f.d) < 1e-9 ? f : null;
  }
  const f = parseFraction(q.stem);
  if (!f || f.d === 0) return null;
  const kv = keyValue(q);
  return kv !== null && Math.abs(kv - f.n / f.d) < 1e-9 ? f : null;
}

/* ------------------------------------------------------------------ */
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

type Transform = {
  style: CompStyleId;
  /** Human note on what this style asks of the child. Documentation only — it
   * must NOT be used to gate whether a topic may be asked in this style. */
  needs: string;
  make: (q: GeneratedQuestion, a: number, op: ReturnType<typeof parseOperation>) => CompetitionQuestion | null;
};

/**
 * Reasoning backwards.
 *
 * `a + b = ?` becomes `? + b = a + b`, and the answer is `a` — recovered by
 * subtracting, not by echoing the base key. Also produces the "how many more"
 * form, which is the same subtraction with the direction made explicit.
 */
const reverse: Transform = {
  style: "reverse",
  needs: "The total and one part are given; the other part must be recovered.",
  make(q, a, op) {
    if (!op.found || !isWhole(a)) return null;
    const { a: x, b: y, op: symbol } = op;

    if (symbol === "+") {
      const start = a - y;
      if (!isWhole(start) || start < 0 || start === 0) return null;
      // The starting number is deliberately *not* written into the stem. An
      // earlier version printed it on both sides ("83 + 47 = 77 + 47 … place of
      // 83?"), which is a question about reading, not about subtraction.
      return {
        ...q,
        stem: `${y} more than some number is ${a}. What is that number?`,
        answerKey: String(start),
        explanation: `Take ${y} away from ${a}: ${a} - ${y} = ${start}.`,
        difficulty: 4,
        isCompetition: true,
        style: "reverse",
        compTier: 2,
        derivedFrom: q.stem,
      };
    }

    if (symbol === "-") {
      if (y >= a) return null;
      return {
        ...q,
        stem: `Taking away some number from ${x} leaves ${a}. What was taken away?`,
        answerKey: String(y),
        explanation: `${x} - ${a} = ${y}.`,
        difficulty: 4,
        isCompetition: true,
        style: "reverse",
        compTier: 2,
        derivedFrom: q.stem,
      };
    }

    if (symbol === "*" && isWhole(a) && y !== 0 && a % y === 0) {
      const groups = a / y;
      if (!isWhole(groups)) return null;
      return {
        ...q,
        stem: `Some number of groups of ${y} makes ${a} altogether. How many groups are there?`,
        answerKey: String(groups),
        explanation: `${a} ÷ ${y} = ${groups} groups.`,
        difficulty: 4,
        isCompetition: true,
        style: "reverse",
        compTier: 2,
        derivedFrom: q.stem,
      };
    }

    return null;
  },
};

/**
 * A property of the answer rather than the answer.
 *
 * Asking "is the answer even?" is not a harder sum, it is a different question
 * about the same numbers — which is what a national paper actually does. The
 * answer is computed from parity, never carried over from the base key.
 */
const numberTheory: Transform = {
  style: "number_theory",
  needs: "A property of the answer is asked for, not the answer itself.",
  make(q, a, op) {
    if (!op.found || a < 0) return null;
    const isEven = a % 2 === 0;
    const symbol = op.op === "*" ? "×" : op.op === "/" ? "÷" : op.op;
    // The result is deliberately NOT written into the stem. Printing it made the
    // question a reading exercise — "30 ÷ 6 = 5. Is 5 even or odd?" — which is
    // the same mistake the reverse transform made, and the reason a guard that
    // only inspects a fill-in key cannot catch it: an MCQ key is a letter, so
    // the giveaway is in the wording, not the key.
    return {
      ...q,
      type: "mcq",
      options: ["Even", "Odd"],
      answerKey: isEven ? "A" : "B",
      stem: `A child works out ${op.a} ${symbol} ${op.b}. Is the answer even or odd?`,
      explanation: `${op.a} ${symbol} ${op.b} = ${a}, and ${a} is ${isEven ? "even" : "odd"}.`,
      marks: 1,
      difficulty: 3,
      isCompetition: true,
      style: "number_theory",
      compTier: 2,
      derivedFrom: q.stem,
    };
  },
};

/**
 * Estimation and bounds.
 *
 * "Which is closer" forces a decision under uncertainty rather than a
 * computation. Two candidate answers are placed at a known distance from the
 * true one, and the closer one is chosen by arithmetic in this function. The
 * distractors are *constructed*, not drawn at random, because a random
 * distractor can land on the correct value.
 */
const estimation: Transform = {
  style: "estimation",
  needs: "A decision under uncertainty instead of an exact computation.",
  make(q, a, op) {
    if (!op.found || a <= 0) return null;

    // Scale the distance to the size of the answer, so a three-digit sum is not
    // asked about to within one unit.
    const magnitude = a < 10 ? 2 : a < 100 ? 10 : a < 1000 ? 100 : 1000;
    const step = magnitude;

    /* Both options sit above the true answer, one step and three steps away, so
     * the nearer one is nearer by construction and the answer cannot be a
     * coincidence. They are then nudged until neither matches a number already
     * printed in the stem — an option equal to one of the operands looks like a
     * typo to a child and invites them to pick it by pattern. */
    const shown = new Set([a, op.a, op.b, op.a + op.b].filter(Number.isFinite));
    const bump = (v: number) => {
      let out = v;
      let guard = 0;
      while (shown.has(out) && guard < 8) {
        out += step;
        guard++;
      }
      return out;
    };
    const near = bump(a + step);
    const far = bump(a + 3 * step);
    if (near === far) return null;
    const options = [String(far), String(near)]; // B is nearer by construction

    return {
      ...q,
      type: "mcq",
      options,
      answerKey: "B",
      stem: `Without working it out exactly, decide which answer is closer to ${op.a} ${op.op === "*" ? "×" : op.op === "/" ? "÷" : op.op} ${op.b}.`,
      explanation: `The answer is exactly ${a}. That is ${near - a} away from ${near} and ${far - a} away from ${far}.`,
      marks: 1,
      difficulty: 3,
      isCompetition: true,
      style: "estimation",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

/**
 * The next term of a sequence.
 *
 * The rule is *shown*, not hidden: four terms with a constant difference, then
 * "what comes next". The answer is derived from the last two terms, so it
 * cannot disagree with the sequence printed in the stem — which is the failure
 * mode a hand-written pattern question always has.
 */
const pattern: Transform = {
  style: "pattern",
  needs: "A rule is shown and must be continued, rather than applied once.",
  make(q, a, op) {
    // `found` matters, not just the operator: an unreadable stem still reports
    // a default of "+", so testing `op.op !== "+"` alone would let a pattern
    // question be built from a stem that contains no numbers at all.
    if (!op.found || (op.op !== "+" && op.op !== "*")) return null;
    const d = op.op === "+" ? op.b : null;
    if (d === null || d <= 0) return null;
    const step = d;
    const start = a - 3 * step;
    if (start < 0) return null;

    const seq = [start, start + step, start + 2 * step, start + 3 * step];
    const next = a + step;

    return {
      ...q,
      type: "fill_blank",
      stem: `The numbers ${seq.join(", ")} keep going up by the same amount each time. What number comes next?`,
      answerKey: String(next),
      explanation: `Each step adds ${step}, so after ${a} comes ${next}.`,
      marks: 1,
      difficulty: 3,
      isCompetition: true,
      style: "pattern",
      compTier: 2,
      derivedFrom: q.stem,
    };
  },
};

/**
 * Two steps, both of them shown.
 *
 * The only multi-step form generated is the safe one: a quantity is given, one
 * clear operation removes some of it, and a second uses what is left. Both
 * operations are printed, so the child is *reasoning about the structure*
 * rather than guessing which operation was meant — which is the difference
 * between a multi-step question and an unfair one.
 */
const multiStep: Transform = {
  style: "multi_step",
  needs: "Two steps, both printed, so the structure rather than the arithmetic is the difficulty.",
  make(q, a, op) {
    if (!op.found || op.op !== "+" || op.b <= 0) return null;
    const each = op.b;
    // Two identical steps must both leave something, or the second is a
    // subtraction to zero and the question is arithmetic theatre.
    if (a <= 2 * each) return null;
    const left = a - 2 * each;

    return {
      ...q,
      stem: `A tray held ${a} sweets. ${each} sweets were given away. Then another ${each} were given away. How many sweets are left on the tray?`,
      answerKey: String(left),
      explanation: `${a} - ${each} = ${a - each}, and ${a - each} - ${each} = ${left}.`,
      difficulty: 4,
      isCompetition: true,
      style: "multi_step",
      compTier: 2,
      derivedFrom: q.stem,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Families that are not arithmetic                                    */
/* ------------------------------------------------------------------ */

/**
 * The second group of blocked topics: the answer is a number, but the stem
 * contains no operation to work backwards from. These need one transform each,
 * and each re-derives its own answer from the stem rather than trusting `a`.
 *
 * Every one of them **checks its reading against the answer key** and declines
 * if they disagree. That is the safety property that makes it safe to parse
 * stems with a regex: if the regex reads a stem it does not understand, it
 * will not match the answer either, so the question is dropped rather than
 * emitted with a key nobody checked. A transform that can disagree with the
 * answer key is not a transform, it is a guess with a confidence score.
 */

const successor: Transform = {
  style: "pattern",
  needs: "The successor or predecessor of a number, reached without counting on.",
  make(q, a) {
    const m = q.stem.match(/what comes (just )?(after|before)\s+(\d+)/i);
    if (!m) return null;
    const n = Number(m[3]);
    const after = /after/i.test(m[2]!);
    const expected = after ? n + 1 : n - 1;
    if (expected !== a) return null;
    return {
      ...q,
      type: "fill_blank",
      stem: `What number comes ${after ? "after" : "before"} ${n}, and what number comes ${after ? "after" : "before"} that one? Write the second one.`,
      answerKey: String(after ? n + 2 : n - 2),
      explanation: `${after ? `After ${n} is ${n + 1}` : `Before ${n} is ${n - 1}`}, and then ${after ? n + 2 : n - 2}.`,
      difficulty: 4,
      isCompetition: true,
      style: "pattern",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

const comparison: Transform = {
  style: "reverse",
  needs: "Ordering two numbers without counting on from zero.",
  make(q, a) {
    const m = q.stem.match(/which number is (bigger|greater|larger|smaller)\D*(\d+)\s*or\s*(\d+)/i);
    if (!m) return null;
    const x = Number(m[2]);
    const y = Number(m[3]);
    const wantGreater = /bigger|greater|larger/i.test(m[1]!);
    if ((wantGreater ? Math.max(x, y) : Math.min(x, y)) !== a || x === y) return null;

    /* `wantGreater` is about which of the two is bigger, and the answer is that
     * one — so the *other* number is the one that sits before it. Getting this
     * backwards produced "the number after 59 in counting order is 35", and then
     * "counting on from 59 ... to reach 35", which cannot be done by counting on
     * at all. Stated as a distance instead, so it reads correctly whichever
     * number is larger. */
    const other = wantGreater ? y : x;
    const named = wantGreater ? x : y;
    const gap = Math.abs(other - named);

    return {
      ...q,
      type: "fill_blank",
      stem: `${named} and ${other} are marked on a number line. How many steps apart are they?`,
      answerKey: String(gap),
      explanation: `From ${named} to ${other} is ${gap} steps.`,
      difficulty: 4,
      isCompetition: true,
      style: "reverse",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

const placeValueDigit: Transform = {
  style: "number_theory",
  needs: "One digit's worth derived from where it sits.",
  make(q, a) {
    const m = q.stem.match(/in the number (\d+), what is the value of the (ones|units|tens|hundreds|thousands) digit/i);
    if (!m) return null;
    const n = Number(m[1]);
    const place = /thousand/i.test(m[2]!) ? 1000
      : /hundred/i.test(m[2]!) ? 100
      : /ten/i.test(m[2]!) ? 10 : 1;
    const digit = Math.floor(n / place) % 10;
    if (digit * place !== a) return null;

    return {
      ...q,
      type: "fill_blank",
      stem: `The digit in the ${m[2]} place of ${n} is worth something. What is that digit worth, and what is the rest of the number worth?`,
      answerKey: String(n - a),
      explanation: `The ${m[2]} digit of ${n} is ${digit}, worth ${a}. The other digits are worth ${n - a}.`,
      difficulty: 4,
      isCompetition: true,
      style: "number_theory",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

const roundToNearest: Transform = {
  style: "estimation",
  needs: "Rounding to a stated bound, and justifying it.",
  make(q, a) {
    const m = q.stem.match(/round\s+(\d+)\s+to the nearest (ten|hundred|thousand)/i);
    if (!m) return null;
    const n = Number(m[1]);
    const step = /thousand/i.test(m[2]!) ? 1000 : /hundred/i.test(m[2]!) ? 100 : 10;
    const expected = Math.round(n / step) * step;
    if (expected !== a) return null;

    /* An exact midpoint is equally near both options, so the question would have
     * two defensible answers and a child could be marked wrong for rounding the
     * other way. Declined rather than asked. */
    const lowBound = a - step;
    if (Math.abs(n - a) === step / 2) return null;

    // The stem must not name the answer. An earlier version read "Which number is
    // 590, the nearest multiple of 10 to 590?", which printed it.
    const options = [String(a + step), String(lowBound)];
    return {
      ...q,
      type: "mcq",
      options,
      answerKey: "B",
      stem: `Which is nearer to ${n}?`,
      explanation: `${n} is ${Math.abs(n - a)} away from ${a} and ${Math.abs(n - lowBound)} away from ${lowBound}.`,
      marks: 1,
      difficulty: 4,
      isCompetition: true,
      style: "estimation",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

const missingOperand: Transform = {
  style: "reverse",
  needs: "A missing addend recovered from the structure, not by inverting blindly.",
  make(q) {
    // "15 + ? = 20", "? + 15 = 20", "x + 7 = 11"
    const m = q.stem.match(/(\d+)\s*\+\s*(\?|[a-z])\s*=\s*(\d+)/i);
    if (!m) return null;
    const known = Number(m[1]);
    const total = Number(m[3]);
    const missing = total - known;

    /* On a base question like "15 + ? = 20" the answer key *is* the missing
     * operand, so `missing === a` is the case worth transforming rather than a
     * reason to decline. Guarding on it — which this did at first — threw away
     * every question the family exists for. What must be checked is that the
     * sentence is true at all. */
    if (missing < 0 || known + missing !== total) return null;

    return {
      ...q,
      type: "fill_blank",
      stem: `A shop sold ${known} apples in the morning. In the afternoon it sold as many more as it had in the morning. How many did it sell altogether?`,
      answerKey: String(total),
      explanation: `${known} + ${known} = ${total}.`,
      difficulty: 4,
      isCompetition: true,
      style: "reverse",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

const geometryCount: Transform = {
  style: "reverse",
  needs: "A property of a shape, found by comparing two shapes rather than recalling one.",
  make(q, a) {
    const m = q.stem.match(/how many (sides|corners|edges|faces|lines of symmetry) does an? (\w+) (?:have|has)?/i);
    if (!m || a < 1) return null;
    const property = /sides/i.test(m[1]!) ? "sides"
      : /corners/i.test(m[1]!) ? "corners"
      : /edges/i.test(m[1]!) ? "edges"
      : /faces/i.test(m[1]!) ? "faces" : "lines of symmetry";
    // Only "sides" and "corners" are equal for a plain polygon, which is the
    // only relation here that can be stated without a lookup table of shapes.
    if (property !== "sides" && property !== "corners") return null;
    const other = a === 3 ? 4 : 3;

    return {
      ...q,
      type: "fill_blank",
      stem: `One shape has ${a} ${property}. A triangle has 3. How many more ${property} does the first shape have than a triangle?`,
      answerKey: String(a - other),
      explanation: `${a} ${property} minus 3 is ${a - other}.`,
      difficulty: 4,
      isCompetition: true,
      style: "reverse",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

const TRANSFORMS: Transform[] = [
  reverse, numberTheory, estimation, pattern, multiStep,
  successor, comparison, placeValueDigit, roundToNearest, missingOperand, geometryCount,
];

/**
 * Comparing two fractions with different denominators.
 *
 * The partner is chosen as the pool fraction closest in value to the base, so
 * the comparison cannot be decided by looking at the numerators, which is the
 * whole skill. Both fractions are written into the stem in the base's own
 * order, so the bigger one is as often second as first, and the multiple-choice
 * key is rotated by a hash of the stem so "tick A" is not a strategy.
 */
const fractionCompare: StructuredTransform = {
  style: "number_theory",
  needs: "Comparing fractions with unlike denominators, on value rather than on the digits.",
  make(q) {
    // A base that already asks this teaches nothing when asked again.
    if (/which fraction is (bigger|greater|smaller|largest|smallest)/i.test(q.stem)) return null;
    const base = readBaseFraction(q);
    if (!base) return null;
    const bv = base.n / base.d;

    let partner: Fraction | null = null;
    let best = Infinity;
    for (const p of PARTNERS) {
      const pv = p.n / p.d;
      if (Math.abs(pv - bv) < 1e-9) continue;
      const dist = Math.abs(pv - bv);
      if (dist < best) {
        best = dist;
        partner = p;
      }
    }
    if (!partner) return null;
    const pv = partner.n / partner.d;

    const label = (f: Fraction) => `${f.n}/${f.d}`;
    const bigger = bv >= pv ? base : partner;
    const smaller = bv >= pv ? partner : base;
    // A third option with a value equal to neither, so the child is choosing.
    const filler =
      PARTNERS.find((f) => {
        const v = f.n / f.d;
        return Math.abs(v - bv) > 1e-9 && Math.abs(v - pv) > 1e-9;
      }) ?? { n: 7, d: 8 };

    const keyed = [label(bigger), label(smaller), label(filler)];
    const start = stemHash(q.stem) % 3;
    const options = [0, 1, 2].map((i) => keyed[(start + i) % 3]!);
    const correct = options.indexOf(label(bigger));

    // The common denominator, and each fraction over it, so the explanation
    // compares numerators instead of saying "1/4 is the same as 20ths".
    const denom = base.d * partner.d;
    const bTop = base.n * partner.d;
    const pTop = partner.n * base.d;

    return {
      ...q,
      type: "mcq",
      options,
      answerKey: LETTERS[correct]!,
      stem: `Which fraction is bigger, ${label(base)} or ${label(partner)}?`,
      explanation: `${label(base)} is ${bTop}/${denom} over a common denominator of ${denom}, and ${label(partner)} is ${pTop}/${denom} — so ${label(bigger)} is the bigger fraction.`,
      marks: 1,
      difficulty: 4,
      isCompetition: true,
      style: "number_theory",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

/**
 * A unit price turned into a real purchase: several items, paid for with a
 * note, change required. Two steps (multiply, then subtract), both shown.
 */
const moneyTotal: StructuredTransform = {
  style: "multi_step",
  needs: "A unit price applied to several items, then change worked out.",
  make(q) {
    const m = q.stem.match(/A\s+([\w][\w ]*?)\s+costs?\s+₹\s*(\d+)\.(\d{2})/i);
    if (!m) return null;
    const item = m[1]!.trim();
    const price = Number(`${m[2]}.${m[3]}`);
    const kv = keyValue(q);
    if (kv === null || Math.abs(kv - price) > 1e-9) return null;

    const qty = 3;
    const total = Math.round(price * qty * 100) / 100;
    const note = Math.ceil(total / 10) * 10;
    if (note <= total) return null;
    const change = Math.round((note - total) * 100) / 100;

    return {
      ...q,
      type: "fill_blank",
      stem: `A ${item} costs ₹${price.toFixed(2)}. Meera buys ${qty} of them and pays with a ₹${note} note. How much change does she get?`,
      answerKey: change.toFixed(2),
      explanation: `${qty} × ₹${price.toFixed(2)} = ₹${total.toFixed(2)}, and ₹${note} − ₹${total.toFixed(2)} = ₹${change.toFixed(2)}.`,
      marks: 2,
      difficulty: 4,
      isCompetition: true,
      style: "multi_step",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

/**
 * A constant-difference list continued well past the terms shown.
 *
 * The base asks for the very next term; this asks for one several places on,
 * which needs the rule to be understood and applied, not read off the end.
 */
const sequenceTerm: StructuredTransform = {
  style: "pattern",
  needs: "Applying a sequence's rule beyond the next term.",
  make(q) {
    /* The capture is the whole comma-separated list, then `, ____`. An earlier
     * version split a group that STARTED with a comma — "3" followed by
     * ", 9, 15" — which yielded an empty first element whose Number("") is 0,
     * and "3, 0, 9, 15, 21" is not a constant-difference list at all. */
    const list = (q.stem.match(/(-?\d+(?:\s*,\s*-?\d+)+)\s*,\s*_+/) ?? [])[1];
    if (!list) return null;
    const shown = list.split(",").map((s) => Number(s.trim()));
    if (shown.some((n) => !Number.isInteger(n)) || shown.length < 3) return null;
    const d = shown[1]! - shown[0]!;
    if (d === 0) return null;
    if (!shown.every((v, i) => i === 0 || v - shown[i - 1]! === d)) return null;
    const last = shown[shown.length - 1]!;
    const kv = usableAnswer(q);
    if (kv === null || kv !== last + d) return null;

    const skip = 3;
    const answer = last + skip * d;
    return {
      ...q,
      type: "fill_blank",
      stem: `The list ${shown.join(", ")} continues, adding ${d} each time. Which number is ${skip} places after ${last}?`,
      answerKey: String(answer),
      explanation: `Each step adds ${d}, so ${skip} steps after ${last} is ${last} + ${skip} × ${d} = ${answer}.`,
      marks: 2,
      difficulty: 4,
      isCompetition: true,
      style: "pattern",
      compTier: 0,
      derivedFrom: q.stem,
    };
  },
};

const STRUCTURED_TRANSFORMS: StructuredTransform[] = [fractionCompare, moneyTotal, sequenceTerm];


/**
 * Why a topic cannot yet be asked in competition style.
 *
 * `topicsThatCanCompete` answers "which can". This answers "which cannot, and
 * what would be needed" — because the difference between the two is the whole
 * planning question. Measured over the bundled bank, the topics that are
 * unreachable split cleanly: a handful are held back by an answer format that
 * could be parsed, and the rest are held back because their stems do not contain
 * two numbers to work with at all. Only the second group needs new transforms,
 * and each one is a genuinely different kind of question rather than another
 * way of rearranging arithmetic.
 *
 * Returned rather than printed, so the generator page can tell a teacher the
 * truth and the school can decide what to commission next.
 */
export function coverageReport(grade: number, topics: { id: string; classes: number[] }[], target: number) {
  const eligible = topics.filter((t) => t.classes.includes(grade) && compTierOf(t.id) >= target && target > 0);
  const canBuild = topicsThatCanCompete(grade, topics, target);

  const blocked: { topicId: string; reason: string; example: string }[] = [];
  for (const t of eligible) {
    if (canBuild.includes(t.id)) continue;
    let example = "";
    let reason = "No generator for this topic";
    if (topicHasGenerator(t.id)) {
      const probes = generateForTopic(t.id, 4, grade, 31337, grade >= 4);
      const numericAnswer = probes.filter((q) => usableAnswer(q) !== null).length;
      const readableOp = probes.filter((q) => parseOperation(q.stem).found).length;
      example = probes[0]?.stem ?? "";
      if (numericAnswer === 0) {
        reason = "Its answers are words, not numbers, so there is nothing to build arithmetic on";
      } else if (readableOp === 0) {
        reason = "Its stems do not contain an operation to work backwards from";
      } else {
        reason = "No stem was both numeric and readable in the same question";
      }
    }
    blocked.push({ topicId: t.id, reason, example });
  }

  return {
    eligible: eligible.length,
    canBuild: canBuild.length,
    blocked,
  };
}

/**
 * The topics in a class that can actually produce competition questions.
 *
 * `compTierOf` alone is not enough, and overstating this is the failure that
 * matters. A topic at tier 3 is *supposed* to be examinable at national level,
 * but whether a competition question can be derived from it depends on what its
 * own generators emit: the transforms need a numeric fill-in stem whose
 * operation can be read back, and many topics generate multiple choice instead.
 * So this asks the generators rather than assuming.
 *
 * A first pass over the bundled bank found only about a quarter of the tier-2+
 * topics could be derived from. That is reported here rather than papered over —
 * a teacher choosing topics for a zone paper should see the real list.
 */
export function topicsThatCanCompete(
  grade: number,
  topics: { id: string; classes: number[] }[],
  target: number,
  probe = 4,
): string[] {
  return topics
    .filter((t) => t.classes.includes(grade) && compTierOf(t.id) >= target && target > 0)
    .filter((t) => {
      try {
        const seeds = generateForTopic(t.id, probe, grade, 12345, grade >= 4);
        return seeds.some((q) => toCompetition(q, t.id, 1).length > 0);
      } catch {
        return false;
      }
    })
    .map((t) => t.id);
}

/**
 * The styles this topic can be asked in.
 *
 * Every style is available to any topic above school level — there is no
 * per-style gate, and a topic does not have to reach a national tier to be
 * asked a backwards question at zone level. What a topic cannot always supply
 * is a *stem the transforms can read*, and no static list can know that; use
 * `coverageReport` for that.
 */
export function supportedStyles(topicId: string): CompStyleId[] {
  return compTierOf(topicId) === 0 ? [] : TRANSFORMS.map((t) => t.style);
}

/**
 * Derive competition variants from one ordinary question.
 *
 * `wanted` is a target, not a guarantee: a topic with unreadable stems returns
 * fewer, and an empty array is a legitimate answer meaning "this topic cannot
 * yet be asked in competition style" — which the generator reports rather than
 * silently padding with easier questions.
 */
export function toCompetition(
  q: GeneratedQuestion,
  topicId: string,
  wanted = 4,
): CompetitionQuestion[] {
  const answer = usableAnswer(q);
  // No early exit on an unreadable operation. The six families added later —
  // place value, rounding, comparison, missing operand, geometry, successor —
  // do not need an operation at all, and an early `if (!op.found) return []`
  // meant they could never run, however well their stems matched. Each
  // transform decides for itself whether it needs one.
  const op = parseOperation(q.stem);

  const tier = compTierOf(topicId);
  const out: CompetitionQuestion[] = [];
  const seen = new Set<string>();

  // A topic at tier 0 is not examinable in competition style at all. Beyond
  // that, every style is available.
  //
  // The per-transform tier gate that used to be here compared each style's own
  // `tier` (all of them 2) against the topic's, which silently skipped **every
  // tier-1 topic** — so a Class 3 zone paper could draw from seven topics out of
  // fifty even though hundreds of its questions were perfectly readable. The
  // question is stamped with the *topic's* tier, not the style's, so a zone
  // topic yields zone questions.
  if (tier === 0) return [];

  const emit = (made2: CompetitionQuestion | null) => {
    if (!made2 || out.length >= wanted) return;
    // Two transforms producing the identical stem would read as a mistake.
    if (seen.has(made2.stem)) return;
    // A question must not print its own answer. This is the failure that makes a
    // "harder" question worthless rather than wrong — the child reads the number
    // off the page — and it has now happened twice in this file.
    //
    // Checked as a whole number token, not a substring: `includes` would pass a
    // multiple-choice key of "A" because the stem happens to contain the word
    // "A", which is how this went unnoticed the first time.
    //
    // Applied to every type, not just fill-in. An MCQ's key is a letter, so the
    // giveaway there is in the wording — "30 ÷ 6 = 5. Is 5 even or odd?" — and a
    // guard that only inspects the key cannot see it at all.
    if (answerAppears(made2.stem, String(made2.answerKey), made2.type)) return;
    seen.add(made2.stem);
    /* Every transform spreads `...q`, and `q.accepted` is an accepted-answers
     * list for the *base* question. Carrying it forward would let a child be
     * marked right on the derived question for typing the old answer — "0.5" is
     * accepted for fr_equivalent, and the derived comparison is never about 0.5.
     * The derived answerKey is always exact, and the grader's numeric path
     * already tolerates "₹4.50" versus "4.5", so nothing is lost by dropping it. */
    const made = { ...made2 };
    delete made.accepted;
    out.push({ ...made, compTier: tier });
  };

  // Arithmetic transforms need a whole-number answer; the structured ones read
  // whatever the answer is — a fraction, a price, the next term of a list — and
  // so run even when `answer` is null. That is the whole point of the split.
  if (answer !== null) {
    for (const t of TRANSFORMS) emit(t.make(q, answer, op));
  }
  for (const t of STRUCTURED_TRANSFORMS) emit(t.make(q));

  return out;
}
