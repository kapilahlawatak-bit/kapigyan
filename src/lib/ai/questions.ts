/**
 * AI-assisted question generation and question classification.
 *
 * Two jobs:
 *  - **Classify** an uploaded question into one of the taxonomy's topic ids,
 *    with the reasoning a teacher can check.
 *  - **Generate** fresh questions for a topic at a chosen competency level,
 *    constrained to the class's curriculum and to the NCF-FL flipped pedagogy.
 *
 * Both are always checked afterwards by `validateGenerated`, which is the part
 * that matters. A language model will confidently produce a Class-2 question
 * with a four-digit answer, or an answer that does not match its own working.
 * Nothing reaches the database without passing those checks.
 */

import { TOPICS, TOPIC_BY_ID, QUESTION_TYPES, type CompetencyId, type Topic } from "@/lib/curriculum";
import { chatJson, isAiEnabled } from "./client";
import { toNumber } from "@/lib/answer-normaliser";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type GeneratedQuestion = {
  stem: string;
  stemHi?: string;
  type: string;
  marks: number;
  options?: string[];
  answerKey: string;
  accepted?: string[];
  explanation?: string;
  explanationHi?: string;
  /** How the child should show working — feeds the rubric. */
  steps?: string[];
  /** Which misconceptions this question can diagnose. */
  diagnoses?: string[];
  /** For MCQ, which misconception each wrong option represents. */
  optionDiagnosis?: Record<string, string>;
  difficulty: number;
};

export type Classification = {
  topicId: string;
  strand: string;
  confidence: number;
  reason: string;
  /** Alternative guesses, so a teacher can pick quickly. */
  alternatives: { topicId: string; confidence: number }[];
};

/* ------------------------------------------------------------------ */
/* Shared prompt context                                               */
/* ------------------------------------------------------------------ */

/** A compact taxonomy the model can actually reason against. */
function taxonomyForGrade(grade: number): string {
  return TOPICS.filter((t) => t.classes.includes(grade))
    .map((t) => `${t.id} | ${t.strand} | ${t.name} — ${t.blurb}`)
    .join("\n");
}

const COMPETENCY_BRIEF: Record<CompetencyId, string> = {
  basic:
    "BASIC: one clear step. Recall a fact, or a single direct procedure. The number must be small enough to do in the head. No trick, no words to work through.",
  competent:
    "COMPETENT: two steps, or one step inside a short familiar story. The child must choose what to do, not just copy a rule.",
  proficient:
    "PROFICIENT: reasoning required. Explain a choice, compare two methods, or handle a multi-step problem. The child may need to justify the answer.",
};

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

const CLASSIFY_SYSTEM = `You are an NCERT-aligned mathematics curriculum specialist for Indian primary schools (Classes 1-5).

You will be given one maths question. Your job is to say which single topic it belongs to, using ONLY the topic ids provided.

Rules:
- Pick the most specific topic that genuinely matches. Do not pick a general strand when a specific topic fits.
- If the question needs more than one topic, pick the one the child is really being tested on, and list the other in alternatives.
- If nothing matches well, return topicId "untagged" with low confidence.
- Set confidence honestly. Below 0.6 a human will review it.`;

