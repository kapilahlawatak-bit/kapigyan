/**
 * Answer normalisation.
 *
 * This is the most load-bearing file in the grading path. A child writing
 * "13", "1 3", "thirteen", "१३", "13.0", "₹13" and "Rs 13" must all be
 * treated as the same answer, because in a real Class-3 answer sheet they
 * all mean the same thing. Getting this wrong produces false "wrong" marks
 * and poisons every downstream analysis.
 *
 * Nothing here uses a library — normalisation has to be predictable and
 * auditable, and every rule is visible to a teacher who disagrees with a mark.
 */

/* Devanagari and other Indian-script digits that commonly appear in answers. */
const DIGIT_SCRIPTS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4",
  "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
  "౦": "0", "౧": "1", "౨": "2", "౩": "3", "౪": "4",
  "౫": "5", "౬": "6", "౭": "7", "౮": "8", "౯": "9",
  "೦": "0", "೧": "1", "೨": "2", "೩": "3", "೪": "4",
  "೫": "5", "೬": "6", "೭": "7", "೮": "8", "೯": "9",
  "௦": "0", "௧": "1", "௨": "2", "௩": "3", "௪": "4",
  "௫": "5", "௬": "6", "௭": "7", "௮": "8", "௯": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

const UNICODE_FRACTIONS: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4",
  "⅐": "1/7", "⅑": "1/9", "⅒": "1/10",
  "⅓": "1/3", "⅔": "2/3",
  "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

/** Common unit suffixes a child writes after a number. */
const UNIT_WORDS = new Set([
  "cm", "mm", "m", "km", "gm", "g", "kg", "ml", "l", "litre", "litres", "liter", "liters",
  "rupees", "rupee", "rs", "paise", "paise", "min", "mins", "minute", "minutes",
  "hr", "hrs", "hour", "hours", "sec", "secs", "second", "seconds", "day", "days",
  "week", "weeks", "month", "months", "year", "years", "times", "th", "am", "pm",
  "kgm", "sq", "cm2", "m2", "sqcm", "sqm",
]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, crore: 10000000, lakh: 100000,
  // Hindi
  "शून्य": 0, "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पांच": 5, "पाँच": 5, "छह": 6,
  "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12, "तेरह": 13,
  "चौदह": 14, "पंद्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19,
  "बीस": 20, "तीस": 30, "चालीस": 40, "पचास": 50, "साठ": 60, "सत्तर": 70,
  "अस्सी": 80, "नब्बे": 90, "सौ": 100, "हजार": 1000,
};

