/**
 * Misconception inference.
 *
 * A mark of "0" tells a teacher nothing. "0, because the child added instead of
 * multiplying" tells them exactly what to reteach. This module works out the
 * second from the first.
 *
 * Three sources of evidence, strongest first:
 *
 *  1. **Authored tags** — the question declares which misconceptions it
 *     diagnoses (`Question.diagnoses`). Reliable, but only for questions a
 *     teacher or the AI deliberately tagged.
 *
 *  2. **Option diagnosis** — for multiple choice, the distractor itself is the
 *     evidence. If a child picks the option built from adding 6+4, that *is*
 *     the addition-instead-of-multiplication misconception. Carried in the mark
 *     scheme as `optionDiagnosis: { "C": "mc_mult_add_confusion" }`.
 *
 *  3. **Structural analysis** — read the question, work out what a child
 *     holding a specific misconception would write, and see whether that is
 *     what they wrote. This is the one that works on untagged questions, which
 *     in practice is most of them.
 *
 * Everything returns a confidence, and a marker can always override.
 */

import { matchesMisconception, normalise, toNumber } from "@/lib/answer-normaliser";
import { MISCONCEPTION_BY_ID, type Misconception } from "@/lib/curriculum";

export type Inference = {
  misconceptionId: string;
  confidence: number;
  /** Shown to the teacher as the reason for the tag. */
  reason: string;
};

export type InferenceInput = {
  /** The question as the child saw it. */
  stem: string;
  /** The child's answer, as written. */
  response: string;
  /** True when the answer was actually wrong — only then do we infer. */
  isWrong: boolean;
  type: string;
  topicId?: string | null;
  strand?: string | null;
  /** Misconceptions the question was authored to diagnose. */
  diagnoses?: string[];
  /** Parsed mark scheme — may carry optionDiagnosis. */
  markScheme?: unknown;
  options?: string[];
};

/* ------------------------------------------------------------------ */
/* Reading the question                                                */
/* ------------------------------------------------------------------ */

export type ParsedQuestion = {
  a: number;
  b: number;
  op: "+" | "-" | "*" | "/";
  found: boolean;
};

/** The operations a Class 1–5 question is likely to contain. */
const OP_CHARS: Record<string, ParsedQuestion["op"]> = {
  "+": "+", "plus": "+", "जोड़": "+", "जोड़ो": "+", "योग": "+",
  "-": "-", "minus": "-", "−": "-", "घटाव": "-", "घटाओ": "-", "छोड़": "-",
  "×": "*", "x": "*", "✕": "*", "✖": "*", "*": "*", "गुणा": "*", "का गुणा": "*",
  "÷": "/", "/": "/", "भाग": "/", "से भाग": "/",
};

/**
 * Pull the first "a op b" out of a question stem.
 *
 * Guards matter here. A fraction question like "3/5 + 1/5" must not be read as
 * "3 ÷ 5", and a date like "12/05" must not become a division. So we bail out
 * when the stem looks like it is about fractions, and we prefer an operator
 * that is actually drawn.
 */