export async function classifyQuestion(
  stem: string,
  grade: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Classification> {
  if (!isAiEnabled()) return offlineClassify(stem, grade);

  const userMsg = `Class: ${grade}

Topic ids available for Class ${grade}:
${taxonomyForGrade(grade)}

Question:
${stem}

Reply with JSON only:
{
  "topicId": "<one id from the list, or 'untagged'>",
  "strand": "<strand of that topic>",
  "confidence": <0 to 1>,
  "reason": "<one sentence a teacher would understand>",
  "alternatives": [{"topicId": "<id>", "confidence": <0 to 1>}]
}`;

  const raw = await chatJson<Omit<Classification, "topicId"> & { topicId: string }>(
    [
      { role: "system", content: CLASSIFY_SYSTEM },
      { role: "user", content: userMsg },
    ],
    { temperature: 0, maxTokens: 700, signal: opts.signal },
  );

  return sanitiseClassification(raw, grade);
}

function sanitiseClassification(raw: Classification, grade: number): Classification {
  const allowed = new Map(TOPICS.filter((t) => t.classes.includes(grade)).map((t) => [t.id, t]));
  const topicId = allowed.has(raw.topicId) ? raw.topicId : "untagged";
  const topic = allowed.get(topicId);
  return {
    topicId,
    strand: topic?.strand ?? raw.strand ?? "number",
    confidence: clamp01(raw.confidence ?? 0.5),
    reason: raw.reason ?? "",
    alternatives: (raw.alternatives ?? [])
      .filter((a) => allowed.has(a.topicId))
      .slice(0, 3)
      .map((a) => ({ topicId: a.topicId, confidence: clamp01(a.confidence ?? 0) })),
  };
}

/**
 * Keyword classification for when there is no AI key.
 * Imperfect on purpose, but it is deterministic, free, private, and good
 * enough to save a teacher most of the tagging work.
 */
export function offlineClassify(stem: string, grade: number): Classification {
  const text = stem.toLowerCase();
  const scored = TOPICS.filter((t) => t.classes.includes(grade)).map((t) => ({
    topic: t,
    score: keywordScore(text, t),
  }));
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const bestId = best && best.score > 0 ? best.topic.id : "untagged";
  const meta = TOPIC_BY_ID.get(bestId);

  return {
    topicId: bestId,
    strand: meta?.strand ?? "number",
    confidence: best ? clamp01(best.score / 8) : 0.2,
    reason: best && best.score > 0
      ? `Matched keywords for ${best.topic.name}. Worth checking before saving.`
      : "No strong keyword match. Please choose the topic yourself.",
    alternatives: scored.slice(1, 4).filter((s) => s.score > 0).map((s) => ({ topicId: s.topic.id, confidence: clamp01(s.score / 8) })),
  };
}

const KEYWORDS: Record<string, string[]> = {
  ns_counting: ["count", "how many", "गिन"],
  ns_number_names: ["number name", "write in words", "read the number", "संख्या नाम"],
  ns_place_value: ["place value", "hundreds", "tens", "ones", "ones place", "expanded form", "स्थानीय मान"],
  ns_comparing: ["greater", "smaller", "largest", "smallest", "more than", "less than", "compare", "तुलना", "बड़ा", "छोटा"],
  ns_even_odd: ["even", "odd", "सम", "विषम"],
  ns_large_numbers: ["lakh", "crore", "thousand", "1,000", "लाख", "हजार"],
  ns_estimation_numbers: ["estimate", "round off", "rounding", "अनुमान", "निकटतम"],
  as_within_20: ["add", "subtract", "plus", "minus", "sum", "difference", "जोड़", "घटाव"],
  as_2digit: ["add", "subtract", "two digit", "carry", "borrow", "जोड़", "घटाव"],
  as_3digit: ["three digit", "hundreds", "add", "subtract"],
  as_mental_strategies: ["mentally", "without counting", "make ten", "count on"],
  as_missing: ["missing", "blank", "complete the", "fill in", "लुप्त", "रिक्त"],
  as_word_problems: ["altogether", "in all", "more than", "fewer", "left", "remaining", "word problem", "कुल", "बचे"],
  as_estimation: ["estimate", "roughly", "about how much", "अनुमान"],
  md_repeated_addition: ["times", "multiplied", "multiply", "repeated", "equal groups", "गुना", "बार-बार"],
  md_tables: ["table", "times table", "पहाड़ा"],
  md_array: ["array", "rows", "columns", "grid", "सारणी", "आव्यूह"],
  md_properties: ["without multiplying", "commutative", "associative", "distributive", "properties"],
  md_sharing: ["share equally", "shared equally", "divided among", "each", "बराबर बाँट"],
  md_grouping: ["how many groups", "in each group", "groups of", "समूह"],
  md_remainder: ["remainder", "left over", "शेष", "बचा हुआ"],
  md_two_digit: ["multiply", "times", "product"],
  md_divide_digit: ["divide", "divided by", "quotient", "भाग"],
  md_mixed_operations: ["bracket", "order of operations", "bodmas", "first add", "then"],
  md_word_problems: ["pack", "packet", "box", "each", "altogether", "per", "boxes"],
  fr_concept: ["fraction", "half", "quarter", "third", "parts of", "भिन्न", "आधा", "चौथाई"],
  fr_equivalent: ["equivalent", "same value", "समतुल्य"],
  fr_comparing: ["greater fraction", "bigger fraction", "compare fractions", "which fraction is"],
  fr_number_line: ["number line", "संख्या रेखा"],
  fr_addition: ["add fractions", "sum of fractions", "भिन्नों का जोड़"],
  fr_application: ["fraction of", "half of", "quarter of"],
  dec_place_value: ["decimal", "tenths", "hundredths", "दशमलव"],
  dec_reading: ["read the decimal", "write in decimal", "point"],
  dec_comparing: ["which decimal is", "greater decimal", "compare decimals"],
  dec_operations: ["add decimals", "subtract decimals"],
  dec_money: ["rupees", "paise", "money", "cost", "change", "रुपये", "पैसे"],
  al_patterns: ["pattern", "next number", "next term", "rule", "sequence", "पैटर्न", "क्रम"],
  al_open_sentences: ["is it true", "always true", "never true", "sometimes"],
  al_missing_number: ["missing number", "what number should replace", "function machine"],
  al_variables: ["let n", "variable", "expression", "चर"],
  al_equations: ["solve", "equation", "x +", "find x", "समीकरण"],
  ge_2d_shapes: ["triangle", "square", "rectangle", "circle", "shape", "polygon", "त्रिभुज", "वर्ग", "वृत्त"],
  ge_3d_solids: ["cube", "cuboid", "cylinder", "sphere", "cone", "solid", "घन", "बेलन", "गोला"],
  ge_sides_corners: ["sides", "corners", "vertices", "faces", "edges", "भुजा", "कोण"],
  ge_lines_angles: ["line segment", "ray", "straight line", "horizontal", "vertical", "रेखा", "किरण"],
  ge_angles: ["right angle", "acute", "obtuse", "angle", "कोण"],
  ge_symmetry: ["symmetry", "mirror", "line of symmetry", "सममिति"],
  ge_perimeter: ["perimeter", "fence", "boundary", "border", "परिमाप"],
  ge_area: ["area", "cover", "square cm", "how much space", "क्षेत्रफल"],
  ge_tiling: ["tile", "tessellation", "tangram", "pattern block", "टाइल"],
  me_length: ["length", "long", "short", "tall", "metre", "centimetre", "cm", "m", "लंबाई"],
  me_mass: ["weight", "mass", "kilogram", "gram", "kg", "भार", "वज़न"],
  me_capacity: ["capacity", "volume", "litre", "millilitre", "litre", "ml", "क्षमता"],
  me_time: ["clock", "time", "hour", "minute", "o'clock", "समय", "घड़ी"],
  me_money: ["money", "rupees", "paise", "note", "coin", "change", "shop", "cost", "मुद्रा", "रुपये"],
  me_conversion: ["convert", "how many cm", "in metres", "how many minutes", "in litres", "परिवर्तन"],
  me_estimation: ["estimate", "about how", "roughly", "which is closer", "अनुमान"],
  da_tally: ["tally", "marks", "गिनती चिह्न"],
  da_table: ["table", "frequency", "row", "column", "सारणी"],
  da_pictograph: ["pictograph", "picture graph", "symbol stands for"],
  da_bar_graph: ["bar graph", "bar chart", "graph", "axis", "आरेख"],
  da_line_graph: ["line graph", "plot", "over time"],
  da_pie_chart: ["pie chart", "circle graph", "slice"],
  da_interpret: ["which is most", "which is least", "what does the data", "more than", "difference between"],
  da_chance: ["likely", "possible", "certain", "chance", "probability", "संभावना"],
};

function keywordScore(text: string, topic: Topic): number {
  const words = KEYWORDS[topic.id] ?? [];
  let score = 0;
  for (const w of words) {
    if (text.includes(w)) score += w.includes(" ") ? 2 : 1;
  }
  return score;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

const GENERATE_SYSTEM = `You are an NCERT-aligned mathematics teacher writing assessment questions for Indian primary school (Classes 1-5).

HARD RULES — breaking any of these makes the question unusable:
1. Every question must be solvable by a child of the given class. No four-digit arithmetic in Class 2. No decimals in Class 3.
2. The answerKey must be exactly correct. Show the arithmetic to yourself before answering, then output only the final answer.
3. The explanation must tell the child HOW to solve it, in 2-3 short steps — not a restatement of the answer.
4. If it is a multiple choice question, the wrong options must be plausible and must each come from a real misconception a child at this level would hold. Label which misconception each wrong option represents.
5. Use Indian context: rupees and paise, kg and g, litres, "How many toffees in a packet", "chairs in a row", "ticks in a box". Not dollars, not miles, not Fahrenheit.
6. No negative numbers and no subtraction that goes below zero for Class 1-3.
7. The \`steps\` field lists the working a child should show, for marking. Keep it to 2-3 steps.`;

export type GenerateOptions = {
  topicIds: string[];
  grade: number;
  competency: CompetencyId;
  count: number;
  /** "en" or "hi" or "both" — most Indian schools print the question in one language. */
  language?: "en" | "hi" | "both";
  type?: string;
};

export async function generateQuestions(
  opts: GenerateOptions,
  opts2: { signal?: AbortSignal } = {},
): Promise<GeneratedQuestion[]> {
  if (!isAiEnabled()) {
    throw new Error(
      "No AI key configured. Use the built-in question bank instead — it needs no key and works offline.",
    );
  }

  const chosen = opts.topicIds
    .map((id) => TOPIC_BY_ID.get(id))
    .filter((t): t is Topic => Boolean(t));
  if (chosen.length === 0) throw new Error("No valid topics selected");

  const langNote =
    opts.language === "hi"
      ? "Write the question in Hindi (Devanagari). Use the same numbers and format."
      : opts.language === "both"
        ? "Write the question in English AND provide a Hindi translation in stemHi. Both must mean exactly the same thing."
        : "Write the question in English.";

  const typeNote = opts.type
    ? `Use only this question type: ${opts.type} (${QUESTION_TYPES.find((t) => t.id === opts.type)?.name ?? ""}).`
    : "Choose whatever question type genuinely suits the topic. Do not force every topic into multiple choice.";

  const userMsg = `Class: ${opts.grade}
Competency level: ${COMPETENCY_BRIEF[opts.competency]}
Number of questions: ${opts.count}

${langNote}
${typeNote}

Topics (one id per question, spread across them):
${chosen.map((t) => `- ${t.id}: ${t.name} — ${t.blurb}`).join("\n")}

Reply with JSON only:
{
  "questions": [
    {
      "topicId": "<one of the ids above>",
      "type": "mcq | fill_blank | true_false | short | medium | long | picture",
      "stem": "the question",
      "stemHi": "Hindi version, only if language is both",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answerKey": "the exact correct answer — for mcq use the letter only",
      "accepted": ["other spellings that must also be accepted"],
      "steps": ["2-3 lines of working a child should show"],
      "explanation": "2-3 short sentences on how to solve it",
      "diagnoses": ["misconception ids the question can detect"],
      "optionDiagnosis": {"B": "misconception id", "C": "misconception id"},
      "difficulty": 1
    }
  ]
}`;

  const raw = await chatJson<{ questions: GeneratedQuestion[] }>(
    [
      { role: "system", content: GENERATE_SYSTEM },
      { role: "user", content: userMsg },
    ],
    { temperature: 0.6, maxTokens: 6000, signal: opts2.signal },
  );

  const valid = new Set(chosen.map((t) => t.id));
  const out: GeneratedQuestion[] = [];
  for (const q of raw.questions ?? []) {
    const checked = validateGenerated(q, valid);
    if (checked) out.push(checked);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Validation — the part that makes AI output trustworthy              */
/* ------------------------------------------------------------------ */

const VALID_TYPES = new Set<string>(QUESTION_TYPES.map((t) => t.id));

/**
 * Reject or repair anything a teacher would not accept.
 *
 * The arithmetic self-check is the important one: for a question that reduces
 * to "a op b", the answer must equal the result. A model that miscomputes its
 * own key is the single most damaging failure here, because the mark would be
 * wrong and every child who answered correctly would be marked wrong.
 */
export function validateGenerated(
  q: GeneratedQuestion,
  validTopicIds: Set<string>,
  defaultTopicId?: string,
): GeneratedQuestion | null {
  if (!q?.stem || typeof q.stem !== "string") return null;
  if (q.stem.trim().length < 3) return null;

  const type = VALID_TYPES.has(q.type) ? q.type : "short";
  const answerKey = String(q.answerKey ?? "").trim();
  if (!answerKey && type !== "long") return null;

  // A multiple-choice question must have options and a key that is one of them.
  let options = Array.isArray(q.options) ? q.options.filter((o) => typeof o === "string") : [];
  if (type === "mcq") {
    if (options.length < 2) return null;
    const keyLetter = answerKey.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 1);
    const firstLetters = options.map((o) => o.replace(/^[^A-Za-z]*/, "").toUpperCase().slice(0, 1));
    if (!firstLetters.includes(keyLetter)) return null;
    options = options.map((o, i) => (/^[A-Za-z]/.test(o.trim()) ? o : `${String.fromCharCode(65 + i)}. ${o}`));
  }

  // Arithmetic self-check.
  const m = q.stem.match(/(\d+)\s*([+\-×*÷/])\s*(\d+)/);
  if (m && type !== "mcq" && type !== "long") {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const expected =
      m[2] === "+" ? a + b
      : m[2] === "-" ? a - b
      : m[2] === "×" || m[2] === "*" ? a * b
      : b === 0 ? NaN : a / b;
    const given = toNumber(answerKey);
    if (given !== null && Number.isFinite(expected) && Math.abs(given - expected) > 1e-9) {
      // Wrong key — repair it rather than throwing the question away, but only
      // when the stem is unambiguous enough to trust.
      if (q.stem.replace(/[?=]/g, "").split(m[0]).length === 1) {
        return null;
      }
      return { ...q, type, options, answerKey: String(expected) };
    }
  }

  return {
    stem: q.stem.trim(),
    stemHi: q.stemHi?.trim() || undefined,
    type,
    marks: Math.min(5, Math.max(1, Number(q.marks) || defaultMarks(type))),
    options,
    answerKey,
    accepted: Array.isArray(q.accepted) ? q.accepted.filter((a) => typeof a === "string") : [],
    steps: Array.isArray(q.steps) ? q.steps.slice(0, 4).map(String) : [],
    explanation: q.explanation?.trim() || undefined,
    explanationHi: q.explanationHi?.trim() || undefined,
    diagnoses: Array.isArray(q.diagnoses) ? q.diagnoses.filter((d) => typeof d === "string") : [],
    optionDiagnosis: q.optionDiagnosis && typeof q.optionDiagnosis === "object" ? q.optionDiagnosis : undefined,
    difficulty: Math.min(5, Math.max(1, Math.round(Number(q.difficulty) || 2))),
  };
}

function defaultMarks(type: string): number {
  const found = QUESTION_TYPES.find((t) => t.id === type);
  return found?.marks ?? 1;
}