const TRUE_WORDS = new Set(["true", "t", "yes", "y", "sahi", "sahi hai", "सही", "haan", "हाँ", "हां", "1", "right", "correct"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n", "galat", "गलत", "0", "wrong", "incorrect", "nahi", "नहीं"]);

/** Devanagari/Hindi punctuation to plain equivalents. */
function unifyScripts(input: string): string {
  let s = input;
  for (const [from, to] of Object.entries(DIGIT_SCRIPTS)) s = s.split(from).join(to);
  for (const [from, to] of Object.entries(UNICODE_FRACTIONS)) s = s.split(from).join(to);
  s = s.replace(/[–—−]/g, "-").replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'");
  s = s.replace(/।/g, ".").replace(/॥/g, ".").replace(/[，]/g, ",");
  return s;
}

/** Collapse whitespace, trim, and drop zero-width and stray marks. */
function tidy(input: string): string {
  return input
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercase, strip trailing periods and wrapping brackets used for MCQ options. */
function toComparableText(input: string): string {
  let s = tidy(input).toLowerCase();
  s = s.replace(/^(?:option|ans|answer|उत्तर)\s*[:\-.]?\s*/i, "");
  s = s.replace(/^[\(\[\{<]+|[\)\]\}>]+$/g, "");
  s = s.replace(/^[a-z]\s*[\.\):\-]\s*/i, (m) => (m.length <= 3 ? "" : m));
  s = s.replace(/[.।]+$/, "");
  s = s.replace(/[^\p{L}\p{N}\s/+\-.]/gu, "");
  return tidy(s).replace(/\s+/g, " ");
}

/**
 * Parse a numeric answer.
 * Handles: "1,234", "12.50", "1 3" (grouped digits), "1/2", "2 1/2", "13.0",
 * negative values, and leading currency or unit words.
 * Returns null when the text is not a number.
 */
export function toNumber(input: string): number | null {
  let s = tidy(unifyScripts(input)).toLowerCase();
  if (!s) return null;

  // "1 3" or "1, 3" used as a grouped number such as 1,345 or 13.
  const groupedDigits = s.match(/^(-?)(\d{1,3})[\s,](\d{3})$/);
  if (groupedDigits) {
    s = `${groupedDigits[1]}${groupedDigits[2]}${groupedDigits[3]}`;
  } else {
    const looseGroup = s.match(/^(-?)(\d{1,2})\s+(\d{1,2})$/);
    // Only treat as grouped when the first group is a plausible thousands part.
    if (looseGroup && !/^(?:add|plus|and|हजार|हज़ार)/i.test(looseGroup[0])) {
      s = `${looseGroup[1]}${looseGroup[2]}${looseGroup[3]}`;
    }
  }

  s = s
    .replace(/^(?:₹|rs\.?|inr|रु|रूपये|रुपये)\s*/, "")
    .replace(/^\s*(?:of|answer)\s+/, "");

  // Mixed number: "2 1/2" or "2½"
  const mixed = s.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return whole < 0 ? whole - Number(mixed[2]) / den : whole + Number(mixed[2]) / den;
  }

  // Fraction: "3/4"
  const frac = s.match(/^(-?)\s*(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const den = Number(frac[3]);
    if (den === 0) return null;
    const value = Number(frac[2]) / den;
    return frac[1] ? -value : value;
  }

  // Decimal, with a trailing unit word left over.
  const dec = s.match(/^(-?[\d.]+)(?:\s*([a-z²%p]+))?$/);
  if (dec) {
    const num = Number(dec[1]);
    if (!Number.isFinite(num)) return null;
    const unit = (dec[2] ?? "").trim();
    if (unit && !UNIT_WORDS.has(unit)) return null;
    return num;
  }

  // Word form, including "twenty three".
  return wordToNumber(s);
}

function wordToNumber(s: string): number | null {
  const cleaned = s.replace(/[-]/g, " ").trim();
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/);
  let total = 0;
  let matched = false;
  for (const part of parts) {
    const v = NUMBER_WORDS[part];
    if (v === undefined) return null;
    matched = true;
    if (v === 100) total = (total || 1) * 100;
    else if (v === 1000) total = (total || 1) * 1000;
    else if (v >= 100000) total += v;
    else total += v;
  }
  return matched ? total : null;
}

/** Canonical form of a number for comparison: 13.00 and 13 must match. */
export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  // Round away float noise from things like 1/3 in a child's answer.
  return String(Number(n.toFixed(6)));
}

/**
 * A single canonical representation of a child's answer, used for equality.
 * Returns a string so it can be compared, grouped and counted.
 */
export function normalise(input: string): string {
  const raw = tidy(unifyScripts(input ?? ""));
  if (!raw) return "";
  const lower = raw.toLowerCase();

  if (TRUE_WORDS.has(lower) && !/^\d+\.\d+$/.test(lower)) return "true";
  if (FALSE_WORDS.has(lower) && !/^\d+\.\d+$/.test(lower)) return "false";

  const num = toNumber(raw);
  if (num !== null) return canonicalNumber(num);

  return toComparableText(raw);
}

/** True when two answers mean the same thing. */
export function answersMatch(given: string, expected: string): boolean {
  const a = normalise(given);
  const b = normalise(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  // Numeric near-match guards against float and rounding drift.
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-9) return true;
  return false;
}

/** Answers a teacher would also accept: the canonical key plus alternates. */
export function acceptedSet(answerKey: string, accepted: string[] = []): string[] {
  return [answerKey, ...accepted].map((a) => normalise(a)).filter(Boolean);
}

/**
 * Split a multi-part answer ("12, 15, 9") into parts, so a partially correct
 * answer earns partial marks instead of nothing.
 */
export function splitParts(input: string): string[] {
  return tidy(unifyScripts(input))
    .split(/[,;/\n]|\band\b|और|और\b/)
    .map((p) => normalise(p))
    .filter(Boolean);
}