export function parseOperation(stem: string): ParsedQuestion {
  const miss: ParsedQuestion = { a: 0, b: 0, op: "+", found: false };
  if (!stem) return miss;
  const text = stem.replace(/[–—]/g, "-");

  // Fraction-shaped stems: leave these to the explicit tags.
  if (/\b(fraction|fractions|भिन्न|आभाग|simplif|proper|improper)\b/i.test(text)) return miss;
  // A date or a currency amount is not a division.
  if (/\b(date|dated|on the|born|age)\b/i.test(text) && !/[×✕*÷]/.test(text)) return miss;

  // Word operators first: "6 times 4", "12 divided by 3".
  const words = Object.keys(OP_CHARS).filter((k) => /[a-zऀ-ॿ]/i.test(k));
  for (const w of words.sort((x, y) => y.length - x.length)) {
    const re = new RegExp(`(\\d+)\\s*(?:${w})\\s*(\\d+)`, "i");
    const m = text.match(re);
    if (m) return { a: Number(m[1]), b: Number(m[2]), op: OP_CHARS[w], found: true };
  }

  // Then symbolic operators.
  for (const [sym, op] of Object.entries(OP_CHARS)) {
    if (!/[+\-×✕*÷/]/.test(sym)) continue;
    const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${escaped}\\s*(\\d+(?:\\.\\d+)?)`));
    if (m) return { a: Number(m[1]), b: Number(m[2]), op, found: true };
  }

  // Finally: a word problem.
  //
  // Real Class 1–5 questions are not written as "6 × 4". They are written as
  // "Amit had 15 marbles. He gave away 4. How many are left?" — and that is
  // the form a child in a classroom actually sees, so it is the form that has
  // to be understood. Take the numbers in order and let the surrounding
  // English decide the operation.
  return parseWordProblem(text);
}

/**
 * Keyword → operation, checked in priority order. Order matters: "how many
 * more" implies both an addition and a subtraction, and the subtraction is
 * what the child was trying to do.
 */
const PROBLEM_OPERATORS: [RegExp, ParsedQuestion["op"]][] = [
  [/\b(change|returned|left over|remain|remaining|how much left)\b/i, "-"],
  [/\b(left|remain|remaining|left over|had left|away|spent|given away|gave away|eaten|ate|broke|lost|fewer|less than|how many less)\b/i, "-"],
  [/\b(altogether|total|sum|combined|and then|in all|more|bought|added|join|collect|receive|got)\b/i, "+"],
  [/\b(each|per|times|rows|groups of|every|multiplied|altogether \d+ times|boxes of|packets of)\b/i, "*"],
  [/\b(share|shared|sharing|divide|divided|among|between|equally|split|per \d+ go)\b/i, "/"],
  [/\b(of \d+\s*(?:\w+\s+){0,2})/i, "*"],
];

function parseWordProblem(text: string): ParsedQuestion {
  const miss: ParsedQuestion = { a: 0, b: 0, op: "+", found: false };

  // "half of", "a third of" and "quarter of" are multiplication by a fraction.
  const fracWord = text.match(/\b(half|third|quarter|fourth|twice|double)\s+of\b/i);
  if (fracWord) {
    const nums = numbersIn(text);
    if (nums.length >= 1) {
      const factor: Record<string, number> = {
        half: 0.5, third: 1 / 3, quarter: 0.25, fourth: 0.25, twice: 2, double: 2,
      };
      return { a: nums[0], b: factor[fracWord[1].toLowerCase()]!, op: "*", found: true };
    }
  }

  const nums = numbersIn(text);
  if (nums.length < 2) return miss;

  // "How many more than…" and "difference between" are subtraction even though
  // the arithmetic is really a sum, so they are checked before the generic
  // "more" rule below.
  for (const [re, op] of PROBLEM_OPERATORS) {
    if (re.test(text)) {
      // A third number in a "times" or "share" problem is usually a rate or a
      // part count; the first two are the operands that matter here.
      return { a: nums[0], b: nums[1], op, found: true };
    }
  }

  return miss;
}

/** Every integer in a stem, in order, ignoring digits inside words. */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\w.])(\d+(?:\.\\d+)?)(?![\w])/g)) {
    out.push(Number(m[1]));
  }
  return out;
}

const PLACE_LABELS = ["ones", "tens", "hundreds", "thousands"];

/** "In the number 331, what is the value of the ones digit?" */
export type PlaceValueQuestion = { number: number; place: number; value: number; label: string };

export function parsePlaceValue(stem: string): PlaceValueQuestion | null {
  if (!stem) return null;
  // Indian grouping uses 4,52,863 and western grouping 4,528,863. Both are
  // the same number, so drop the separators before anything else reads them.
  const text = stem.replace(/[–—]/g, "-");

  const inNumber =
    text.match(/\bin\s+the\s+number\s+(\d[\d,\s]*)/i) ?? text.match(/\bnumber\s+(\d[\d,\s]*)/i);
  if (!inNumber) return null;

  const asked = text.match(
    /\b(ones|units|tens|hundreds|thousands)\s*(?:place|digit|column)\b|\b(?:place|value)\s+of\s+the\s+(ones|units|tens|hundreds|thousands)\b|\bwhich\s+is\s+the\s+(ones|units|tens|hundreds|thousands)\b/i,
  );
  if (!asked) return null;

  const word = (asked[1] ?? asked[2] ?? asked[3]).toLowerCase();
  const place = word === "ones" || word === "units" ? 0 : PLACE_LABELS.indexOf(word);
  if (place < 0) return null;

  const number = Number(inNumber[1].replace(/[,\s]/g, ""));
  if (!Number.isFinite(number)) return null;
  const digits = String(number);
  if (place >= digits.length) return null;

  // `place` counts from the right (0 = ones) but string indexing runs from the
  // left, so the digit lives at the mirrored index. Indexing straight with
  // `place` would always return the leftmost digit and report the ones digit
  // of 331 as 3.
  const digit = Number(digits[digits.length - 1 - place]);
  return { number, place, value: digit * 10 ** place, label: word };
}

/** "One symbol stands for 10 children. 3 symbols are drawn for cricket." */
export type GraphScale = { per: number; count: number; value: number };

export function parseGraphScale(stem: string): GraphScale | null {
  if (!stem) return null;
  const text = stem.toLowerCase();
  if (!/\b(symbol|graph|pictograph|bar chart|each|one square|one \w+ stands)\b/.test(text)) return null;

  const per = text.match(
    /\b(?:each|every|one)\s+[\w\s]{0,12}?(?:stands?\s+for|means|represents?|=\s*|is\s+worth)\s*(\d+)|(\d+)\s+[\w\s]{0,10}?stands?\s+for\b|(\d+)\s+per\s+(?:symbol|square|block|child|person|item)\b/,
  );
  if (!per) return null;
  const perValue = Number(per[1] ?? per[2] ?? per[3]);
  if (!Number.isFinite(perValue) || perValue <= 1) return null;

  const count = text.match(/(\d+)\s+(?:symbols?|squares?|blocks?|bars?|columns?|rows?)\b/);
  if (!count) return null;
  const n = Number(count[1]);
  if (!Number.isFinite(n) || n <= 0) return null;

  return { per: perValue, count: n, value: perValue * n };
}

export type Comparison = { x: number; y: number; kind: "bigger" | "smaller" | "equal" };
/**
 * "Which is bigger: 347 or 374?" is not an operation, and treating it as one
 * produces nonsense. Comparison questions are the most common form in the
 * number-sense strand of Class 1–3, and they are exactly where the
 * digit-place misconception shows up — so they get their own parse.
 */
export function parseComparison(stem: string): Comparison | null {
  if (!stem) return null;
  const text = stem.replace(/[–—]/g, "-");

  if (/\b(equal|same|identical|as many)\b/i.test(text)) return null; // "how many more" is subtraction

  const kind: Comparison["kind"] | null = /\b(bigger|larger|greater|more|largest|highest|maximum)\b/i.test(text)
    ? "bigger"
    : /\b(smaller|less|smallest|lowest|minimum)\b/i.test(text)
      ? "smaller"
      : null;
  if (!kind) return null;

  // "X or Y", "X and Y", or two numbers joined by a comma.
  const orMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:or|and)\s*(?:the\s+)?(?:number\s+)?(\d+(?:\.\d+)?)/i);
  if (orMatch) return { x: Number(orMatch[1]), y: Number(orMatch[2]), kind };

  const nums = numbersIn(text);
  if (nums.length >= 2) return { x: nums[0], y: nums[1], kind };

  return null;
}

/** Reverse a number's digits: 13 -> 31, 45 -> 54. */
function isDigitReversal(response: number, expected: number): boolean {
  const r = Math.trunc(Math.abs(response));
  const e = Math.trunc(Math.abs(expected));
  if (r === e || r < 10 || e < 10) return false;
  return String(r).split("").reverse().join("") === String(e);
}

/* ------------------------------------------------------------------ */
/* Structural analysis                                                 */
/* ------------------------------------------------------------------ */

/**
 * What would a child with this misconception write for this question?
 * Returns the explanation when the response matches.
 */
export function structuralInference(
  stem: string,
  response: string,
): Inference[] {
  const out: Inference[] = [];

  // "In the number 331, what is the value of the ones digit?" — the largest
  // single block of unrecognised errors in the Class 1–3 number-sense strand,
  // because it is phrased as a question about a number but is really a
  // question about position.
  const pv = parsePlaceValue(stem);
  if (pv) {
    const r = toNumber(response);
    if (r !== null && r !== pv.value) {
      const digit = Number(String(pv.number).charAt(pv.place));
      if (r === digit && pv.place > 0) {
        out.push({
          misconceptionId: "mc_place_value_digit",
          confidence: 0.9,
          reason: `The question asked for the value of the ${pv.label} digit. ${r} is the digit, not its value — in ${pv.number} that digit is worth ${pv.value}.`,
        });
      } else {
        out.push({
          misconceptionId: "mc_place_value_digit",
          confidence: 0.65,
          reason: `The value of the ${pv.label} digit in ${pv.number} is ${pv.value}, not ${r}. The digits are not being read for what they are worth in that position.`,
        });
      }
    }
    return out;
  }

  // A graph or pictograph scale: "one symbol stands for 10, 3 symbols drawn".
  const scale = parseGraphScale(stem);
  if (scale) {
    const r = toNumber(response);
    if (r !== null && r !== scale.value) {
      if (r === scale.value + scale.per) {
        out.push({
          misconceptionId: "mc_graph_scale",
          confidence: 0.9,
          reason: `${scale.per} symbols were multiplied by ${scale.per} correctly, but ${scale.per} was then added to the result. The scale was used twice.`,
        });
      } else if (r === scale.per || r === scale.count) {
        out.push({
          misconceptionId: "mc_graph_scale",
          confidence: 0.85,
          reason: `${r} was written without applying the scale of ${scale.per} per symbol. The key to the pictograph was not used.`,
        });
      } else {
        out.push({
          misconceptionId: "mc_graph_scale",
          confidence: 0.6,
          reason: `${scale.count} symbols at ${scale.per} each is ${scale.value}, not ${r}. The scale on the graph was misread.`,
        });
      }
    }
    return out;
  }

  // Comparison questions — they carry no operation, so the operation parse
  // would either miss them or misread them.
  const cmp = parseComparison(stem);
  if (cmp) {
    const r = toNumber(response);
    const hi = Math.max(cmp.x, cmp.y);
    const lo = Math.min(cmp.x, cmp.y);
    if (r !== null && r !== cmp.x && r !== cmp.y) {
      out.push({
        misconceptionId: "mc_digit_compare",
        confidence: 0.7,
        reason: `${r} was written as the answer, but ${cmp.x} and ${cmp.y} are the only options. The child compared something other than the value of the digits.`,
      });
    }
    if (r === lo && cmp.kind === "bigger") {
      out.push({
        misconceptionId: "mc_digit_compare",
        confidence: 0.9,
        reason: `${lo} was chosen for "which is bigger". The child compared the digits one at a time rather than the size of the whole number.`,
      });
    }
    if (r === hi && cmp.kind === "smaller") {
      out.push({
        misconceptionId: "mc_digit_compare",
        confidence: 0.9,
        reason: `${hi} was chosen for "which is smaller". The child compared the digits one at a time rather than the size of the whole number.`,
      });
    }
    return out;
  }

  const q = parseOperation(stem);
  const r = toNumber(response);
  if (!q.found || r === null) return out;

  const { a, b, op } = q;
  const add = a + b;
  const mul = a * b;
  const sub = a - b;

  if (op === "*") {
    // 6 × 4 answered as 10 is 6 + 4 — the classic confusion.
    if (r === add) {
      out.push({
        misconceptionId: "mc_mult_add_confusion",
        confidence: 0.95,
        reason: `${a} + ${b} = ${r} was written for ${a} × ${b}. The child added the two numbers together instead of multiplying them.`,
      });
    }
    // Answered as the larger operand — "counting on" instead of equal groups.
    if (r === Math.max(a, b) || r === Math.min(a, b)) {
      out.push({
        misconceptionId: "mc_mult_add_confusion",
        confidence: 0.6,
        reason: `${r} was written for ${a} × ${b}. This is one of the numbers, not the product of the groups.`,
      });
    }
    // 1 × n or 0 × n — the "multiplication always makes it bigger" idea.
    if ((a <= 1 || b <= 1) && r !== mul) {
      out.push({
        misconceptionId: "mc_mult_always_bigger",
        confidence: 0.8,
        reason: `${a} × ${b} was answered as ${r}. Multiplying by 1 keeps the number the same, and by 0 makes it 0.`,
      });
    }
    // A row counted only once: 6 × 4 answered as 6+6 = 12.
    if (r === a * 2 && b >= 3) {
      out.push({
        misconceptionId: "mc_counting_all",
        confidence: 0.5,
        reason: `${r} is two groups of ${a}. All ${b} groups were not counted.`,
      });
    }
  }

  if (op === "+") {
    // 7 + 4 answered as 12 — 7 + 1 + 2 + 3 + 4, the double-count error.
    if (r === add + a) {
      out.push({
        misconceptionId: "mc_double_count",
        confidence: 0.9,
        reason: `${a} + ${b} was answered as ${r}, which counts ${a} twice. Counting should start at ${a} and count only ${b} more.`,
      });
    }
    // 7 + 4 answered as 20 — counted everything from 1 and lost track.
    if (r >= add + 1 && r <= add + b + 4 && a <= 10 && b <= 10) {
      out.push({
        misconceptionId: "mc_counting_all",
        confidence: 0.6,
        reason: `${r} is more than ${add}. The child counted up from 1 rather than counting on from ${a}.`,
      });
    }
    // 8 + 5 answered as 3 — the carry was lost.
    if (a % 10 + b % 10 >= 10 && r === (a % 10 + b % 10) % 10) {
      out.push({
        misconceptionId: "mc_carry_loss",
        confidence: 0.95,
        reason: `The answer stops at ${r}, which drops the carry of 1 ten. ${a} + ${b} should regroup first.`,
      });
    }
    // Added the products instead.
    if (a < 12 && b < 12 && r === mul) {
      out.push({
        misconceptionId: "mc_mult_add_confusion",
        confidence: 0.7,
        reason: `${a} + ${b} was answered as ${mul}, which is the product ${a} × ${b}.`,
      });
    }
  }

  if (op === "-") {
    // Absolute difference — took the smaller from the larger.
    if (r === Math.abs(sub)) {
      out.push({
        misconceptionId: "mc_subtract_order",
        confidence: 0.9,
        reason: `${a} - ${b} was answered as ${r}, the distance between the numbers, rather than what is left after taking ${b} away.`,
      });
    }
    // Borrow lost: treated 19 as 11.
    if (b % 10 > a % 10 && r === a - (b % 10)) {
      out.push({
        misconceptionId: "mc_carry_loss",
        confidence: 0.85,
        reason: `The tens were not borrowed. ${a} - ${b} needs a ten regrouped before the ones can be subtracted.`,
      });
    }
    // Subtracted the wrong way round, added instead.
    if (r === add) {
      out.push({
        misconceptionId: "mc_subtract_order",
        confidence: 0.7,
        reason: `${a} - ${b} was answered as ${r} by adding. Subtraction tells how many are left, not how many there are together.`,
      });
    }
  }

  if (op === "/") {
    // Multiplied instead.
    if (r === mul) {
      out.push({
        misconceptionId: "mc_mult_add_confusion",
        confidence: 0.85,
        reason: `${a} ÷ ${b} was answered as ${r}, which is ${a} × ${b}. Division shares; it does not multiply.`,
      });
    }
    // Wrote the divisor as the answer.
    if (r === b && b !== Math.trunc(a / b)) {
      out.push({
        misconceptionId: "mc_divisor_quotient_swap",
        confidence: 0.8,
        reason: `${b} is the number being shared into, not the answer. ${a} ÷ ${b} asks how much goes in each part.`,
      });
    }
    // Wrote the total as the answer.
    if (r === a && a !== Math.trunc(a / b)) {
      out.push({
        misconceptionId: "mc_divisor_quotient_swap",
        confidence: 0.7,
        reason: `${a} is the quantity being shared, not the answer.`,
      });
    }
    // Remainder not understood — answer equals the remainder.
    if (a % b !== 0 && r === a % b) {
      out.push({
        misconceptionId: "mc_remainder_meaning",
        confidence: 0.85,
        reason: `${r} is the remainder only. ${a} ÷ ${b} is ${Math.trunc(a / b)} remainder ${a % b}.`,
      });
    }
    // Remainder larger than the divisor.
    if (r > b && a % b !== 0 && r < a) {
      out.push({
        misconceptionId: "mc_remainder_meaning",
        confidence: 0.7,
        reason: `${a} ÷ ${b} cannot have ${r} left over — fewer than ${b} is what is left over.`,
      });
    }
  }

  // Digit reversal is common enough to check against every arithmetic answer.
  const expected =
    op === "+" ? add : op === "-" ? sub : op === "*" ? mul : b === 0 ? NaN : a / b;
  if (Number.isFinite(expected) && isDigitReversal(r, expected)) {
    out.push({
      misconceptionId: "mc_digit_reversal",
      confidence: 0.9,
      reason: `The answer ${r} is the correct answer ${expected} written backwards. The digits are right but in the wrong columns.`,
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Fractions and decimals                                              */
/* ------------------------------------------------------------------ */

const FRACTION_GUARD = /\b(fraction|fractions|भिन्न|आभाग|simplif|proper|improper|numerator|denominator)\b/i;

export function fractionInference(stem: string, response: string): Inference[] {
  const out: Inference[] = [];
  if (!FRACTION_GUARD.test(stem)) return out;
  const r = normalise(response);
  if (!r) return out;

  // "bigger numerator means bigger fraction" — a comparison item answered
  // using the numerators only.
  const compare = stem.match(/(\d+)\s*\/\s*(\d+)\s*([<>])|([<>])\s*(\d+)\s*\/\s*(\d+)/);
  if (compare) {
    const nums = [compare[1], compare[2], compare[5], compare[6]].filter(Boolean).map(Number);
    if (nums.length === 2) {
      const [n1, n2] = nums;
      if (r === normalise(String(n1)) || r === normalise(String(n2))) {
        out.push({
          misconceptionId: "mc_numerator_rule",
          confidence: 0.6,
          reason: `The answer ${r} is one of the top numbers. Fractions are compared by how big the piece is, not by how large the top number looks.`,
        });
      }
    }
  }

  // "More parts means a bigger part".
  if (/1\s*\/\s*(2|3|4|5|6|8|10)/.test(stem) && /^\d+$/.test(r)) {
    out.push({
      misconceptionId: "mc_denominator_bigger_bigger",
      confidence: 0.4,
      reason: `Part sizes must be compared by shading the same whole, not by reading the denominator.`,
    });
  }
  return out;
}

const DECIMAL_GUARD = /\b(decimal|दशमलव|point zero|मुद्रा|rupee|पैसे)\b/i;

export function decimalInference(stem: string, response: string): Inference[] {
  const out: Inference[] = [];
  if (!DECIMAL_GUARD.test(stem)) return out;
  const r = normalise(response);
  if (!r) return out;

  // Money answered as an unconverted paise total: 12.50 + 3.75 -> 16.25 is
  // right, but 15.125 means paise were never turned back into rupees.
  if (/^\d{1,3}\.\d{3,}$/.test(r) && /\b(₹|rs|rupee|रु|पैसे)\b/i.test(stem)) {
    out.push({
      misconceptionId: "mc_money_calculation",
      confidence: 0.85,
      reason: `${r} has more than two decimal places. Paise are the last two digits only — divide by 100 to turn paise back into rupees.`,
    });
  }

  // Comparing decimals: picked the one written with more digits.
  const decimals = stem.match(/\d+\.\d+/g) ?? [];
  if (decimals.length === 2 && r === normalise(decimals[0]) && decimals[0].length > decimals[1].length) {
    out.push({
      misconceptionId: "mc_decimal_digits",
      confidence: 0.6,
      reason: `${decimals[0]} has more decimal places but is the smaller number. Write both with the same number of places before comparing.`,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Public entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Work out which misconception (if any) a wrong answer reveals.
 * Highest-confidence inference wins; the rest are returned for transparency.
 */
export function inferMisconceptions(input: InferenceInput): Inference[] {
  if (!input.isWrong) return [];
  const response = (input.response ?? "").trim();
  if (!response) return []; // blank is "not attempted", a different thing entirely

  const collected: Inference[] = [];

  // 1. Authored tags.
  for (const id of input.diagnoses ?? []) {
    if (!MISCONCEPTION_BY_ID.has(id)) continue;
    const m = MISCONCEPTION_BY_ID.get(id) as Misconception;
    collected.push({
      misconceptionId: id,
      confidence: 0.75,
      reason: `This question was set to check for "${m.name}".`,
    });
  }

  // 2. Distractor diagnosis for multiple choice.
  if (input.type === "mcq" && input.options?.length) {
    const scheme = (input.markScheme ?? {}) as { optionDiagnosis?: Record<string, string> };
    const map = scheme.optionDiagnosis ?? {};
    const key = response.replace(/[^\w]/g, "").toUpperCase().slice(0, 1);
    const hit = map[key];
    if (hit && MISCONCEPTION_BY_ID.has(hit)) {
      const m = MISCONCEPTION_BY_ID.get(hit) as Misconception;
      collected.push({
        misconceptionId: hit,
        confidence: 0.9,
        reason: `Option ${key} was chosen. That option is built from "${m.name}".`,
      });
    }
  }

  // 3. Structural, fraction and decimal analysis.
  collected.push(...structuralInference(input.stem, response));
  collected.push(...fractionInference(input.stem, response));
  collected.push(...decimalInference(input.stem, response));

  // 4. Explicit matcher rules authored per misconception.
  collected.push(...ruleInference(response, input.topicId));

  if (collected.length === 0) return [];

  // Keep the best result per misconception, then rank.
  const best = new Map<string, Inference>();
  for (const c of collected) {
    const prev = best.get(c.misconceptionId);
    if (!prev || c.confidence > prev.confidence) best.set(c.misconceptionId, c);
  }
  return [...best.values()]
    .sort((a, b) => b.confidence - a.confidence)
    // Below this it is guessing, and a wrong guess is worse than no guess.
    .filter((c) => c.confidence >= 0.4);
}

/* ------------------------------------------------------------------ */
/* Authored matcher rules                                              */
/* ------------------------------------------------------------------ */

/**
 * Small hand-written rules for responses that do not depend on the stem —
 * for example a child who writes a word when a number was asked for.
 */
type Rule = { misconceptionId: string; matcher: string; confidence: number; reason: string };

const RULES: Rule[] = [
  {
    misconceptionId: "mc_digit_reversal",
    matcher: "regex:^\\d{2,}$",
    confidence: 0.2, // low: only meaningful alongside a structural match
    reason: "The digits may be in the wrong columns.",
  },
  {
    misconceptionId: "mc_fraction_size",
    matcher: "num:0",
    confidence: 0.5,
    reason: "An answer of 0 usually means the question asked for a part and the child read it as the whole.",
  },
];

function ruleInference(response: string, topicId?: string | null): Inference[] {
  if (!topicId) return [];
  return RULES.filter((r) => {
    // Only apply to topics where the misconception is plausible at all.
    const m = MISCONCEPTION_BY_ID.get(r.misconceptionId);
    return m?.topicIds.includes(topicId) && matchesMisconception(response, r.matcher);
  }).map((r) => ({ misconceptionId: r.misconceptionId, confidence: r.confidence, reason: r.reason }));
}

/** Tag an answer row, returning the single label to store, or null. */
export function primaryMisconception(infos: Inference[]): string | null {
  return infos.length > 0 ? infos[0].misconceptionId : null;
}