/** Grade one short free-text answer against a set of acceptable answers. */
export function gradeExact(
  given: string,
  answerKey: string,
  accepted: string[] = [],
): { correct: boolean; givenNorm: string } {
  const givenNorm = normalise(given);
  if (!givenNorm) return { correct: false, givenNorm };
  const targets = acceptedSet(answerKey, accepted);
  if (targets.length === 0) return { correct: false, givenNorm };
  const correct = targets.some((t) => t === givenNorm);
  return { correct, givenNorm };
}

/* ------------------------------------------------------------------ */
/* Free-text (long answer) grading                                     */
/* ------------------------------------------------------------------ */

export type MarkScheme = {
  /** The steps that must appear, e.g. ["3 tens", "4 ones"]. */
  steps?: string[];
  /** Marks awarded when every step is present. */
  full?: number;
  /** Words that signal the child is on the right method, even if arithmetic slips. */
  keywords?: string[];
  /** Answer must contain this reasoning even if the final number is wrong. */
  methodOnly?: string;
};

export type FreeTextResult = {
  marksAwarded: number;
  maxMarks: number;
  correct: boolean;
  /** Method was right even though the arithmetic was not — very common and worth credit. */
  methodCredit: boolean;
  missing: string[];
  confidence: number;
  needsReview: boolean;
};

/**
 * Rule-based marking for long/medium answers.
 *
 * The design intent: give credit for correct *reasoning* even when the final
 * arithmetic is wrong, because that is exactly the signal a primary teacher
 * needs in order to choose between "reteach the method" and "practise arithmetic".
 * Anything the rules are unsure about is sent to a human rather than guessed.
 */
export function gradeFreeText(
  given: string,
  scheme: MarkScheme,
  maxMarks: number,
): FreeTextResult {
  const givenNorm = normalise(given);
  const empty: FreeTextResult = {
    marksAwarded: 0, maxMarks, correct: false, methodCredit: false,
    missing: [], confidence: 1, needsReview: false,
  };
  if (!givenNorm) return empty;

  const steps = scheme.steps ?? [];
  const keywords = scheme.keywords ?? [];
  const full = scheme.full ?? maxMarks;

  const presentSteps = steps.filter((s) => normalise(s) && (normalise(given).includes(normalise(s)) || givenNorm === normalise(s)));
  const missing = steps.filter((s) => !presentSteps.includes(s));
  const hasKeywords = keywords.length > 0 && keywords.every((k) => givenNorm.includes(normalise(k)));

  // Complete method, or every step plus the keywords.
  if (steps.length === 0 && hasKeywords) {
    return { marksAwarded: full, maxMarks, correct: true, methodCredit: false, missing: [], confidence: 0.9, needsReview: false };
  }
  if (missing.length === 0 && (hasKeywords || keywords.length === 0)) {
    return { marksAwarded: full, maxMarks, correct: true, methodCredit: false, missing: [], confidence: 0.9, needsReview: false };
  }

  // Method present, arithmetic wrong: award the method share of the marks.
  if (presentSteps.length > 0 || (hasKeywords && scheme.methodOnly)) {
    const partial = Math.max(1, Math.round(full * 0.6 * 2) / 2);
    return {
      marksAwarded: partial, maxMarks, correct: false, methodCredit: true,
      missing, confidence: 0.6, needsReview: true,
    };
  }

  return { marksAwarded: 0, maxMarks, correct: false, methodCredit: false, missing, confidence: 0.5, needsReview: true };
}

/* ------------------------------------------------------------------ */
/* Misconception-shaped distractor scoring                            */
/* ------------------------------------------------------------------ */

/**
 * Does a wrong answer match a misconception's predicted wrong answer?
 *
 * Used to work out *why* a child got a question wrong even when the question
 * itself carried no misconception tag. Each misconception declares a matcher
 * over the child's raw response.
 */
export function matchesMisconception(response: string, matcher: string): boolean {
  const r = normalise(response);
  if (!r || !matcher) return false;
  if (matcher.startsWith("regex:")) {
    try {
      return new RegExp(matcher.slice(6), "i").test(response.trim());
    } catch {
      return false;
    }
  }
  if (matcher.startsWith("num:")) {
    const n = toNumber(response);
    if (n === null) return false;
    for (const part of matcher.slice(4).split(",")) {
      const target = Number(part.trim());
      if (Number.isFinite(target) && Math.abs(n - target) < 1e-9) return true;
    }
    return false;
  }
  return normalise(matcher) === r;
}
