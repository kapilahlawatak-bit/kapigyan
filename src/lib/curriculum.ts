/**
 * Kapigyan — Curriculum taxonomy for Mathematics, Classes 1–5 (India)
 *
 * Aligned to:
 *  - NCERT / CBSE primary Mathematics syllabi (Math-Magic 1–2, primary 3–5)
 *  - NCF-FL 2023 (National Curriculum Framework for the Foundational Stage),
 *    which organises Grades 1–2 as "Foundational" and Grades 3–5 as
 *    "Preparatory-to-Transition", and prescribes a Flipped Pedagogy
 *    (Concrete → Pictorial → Abstract, contextual and story based).
 *  - FLN (Foundational Literacy and Numeracy) 2022 / 2025 Grade-3 diagnostic
 *    domains, so that reports can be mapped to the national benchmark.
 *
 * This file is the single source of truth for:
 *  - Topic classification of every question in the question bank
 *  - Gap analysis ("which strand, which class level, which misconception")
 *  - Remediation routing ("what to reteach, and how")
 *
 * Topic ids are stable strings: they are persisted in the database, so never
 * renumber or rename an existing id - add a new one instead.
 *
 * Competitive-exam depth (`compTier`, `compIdea`) is attached by joining to
 * `competition.ts` below. That assignment is a structural interpretation, not a
 * published syllabus - see the note at the top of that file.
 */

import { compIdeaOf, compTierOf } from "@/lib/competition";


/* ------------------------------------------------------------------ */
/* Strands (NCF-FL content strands, collapsed to 8 analysis strands)   */
/* ------------------------------------------------------------------ */

export const STRANDS = [
  {
    id: "number",
    name: "Number Sense",
    nameHi: "संख्या बोध",
    icon: "Hash",
    color: "#6366f1",
    blurb:
      "Counting, reading and writing numbers, place value, comparing, ordering and the even/odd idea.",
  },
  {
    id: "addition_subtraction",
    name: "Addition & Subtraction",
    nameHi: "जोड़ और घटाव",
    icon: "Plus",
    color: "#06b6d4",
    blurb:
      "Combining and removing, mental strategies, regrouping, missing addends and word problems.",
  },
  {
    id: "multiplication_division",
    name: "Multiplication & Division",
    nameHi: "गुणा और भाग",
    icon: "X",
    color: "#10b981",
    blurb:
      "Equal groups, arrays, tables, properties of multiplication, sharing, grouping and remainders.",
  },
  {
    id: "fractions_decimals",
    name: "Fractions & Decimals",
    nameHi: "भिन्न और दशमलव",
    icon: "PieChart",
    color: "#f59e0b",
    blurb:
      "Parts of a whole, equivalence, comparing, the number line, tenths and hundredths, money.",
  },
  {
    id: "algebra",
    name: "Algebra (Patterns)",
    nameHi: "बीजगणित / पैटर्न",
    icon: "Sigma",
    color: "#8b5cf6",
    blurb:
      "Patterns, simple rules, number sentences, missing numbers and first equations.",
  },
  {
    id: "geometry",
    name: "Geometry",
    nameHi: "ज्यामिति",
    icon: "Shapes",
    color: "#ec4899",
    blurb:
      "2D shapes, 3D solids, sides and corners, lines and angles, symmetry, perimeter and area.",
  },
  {
    id: "measurement",
    name: "Measurement",
    nameHi: "माप",
    icon: "Ruler",
    color: "#0ea5e9",
    blurb:
      "Length, mass, capacity, time, money, temperature, unit conversion and estimation.",
  },
  {
    id: "data_probability",
    name: "Data & Probability",
    nameHi: "आँकड़े और संभावना",
    icon: "BarChart3",
    color: "#14b8a6",
    blurb:
      "Tally marks, tables, pictographs, bar and line graphs, reading data and simple chance.",
  },
] as const;

export type StrandId = (typeof STRANDS)[number]["id"];

/* ------------------------------------------------------------------ */
/* FLN 2022 / 2025 domains (Grade-3 national diagnostic)              */
/* ------------------------------------------------------------------ */

export const FLN_DOMAINS = [
  { id: "number_sense", name: "Number Sense", nameHi: "संख्या बोध" },
  { id: "addition_subtraction", name: "Addition & Subtraction", nameHi: "जोड़-घटाव" },
  { id: "multiplication_division", name: "Multiplication & Division", nameHi: "गुणा-भाग" },
  { id: "measurement", name: "Measurement", nameHi: "माप" },
  { id: "geometry", name: "Geometry", nameHi: "ज्यामिति" },
  { id: "data_handling", name: "Data Handling", nameHi: "आँकड़ा प्रबंधन" },
  { id: "spatial_visualisation", name: "Spatial & Visualisation", nameHi: "स्थानिक दृष्टि" },
] as const;

export type FlnDomainId = (typeof FLN_DOMAINS)[number]["id"];

/* ------------------------------------------------------------------ */
/* Topics                                                              */
/* ------------------------------------------------------------------ */

export type Topic = {
  /** Stable identifier - persisted, never change. */
  id: string;
  strand: StrandId;
  name: string;
  nameHi: string;
  /** Classes in which this topic is normally taught / assessed. */
  classes: number[];
  fln: FlnDomainId[];
  blurb: string;
};

export const TOPICS: Topic[] = [
  /* ---------------- Number Sense ---------------- */
  { id: "ns_counting", strand: "number", name: "Counting & One-to-One", nameHi: "गिनना", classes: [1, 2], fln: ["number_sense"], blurb: "Counting objects reliably, matching one object to one count word." },
  { id: "ns_number_names", strand: "number", name: "Reading & Writing Number Names", nameHi: "संख्या नाम", classes: [1, 2, 3], fln: ["number_sense"], blurb: "Writing and reading numerals 0–999, words, and numerals in order." },
  { id: "ns_ordering", strand: "number", name: "Before / After / Between", nameHi: "पहले बाद में", classes: [1, 2, 3], fln: ["number_sense"], blurb: "Finding the number before, after and in between; number sequences." },
  { id: "ns_comparing", strand: "number", name: "Comparing Numbers (> < =)", nameHi: "तुलना", classes: [1, 2, 3, 4], fln: ["number_sense"], blurb: "Saying which number is greater, smaller or equal — by counting on, not digit size." },
  { id: "ns_ordering_magnitude", strand: "number", name: "Ordering Numbers", nameHi: "क्रम", classes: [2, 3, 4], fln: ["number_sense"], blurb: "Arranging numbers from smallest to largest and back." },
  { id: "ns_place_value", strand: "number", name: "Place Value (ones/tens/hundreds)", nameHi: "स्थानीय मान", classes: [3, 4, 5], fln: ["number_sense"], blurb: "The 3 in 342 is 3 tens, 4 is 4 ones. Expanded and contracted form." },
  { id: "ns_even_odd", strand: "number", name: "Even & Odd Numbers", nameHi: "सम और विषम", classes: [2, 3, 4, 5], fln: ["number_sense"], blurb: "Grouping in pairs and in ones; the last-digit rule." },
  { id: "ns_large_numbers", strand: "number", name: "Large Numbers & Indian System", nameHi: "बड़ी संख्याएँ", classes: [4, 5], fln: ["number_sense"], blurb: "Thousands to lakhs and crores, comma notation, Indian vs international place value." },
  { id: "ns_estimation_numbers", strand: "number", name: "Estimation & Rounding", nameHi: "अनुमान", classes: [3, 4, 5], fln: ["number_sense"], blurb: "Rounding to the nearest ten/hundred and estimating a sum." },

  /* ---------------- Addition & Subtraction ---------------- */
  { id: "as_within_20", strand: "addition_subtraction", name: "Adding & Subtracting within 20", nameHi: "20 तक जोड़-घटाव", classes: [1, 2], fln: ["addition_subtraction"], blurb: "Counting on and counting back fluently, not counting all from 1." },
  { id: "as_2digit", strand: "addition_subtraction", name: "2-Digit Addition & Subtraction", nameHi: "2-अंकीय जोड़-घटाव", classes: [2, 3], fln: ["addition_subtraction"], blurb: "Column method with and without carrying/borrowing." },
  { id: "as_3digit", strand: "addition_subtraction", name: "3-Digit Addition & Subtraction", nameHi: "3-अंकीय जोड़-घटाव", classes: [3, 4], fln: ["addition_subtraction"], blurb: "Regrouping across hundreds and tens." },
  { id: "as_4digit", strand: "addition_subtraction", name: "Larger Numbers (4-digit+)", nameHi: "बड़ी संख्याओं का जोड़-घटाव", classes: [4, 5], fln: ["addition_subtraction"], blurb: "Adding and subtracting thousands and ten-thousands." },
  { id: "as_mental_strategies", strand: "addition_subtraction", name: "Mental Strategies", nameHi: "मानसिक कौशल", classes: [1, 2, 3, 4], fln: ["addition_subtraction"], blurb: "Making ten, counting on, counting back, compensation and near doubles." },
  { id: "as_missing", strand: "addition_subtraction", name: "Missing Addend / Subtrahend", nameHi: "लुप्त पद", classes: [2, 3, 4], fln: ["addition_subtraction"], blurb: "Finding which number makes the number sentence true." },
  { id: "as_word_problems", strand: "addition_subtraction", name: "Addition & Subtraction Word Problems", nameHi: "शब्द समस्या", classes: [1, 2, 3, 4], fln: ["addition_subtraction"], blurb: "Choosing the correct operation from a real-life story." },
  { id: "as_estimation", strand: "addition_subtraction", name: "Estimating a Sum or Difference", nameHi: "अनुमानित जोड़", classes: [3, 4, 5], fln: ["addition_subtraction"], blurb: "Rounding before adding; checking whether an answer is sensible." },

  /* ---------------- Multiplication & Division ---------------- */
  { id: "md_repeated_addition", strand: "multiplication_division", name: "Multiplication as Repeated Addition", nameHi: "बार-बार जोड़ना", classes: [2, 3], fln: ["multiplication_division"], blurb: "Understanding 4 × 3 as four groups of three." },
  { id: "md_tables", strand: "multiplication_division", name: "Tables & Facts", nameHi: "पहाड़े", classes: [2, 3, 4], fln: ["multiplication_division"], blurb: "Recalling tables of 2, 3, 4, 5, 6, 7, 8, 9, 10 and 11 fluently." },
  { id: "md_array", strand: "multiplication_division", name: "Arrays & Grids", nameHi: "सारणी / आव्यूह", classes: [2, 3, 4], fln: ["multiplication_division"], blurb: "Seeing multiplication as rows and columns in an array." },
  { id: "md_properties", strand: "multiplication_division", name: "Properties of Multiplication", nameHi: "गुणा के गुण", classes: [3, 4, 5], fln: ["multiplication_division"], blurb: "Commutative, associative and the distributive property; multiplying by 0 and 1." },
  { id: "md_sharing", strand: "multiplication_division", name: "Division as Equal Sharing", nameHi: "बराबर बाँटना", classes: [2, 3, 4], fln: ["multiplication_division"], blurb: "Sharing a quantity equally — 12 among 3 is 4 each." },
  { id: "md_grouping", strand: "multiplication_division", name: "Division as Equal Grouping", nameHi: "समान समूह", classes: [3, 4, 5], fln: ["multiplication_division"], blurb: "How many groups of 3 are in 12 — the second meaning of division." },
  { id: "md_remainder", strand: "multiplication_division", name: "Division with Remainder", nameHi: "शेषफल", classes: [3, 4, 5], fln: ["multiplication_division"], blurb: "13 ÷ 4 = 3 remainder 1, and what the remainder means in a story." },
  { id: "md_two_digit", strand: "multiplication_division", name: "Multiplying 2- & 3-Digit Numbers", nameHi: "बड़ी संख्याओं का गुणा", classes: [4, 5], fln: ["multiplication_division"], blurb: "Standard algorithm, long multiplication, the area model and 25 × 4 style near-doubles." },
  { id: "md_divide_digit", strand: "multiplication_division", name: "Dividing by 1- & 2-Digit Numbers", nameHi: "भाग देना", classes: [4, 5], fln: ["multiplication_division"], blurb: "Division algorithm, long division, estimating quotients." },
  { id: "md_mixed_operations", strand: "multiplication_division", name: "Mixed Operations & Order of Operations", nameHi: "मिश्रित संक्रियाएँ", classes: [4, 5], fln: ["multiplication_division"], blurb: "BODMAS, brackets first, and checking the reasonableness of an answer." },
  { id: "md_word_problems", strand: "multiplication_division", name: "Multiplication & Division Word Problems", nameHi: "गुणा-भाग शब्द समस्या", classes: [2, 3, 4, 5], fln: ["multiplication_division"], blurb: "Recognising equal groups inside a real-life story (packs, boxes, plates)." },

  /* ---------------- Fractions & Decimals ---------------- */
  { id: "fr_concept", strand: "fractions_decimals", name: "Fraction as Part of a Whole", nameHi: "भिन्न की अवधारणा", classes: [1, 2, 3], fln: ["number_sense"], blurb: "Halves, quarters, eighths; shading equal parts of equal wholes." },
  { id: "fr_equivalent", strand: "fractions_decimals", name: "Equivalent Fractions", nameHi: "समतुल्य भिन्न", classes: [3, 4, 5], fln: ["number_sense"], blurb: "1/2 = 2/4 = 4/8; multiplying or dividing numerator and denominator." },
  { id: "fr_comparing", strand: "fractions_decimals", name: "Comparing Fractions", nameHi: "भिन्न की तुलना", classes: [3, 4, 5], fln: ["number_sense"], blurb: "Using the number line and benchmark fractions, not the numerator rule." },
  { id: "fr_number_line", strand: "fractions_decimals", name: "Fractions on a Number Line", nameHi: "संख्या रेखा पर भिन्न", classes: [3, 4, 5], fln: ["number_sense"], blurb: "Placing fractions between 0 and 1, and beyond 1." },
  { id: "fr_addition", strand: "fractions_decimals", name: "Adding Like Fractions", nameHi: "समान भिन्नों का जोड़", classes: [4, 5], fln: ["number_sense"], blurb: "2/5 + 1/5 = 3/5; same-sized pieces only." },
  { id: "fr_application", strand: "fractions_decimals", name: "Fractions in Real Life", nameHi: "वास्तविक जीवन में भिन्न", classes: [2, 3, 4, 5], fln: ["number_sense"], blurb: "Fractions of a collection, sharing food, reading recipes and measures." },
  { id: "dec_place_value", strand: "fractions_decimals", name: "Decimal Place Value (tenths, hundredths)", nameHi: "दशमलव स्थानीय मान", classes: [4, 5], fln: ["number_sense"], blurb: "The 4 in 0.45 is four hundredths; 10 tenths = 1 one." },
  { id: "dec_reading", strand: "fractions_decimals", name: "Reading & Writing Decimals", nameHi: "दशमलव लिखना", classes: [4, 5], fln: ["number_sense"], blurb: "Decimal notation for tenths, hundredths, and on the number line." },
  { id: "dec_comparing", strand: "fractions_decimals", name: "Comparing Decimals", nameHi: "दशमलव तुलना", classes: [5], fln: ["number_sense"], blurb: "0.5 vs 0.45 — write zeros so both have the same number of decimal places." },
  { id: "dec_operations", strand: "fractions_decimals", name: "Adding & Subtracting Decimals", nameHi: "दशमलव जोड़-घटाव", classes: [5], fln: ["number_sense"], blurb: "Keeping the decimal points lined up, especially with money." },
  { id: "dec_money", strand: "fractions_decimals", name: "Decimals in Money", nameHi: "पैसे में दशमलव", classes: [3, 4, 5], fln: ["number_sense", "measurement"], blurb: "Rupees and paise as decimals; solving money problems." },

  /* ---------------- Algebra ---------------- */
  { id: "al_patterns", strand: "algebra", name: "Number & Shape Patterns", nameHi: "पैटर्न", classes: [1, 2, 3, 4, 5], fln: ["number_sense"], blurb: "Finding the next term, the rule, and the missing term in a growing pattern." },
  { id: "al_open_sentences", strand: "algebra", name: "Open Number Sentences", nameHi: "खुले वाक्य", classes: [2, 3, 4], fln: ["number_sense"], blurb: "Deciding whether a sentence with a missing number is true, false or cannot be told." },
  { id: "al_missing_number", strand: "algebra", name: "Missing Number in a Rule", nameHi: "लुप्त संख्या", classes: [2, 3, 4], fln: ["number_sense"], blurb: "Using a simple rule or function machine to find an unknown." },
  { id: "al_variables", strand: "algebra", name: "Meaning of a Variable", nameHi: "चर", classes: [3, 4, 5], fln: ["number_sense"], blurb: "A letter standing for a number; expressions such as 4n and 2n + 1." },
  { id: "al_equations", strand: "algebra", name: "Simple Equations (x + 3 = 7)", nameHi: "सरल समीकरण", classes: [3, 4, 5], fln: ["number_sense"], blurb: "Solving first equations by taking the number to the other side and undoing." },

  /* ---------------- Geometry ---------------- */
  { id: "ge_2d_shapes", strand: "geometry", name: "Recognising 2D Shapes", nameHi: "2-आकृतियाँ", classes: [1, 2, 3], fln: ["geometry", "spatial_visualisation"], blurb: "Naming and sorting triangles, rectangles, squares, circles — including when rotated." },
  { id: "ge_3d_solids", strand: "geometry", name: "Recognising 3D Solids", nameHi: "3-आकार", classes: [1, 2, 3], fln: ["geometry", "spatial_visualisation"], blurb: "Cube, cuboid, cylinder, sphere, cone; faces, edges, corners." },
  { id: "ge_sides_corners", strand: "geometry", name: "Sides, Corners, Faces & Edges", nameHi: "भुजाएँ और कोने", classes: [1, 2, 3], fln: ["geometry"], blurb: "Counting and comparing the parts of flat and solid shapes." },
  { id: "ge_lines_angles", strand: "geometry", name: "Lines, Line Segments & Rays", nameHi: "रेखाएँ और कोण", classes: [3, 4, 5], fln: ["geometry"], blurb: "Identifying horizontal, vertical and slanting lines; naming rays and segments." },
  { id: "ge_angles", strand: "geometry", name: "Right, Acute & Obtuse Angles", nameHi: "कोण", classes: [4, 5], fln: ["geometry"], blurb: "Classifying and comparing angles using a right angle as the benchmark." },
  { id: "ge_symmetry", strand: "geometry", name: "Symmetry & Mirror Images", nameHi: "सममिति", classes: [1, 2, 3, 4, 5], fln: ["geometry", "spatial_visualisation"], blurb: "Finding lines of symmetry; completing mirror halves." },
  { id: "ge_perimeter", strand: "geometry", name: "Perimeter", nameHi: "परिमाप", classes: [3, 4, 5], fln: ["geometry", "measurement"], blurb: "Distance around a shape; solving real fencing and border problems." },
  { id: "ge_area", strand: "geometry", name: "Area by Counting Squares", nameHi: "क्षेत्रफल", classes: [3, 4, 5], fln: ["geometry", "measurement"], blurb: "Covering a shape with unit squares to measure how much room it takes." },
  { id: "ge_tiling", strand: "geometry", name: "Tiling & Tangram", nameHi: "टाइलिंग", classes: [1, 2, 3, 4], fln: ["geometry", "spatial_visualisation"], blurb: "Which shapes can tile without gaps, and building figures from pieces." },

  /* ---------------- Measurement ---------------- */
  { id: "me_length", strand: "measurement", name: "Length", nameHi: "लंबाई", classes: [1, 2, 3, 4], fln: ["measurement"], blurb: "Non-standard units, then centimetres, metres, feet and inches." },
  { id: "me_mass", strand: "measurement", name: "Mass & Weight", nameHi: "भार", classes: [1, 2, 3, 4], fln: ["measurement"], blurb: "Kilograms and grams; weighing everyday objects." },
  { id: "me_capacity", strand: "measurement", name: "Capacity & Volume", nameHi: "क्षमता", classes: [1, 2, 3, 4], fln: ["measurement"], blurb: "Litres and millilitres; filling and comparing containers." },
  { id: "me_time", strand: "measurement", name: "Time & the Clock", nameHi: "समय", classes: [1, 2, 3, 4], fln: ["measurement"], blurb: "Reading hour and minute hands; hours, minutes, half and quarter past." },
  { id: "me_money", strand: "measurement", name: "Money", nameHi: "मुद्रा", classes: [1, 2, 3, 4, 5], fln: ["measurement"], blurb: "Notes and coins, making change, and total cost of a small shop." },
  { id: "me_conversion", strand: "measurement", name: "Unit Conversion", nameHi: "इकाई परिवर्तन", classes: [4, 5], fln: ["measurement"], blurb: "1 m = 100 cm, 1 kg = 1000 g, 1 L = 1000 mL, 1 hour = 60 minutes." },
  { id: "me_estimation", strand: "measurement", name: "Estimating Measurements", nameHi: "माप का अनुमान", classes: [3, 4, 5], fln: ["measurement"], blurb: "Saying roughly how long, heavy or much, then checking with a measure." },

  /* ---------------- Data & Probability ---------------- */
  { id: "da_tally", strand: "data_probability", name: "Tally Marks", nameHi: "गिनती चिह्न", classes: [2, 3, 4], fln: ["data_handling"], blurb: "Recording counts in fives using bundles of five." },
  { id: "da_table", strand: "data_probability", name: "Tables & Frequency Charts", nameHi: "सारणी", classes: [2, 3, 4], fln: ["data_handling"], blurb: "Putting information into rows and columns and reading it back." },
  { id: "da_pictograph", strand: "data_probability", name: "Pictographs", nameHi: "चित्र लेख", classes: [2, 3, 4], fln: ["data_handling"], blurb: "Reading and drawing pictures where one symbol stands for several items." },
  { id: "da_bar_graph", strand: "data_probability", name: "Bar Graphs", nameHi: "दंड आरेख", classes: [2, 3, 4, 5], fln: ["data_handling"], blurb: "Reading the scale, comparing bars, drawing conclusions from a chart." },
  { id: "da_line_graph", strand: "data_probability", name: "Line Graphs", nameHi: "रेखा आरेख", classes: [5], fln: ["data_handling"], blurb: "Plotting over time and spotting rises and falls." },
  { id: "da_pie_chart", strand: "data_probability", name: "Pie Charts", nameHi: "वृत्त आरेख", classes: [5], fln: ["data_handling"], blurb: "Parts of a whole shown as slices of a circle." },
  { id: "da_interpret", strand: "data_probability", name: "Interpreting Data", nameHi: "आँकड़ों की व्याख्या", classes: [1, 2, 3, 4, 5], fln: ["data_handling"], blurb: "Saying what a chart shows, and drawing a sensible conclusion from it." },
  { id: "da_chance", strand: "data_probability", name: "Chance (more, less, equally likely)", nameHi: "संभावना", classes: [3, 4, 5], fln: ["data_handling", "spatial_visualisation"], blurb: "Describing what is more likely, less likely or equally likely — without numbers." },
];

export const TOPIC_BY_ID = new Map<string, Topic>(TOPICS.map((t) => [t.id, t]));
export const TOPIC_IDS = TOPICS.map((t) => t.id);
export const STRAND_BY_ID = new Map<string, (typeof STRANDS)[number]>(STRANDS.map((s) => [s.id, s]));

/**
 * How far competitive exams take each topic, attached to the topic itself.
 *
 * The tiers and their meaning live in `competition.ts`; this is the join, so
 * that anything iterating topics — the seed, the curriculum map, the generator
 * — can reach the depth without importing a second module. `competition.ts`
 * does not import this file, so the dependency runs one way only.
 *
 * Kept as a lookup rather than extra fields on `Topic` because `Topic` is
 * imported in about fifty places, several of which never care about
 * competition, and widening it would push a two-field change through all of them.
 */
export type TopicDepth = { tier: number; idea: string | null };

export const TOPIC_DEPTH: Map<string, TopicDepth> = new Map(
  TOPICS.map((t) => [t.id, { tier: compTierOf(t.id), idea: compIdeaOf(t.id) }]),
);

/** Competitive depth for one topic, defaulting to school-only. */
export function topicDepth(topicId: string): TopicDepth {
  return TOPIC_DEPTH.get(topicId) ?? { tier: 0, idea: null };
}

/**
 * The topics this class would be examined on at the given competitive tier.
 *
 * `overrides` is the calling school's corrections, indexed. Passed in rather
 * than looked up because this is a pure taxonomy function and must stay usable
 * from a script with no school context — passing `undefined` gives the bundled
 * answer, which is the right default everywhere except a teacher's own page.
 */
export function competitionTopicsForClass(
  classLevel: number,
  target: number,
  overrides?: Map<string, { tier: number; idea: string | null }>,
): Topic[] {
  return TOPICS.filter((t) => {
    if (!t.classes.includes(classLevel) || target <= 0) return false;
    const tier = overrides?.get(t.id)?.tier ?? topicDepth(t.id).tier;
    return tier >= target;
  });
}

/** Topics that apply to a given class, in taxonomy order. */
export function topicsForClass(classLevel: number): Topic[] {
  return TOPICS.filter((t) => t.classes.includes(classLevel));
}

/** Which class levels a topic is (weakest-first) diagnostic target for. */
export function firstClassForTopic(topicId: string): number {
  const t = TOPIC_BY_ID.get(topicId);
  return t?.classes[0] ?? 1;
}

/* ------------------------------------------------------------------ */
/* Misconceptions                                                      */
/* ------------------------------------------------------------------ */
/**
 * Research-backed error patterns for early primary mathematics. Each entry is
 * linked to a topic so a wrong answer can be mapped to *why* the child got it
 * wrong, not just that they did. This is what turns a score into a plan.
 */
export type Misconception = {
  id: string;
  topicIds: string[];
  name: string;
  /** What the child believes / does instead of the correct idea. */
  belief: string;
  /** How to see it in a marked script. */
  evidence: string;
  /**
   * Remediation routed by the Flipped Pedagogy of NCF-FL 2023:
   * concrete → pictorial → abstract, plus explicit systematic instruction.
   */
  remediation: string[];
  /** Method, not just advice — what the teacher actually does in class. */
  strategy: string;
};

export const MISCONCEPTIONS: Misconception[] = [
  /* Number sense */
  {
    id: "mc_digit_reversal",
    topicIds: ["ns_number_names", "as_within_20", "as_2digit"],
    name: "Digit reversal",
    belief: "Writing the digits of a number in reverse order (13 → 31, 45 → 54).",
    evidence: "All the digits are correct but the place order is reversed; often consistent.",
    remediation: [
      "Use a place-value chart with columns for hundreds, tens and ones, one physical counter per column.",
      "Build 13 with 1 ten and 3 ones, then read the columns left to right.",
      "Say the number name 'thir-teen' and point to each digit as you say it.",
    ],
    strategy: "Concrete place-value mat → pictorial arrow cards → written numeral, for 10 minutes daily.",
  },
  {
    id: "mc_digit_compare",
    topicIds: ["ns_comparing", "ns_place_value"],
    name: "Comparing by last digit, not place value",
    belief: "The number with the bigger last digit is the bigger number (so 9 > 45).",
    evidence: "Comparing single digits correctly but multi-digit numbers wrongly; the winner is the one ending in the larger digit.",
    remediation: [
      "Use a 0–100 chart and ask where each number sits on the number line.",
      "Build both numbers with flats, rods and units; three rods beats one flat.",
      "Play the 'hundreds, tens, ones' card game: compare the biggest column first.",
    ],
    strategy: "Number line first, then place-value blocks; only compare digits after both strategies agree.",
  },
  {
    id: "mc_counting_all",
    topicIds: ["as_within_20", "as_mental_strategies"],
    name: "Counting all instead of counting on",
    belief: "To add 8 and 5 the child recounts everything from 1, and loses track past 10.",
    evidence: "Slow, finger-counting from 1, or losing count entirely and guessing.",
    remediation: [
      "Practise counting on: start at 8, say 9, 10, 11, 12, 13 — never restart at 1.",
      "Make ten first: 8 + 5 becomes 8 + 2 + 3 = 10 + 3 = 13.",
      "Use a 0–20 number strip so the finger lands on the answer.",
    ],
    strategy: "Daily 5-minute routine: 10 count-ons on a number line, child points while counting.",
  },

  /* Addition & subtraction */
  {
    id: "mc_double_count",
    topicIds: ["as_within_20", "as_2digit"],
    name: "Double counting the first number",
    belief: "In '7 + 4' the child starts again at 1 instead of at 7.",
    evidence: "Answer equals 7 + 1 + 2 + 3 + 4, or the count restarts visibly.",
    remediation: [
      "Touch and count on: point to 7 on the number line, then move one step for each jump.",
      "Say the first number loudly, then only count the second number: '7, and 4 more…'",
      "Use linking cubes: the first tower is already built, add only 4 more.",
    ],
    strategy: "Number-line counting-on with a finger marker, paired with a partner saying the jumps.",
  },
  {
    id: "mc_carry_loss",
    topicIds: ["as_2digit", "as_3digit"],
    name: "Regrouping (carry/borrow) errors",
    belief: "When regrouping is needed, the ten is written but not carried, or the digit below is changed as well.",
    evidence: "8 + 5 written as 3; 52 − 19 written as 33 or 41; the 1 in 'ten' appears twice or vanishes.",
    remediation: [
      "Build the number with tens-rods and units-cubes; physically swap ten units for one ten.",
      "Use a number line to jump ten first, then count the rest.",
      "Practise the regrouping story: 'I had 8 ones. That is not a ten, so I make a ten and 3 left over.'",
    ],
    strategy: "Concrete bundle exchange → number-line jump → written column, one stage at a time, never together.",
  },
  {
    id: "mc_subtract_order",
    topicIds: ["as_2digit", "as_within_20"],
    name: "Taking the absolute difference",
    belief: "Always subtract the smaller number from the larger, whatever the question asks.",
    evidence: "Correct for 9 − 4 but 'there were 52, 19 left' gives 33 instead of 33 only by luck, or gives 69.",
    remediation: [
      "Link the story to the number sentence before any calculation: '52 was there, 19 went away, so fewer remain.'",
      "Draw 52 as dots and cross 19 of them out — the cross-out shows the order.",
      "Say the operation aloud: 'take away' always starts from the first number.",
    ],
    strategy: "Story → draw → number sentence → column, in that fixed order for every word problem.",
  },
  {
    id: "mc_missing_addend",
    topicIds: ["as_missing", "as_2digit"],
    name: "Missing-part (empty number) errors",
    belief: "Treating an empty box as zero, or adding both known parts to fill the box.",
    evidence: "For '7 + ? = 12' the child answers 7 + 12 = 19, or writes 0.",
    remediation: [
      "Use a part–part–whole bar model: draw the bar, label the known part, leave the other open.",
      "Close your finger over the hidden part and count the rest — the hidden part is what is left.",
      "Say the story of the whole: '12 altogether, 7 is already there, so how many more to make it?'",
    ],
    strategy: "Bar model before algebra; the empty box is 'the missing part', not 'nothing'.",
  },

  /* Multiplication & division */
  {
    id: "mc_mult_add_confusion",
    topicIds: ["md_repeated_addition", "md_tables", "md_array"],
    name: "Confusing multiplication with addition",
    belief: "6 × 4 is answered as 6 + 4 = 10, or as 6 + 6 + 6.",
    evidence: "The most common single error in Class 2–3; correct on 2 + 4 style items only.",
    remediation: [
      "Build 6 × 4 as an array of 4 rows of 6 and count all: '4 rows, 6 in each row.'",
      "Count 4 groups of 6 by touching each group once, saying six each time.",
      "Show the difference on a number line: jumps of 6, not +6 then +4.",
    ],
    strategy: "Equal groups → array → repeated-addition sentence → vertical algorithm, in that order.",
  },
  {
    id: "mc_mult_always_bigger",
    topicIds: ["md_repeated_addition", "md_properties"],
    name: "Believing multiplication always makes a number bigger",
    belief: "3 × 5 must be more than 5, so 3 × 5 is guessed as 15 or 8.",
    evidence: "Systematically wrong on 1 ×, 0 × and 2 × items; right on larger multipliers.",
    remediation: [
      "Show 1 × 7 = 7 and 0 × 7 = 0 explicitly and repeatedly.",
      "Use the number line: jumps of size 3, one time, is 3 — one jump is not growth.",
      "Sort 2 × 5, 3 × 5, 1 × 5, 0 × 5 into smaller, same, bigger.",
    ],
    strategy: "Explicit teaching of 0×, 1× and 2× before the rest of the table is used.",
  },
  {
    id: "mc_div_sharing_only",
    topicIds: ["md_sharing", "md_grouping", "md_word_problems"],
    name: "Division understood only as sharing",
    belief: "12 ÷ 3 can only mean 'share 12 among 3', so 'how many 3s fit in 12' is impossible.",
    evidence: "Sharing word problems all correct; 'how many in each group' or 'how many groups' items fail.",
    remediation: [
      "Teach the same array both ways: 12 as 3 rows of 4 gives 12 ÷ 3 = 4 and 12 ÷ 4 = 3.",
      "Circle the groups in one reading, and the number of groups in the other.",
      "Say both sentences out loud: '12 shared into 3 groups' and '12 shared into groups of 3.'",
    ],
    strategy: "One array, two readings, drawn on the same day so the two meanings stay linked.",
  },
  {
    id: "mc_remainder_meaning",
    topicIds: ["md_remainder", "md_grouping"],
    name: "Remainder not understood",
    belief: "13 ÷ 4 is answered '4 remainder 13', or the remainder is treated as a full group.",
    evidence: "Quotient too small, remainder larger than the divisor, or '3 and 1' given with no meaning.",
    remediation: [
      "Use counters: 13 counters in groups of 4 leaves 1 counter that cannot form a group.",
      "Ask what the leftover objects are in the story — sweets left over, seats empty.",
      "Show both 13 ÷ 4 = 3 r 1 and 14 ÷ 4 = 3 r 2 and ask which is 'one more'.",
    ],
    strategy: "Counters and the leftover story before the algorithm; the remainder is a physical leftover.",
  },
  {
    id: "mc_divisor_quotient_swap",
    topicIds: ["md_grouping", "md_sharing"],
    name: "Divisor and quotient swapped",
    belief: "Writing the divisor as the answer, or the quotient as the divisor.",
    evidence: "For 20 ÷ 4 the child answers 4, or writes 4 ÷ 20.",
    remediation: [
      "Say the sentence with roles: '20 is shared into 4 groups of __.'",
      "Use the bar model: total bar split into 4 equal parts, label the number of parts, not the answer.",
      "Check the answer by multiplying back: 5 × 4 should return 20.",
    ],
    strategy: "Part–part–whole bar model plus the multiplication check on every division answer.",
  },

  /* Fractions & decimals */
  {
    id: "mc_numerator_rule",
    topicIds: ["fr_comparing", "fr_equivalent"],
    name: "The 'bigger numerator is bigger fraction' rule",
    belief: "3/5 > 2/4 because 3 > 2, whatever the denominators are.",
    evidence: "Correct whenever fractions share a denominator, wrong whenever they do not.",
    remediation: [
      "Compare on the same-sized bars so children see the parts directly.",
      "Give benchmark fractions: is it more than, less than or equal to one half?",
      "Only draw conclusions after checking against 1/2, not the digits.",
    ],
    strategy: "Common denominator first (2/4 and 2/5), benchmark second, digit comparison never.",
  },
  {
    id: "mc_denominator_bigger_bigger",
    topicIds: ["fr_comparing", "fr_concept"],
    name: "More parts means a bigger part",
    belief: "1/2 is bigger than 1/4 because there are fewer pieces (a rule-of-thumb error that inverts).",
    evidence: "Also claims 1/8 is the largest fraction; consistent on drawings as well as numbers.",
    remediation: [
      "Fold an identical piece of paper in half and then in quarters — same paper, smaller parts.",
      "Shade 1/2 and 1/4 of two identical circles and compare the shaded area directly.",
      "Place both on a number line between 0 and 1.",
    ],
    strategy: "Same-whole shading, side by side, before any comparison is discussed.",
  },
  { id: "mc_fraction_size", topicIds: ["fr_application"], name: "Fraction of a number is not a fraction of the size",
    belief: "3/5 of 10 is answered as 3 or 5.",
    evidence: "Fractions on a shape are fine, fractions of a quantity are not.",
    remediation: [
      "Split 10 into 5 equal groups of 2, then take 3 groups: 3 + 3 + 3 = 9.",
      "Draw a bar of 10 and divide into 5 parts, shading 3.",
      "Start from 1/2 of 10 = 5, then build up.",
    ],
    strategy: "Bar model with equal groups, always starting from a known benchmark fraction.",
  },
  {
    id: "mc_decimal_digits",
    topicIds: ["dec_comparing", "dec_place_value"],
    name: "More decimal places means a bigger number",
    belief: "0.45 > 0.5 because it has more digits, or 0.9 < 0.12.",
    evidence: "Comparison of decimals fails; ordering by length of written form.",
    remediation: [
      "Write trailing zeros so both have the same number of places: 0.50 vs 0.45.",
      "Shade a 100-square grid for hundredths next to a 10-square grid for tenths.",
      "Place both on the same number line.",
    ],
    strategy: "Equalise the number of decimal places first, always, before comparing digits.",
  },
  {
    id: "mc_place_value_digit",
    topicIds: ["ns_place_value", "ns_number_forms", "ns_rounding", "as_2digit", "as_3digit"],
    name: "A digit is not read for its value",
    belief:
      "Each digit is named rather than valued — the 3 in 331 is 'three', not three hundred, and the 3 in the ones place is still 'three'.",
    evidence: "The ones digit of 331 answered as 3 instead of 1, or 331 described as 'three three one'.",
    remediation: [
      "Build 331 with a hundred, a ten-ten and a one: 300 + 30 + 1, and say each part's value.",
      "Cover the hundreds column and read the rest: what is the 3 in the tens place worth?",
      "Write the number expanded and then collapsed again, slowly.",
    ],
    strategy: "Place-value discs on a table, swapping the tens for ten ones and watching the total stay the same.",
  },

  {
    id: "mc_money_calculation",
    topicIds: ["dec_money", "dec_operations", "me_money"],
    name: "Money calculation errors",
    belief: "Adding rupees and paise by lining up the whole numbers and the small numbers separately, or forgetting paise entirely.",
    evidence: "₹12.50 + ₹3.75 answered as 15.125 or 16.25.",
    remediation: [
      "Work in paise only: 1250 + 375 = 1625 paise = ₹16.25.",
      "Use the ₹ and paise columns, lining the decimal points up with a ruler.",
      "Check with a rough estimate: 12.50 + 3.75 is a bit over 16.",
    ],
    strategy: "Paise-first arithmetic, then conversion, then an estimation check.",
  },

  /* Geometry */
  {
    id: "mc_perimeter_area",
    topicIds: ["ge_perimeter", "ge_area"],
    name: "Perimeter and area confused",
    belief: "Using the same method for both, usually adding all sides for area too.",
    evidence: "Area of a 3×4 rectangle answered as 14, or perimeter of a square answered as 16.",
    remediation: [
      "Perimeter: walk the edge with a finger while counting the unit sticks.",
      "Area: cover the shape with unit squares and count them.",
      "Compare a 1×6 strip: long perimeter, tiny area — the contrast makes it obvious.",
    ],
    strategy: "Two different actions — walk the edge versus fill the inside — for every perimeter/area pair.",
  },
  {
    id: "mc_shape_name_rotated",
    topicIds: ["ge_2d_shapes", "ge_symmetry"],
    name: "A shape is not recognised when rotated",
    belief: "A turned square is 'not a square' because it is standing on a corner.",
    evidence: "Correct when upright, fails on rotated copies or mirrored ones.",
    remediation: [
      "Use square cards and physically rotate them; name the shape each time.",
      "Show that matching corners and equal sides matter, not the way it is lying.",
      "Match identical shapes that face different directions.",
    ],
    strategy: "Handling and turning real objects before naming from a picture.",
  },
  {
    id: "mc_shape_inclusion",
    topicIds: ["ge_2d_shapes", "ge_sides_corners"],
    name: "One-way inclusion of shapes",
    belief: "A square is a rectangle, but a rectangle is not a square (or the reverse).",
    evidence: "Classification questions accepted or rejected inconsistently.",
    remediation: [
      "Venn-diagram sort: squares inside rectangles inside quadrilaterals.",
      "Ask what every square has, then what not every rectangle has — four equal sides.",
      "Sort a set of cut-out shapes into 'always' and 'sometimes'.",
    ],
    strategy: "Sorting with justification: the child must say the property, not just name the shape.",
  },

  /* Measurement */
  {
    id: "mc_unit_scale",
    topicIds: ["me_conversion", "me_length", "me_mass"],
    name: "Unit scale confusion",
    belief: "1 m = 10 cm, 1 kg = 100 g, 1 hour = 100 minutes.",
    evidence: "Conversion questions fail while direct measuring with the right unit succeeds.",
    remediation: [
      "Lay a 1 m strip out and count ten 10 cm pieces inside it.",
      "Weigh 1 kg of rice, then split it into ten 100 g bags.",
      "Count a minute on a clock while watching the second hand travel 60 marks.",
    ],
    strategy: "Physical anchors for 10, 100 and 60 before any conversion is practised on paper.",
  },
  {
    id: "mc_clock_reading",
    topicIds: ["me_time"],
    name: "Confusing the hour and minute hands",
    belief: "Reading 3:45 as 3:04, or treating the short hand as the minutes.",
    evidence: "Whole hours correct; anything with minutes fails.",
    remediation: [
      "Point to each hand and name it: 'this short one is the hour, this long one is the minutes.'",
      "Start at 3 and walk the long hand all the way round once, counting 60.",
      "Say the time out loud in words before writing it.",
    ],
    strategy: "Hand naming, then a 60-count around the dial, before reading digital-style times.",
  },
  {
    id: "mc_estimation",
    topicIds: ["me_estimation", "ns_estimation_numbers", "as_estimation"],
    name: "No sense of magnitude",
    belief: "Guessing wildly — a pencil is 5 kg long, a classroom holds 2 people.",
    evidence: "Exact reading with the right instrument is fine, but no-estimate questions are nonsense.",
    remediation: [
      "Anchor to the body: a hand, a foot, a door, a school bag.",
      "Estimate first, measure, and discuss the gap out loud.",
      "Round numbers first: about 20, about 200, about 2 kg.",
    ],
    strategy: "Estimate-measure-discuss as a weekly 5-minute routine.",
  },

  /* Data */
  {
    id: "mc_graph_scale",
    topicIds: ["da_bar_graph", "da_line_graph", "da_pictograph"],
    name: "Misreading the scale or axis",
    belief: "Reading a bar as taller means more when the picture key says one square stands for 10.",
    evidence: "Correct on the table the same data came from, wrong on the graph.",
    remediation: [
      "Always read the key or axis label before reading any bar.",
      "Count squares, then multiply by the key — never eyeball the height.",
      "Convert the same data between a table, a pictograph and a bar graph.",
    ],
    strategy: "Key first, then count, then multiply — a fixed three-step routine on every graph.",
  },
  {
    id: "mc_chart_overclaim",
    topicIds: ["da_interpret", "da_chance"],
    name: "Over-claiming from data",
    belief: "Saying a favourite or a trend that the data does not show, including when values are equal.",
    evidence: "Concludes 'everyone likes X' from a class of 6, or ignores equal values.",
    remediation: [
      "Ask 'what does the chart actually show, and what does it not show?'",
      "Separate the observation from the opinion, in two columns.",
      "Use 'the data shows…' before any 'I think…' is allowed.",
    ],
    strategy: "Sentence stems: 'The data shows…' then 'This does not tell us…'",
  },
];

export const MISCONCEPTION_BY_ID = new Map(MISCONCEPTIONS.map((m) => [m.id, m]));

export function misconceptionsForTopic(topicId: string): Misconception[] {
  return MISCONCEPTIONS.filter((m) => m.topicIds.includes(topicId));
}

/* ------------------------------------------------------------------ */
/* Question formats used in Indian primary schools                     */
/* ------------------------------------------------------------------ */

export const QUESTION_TYPES = [
  { id: "mcq", name: "MCQ", nameHi: "बहुविकल्पीय", marks: 1, autoGraded: true, blurb: "Four options, one or more correct." },
  { id: "fill_blank", name: "Fill in the Blanks", nameHi: "रिक्त स्थान", marks: 1, autoGraded: true, blurb: "A single missing word, number or symbol." },
  { id: "true_false", name: "True / False", nameHi: "सही/गलत", marks: 1, autoGraded: true, blurb: "A statement the child marks." },
  { id: "match", name: "Match the Following", nameHi: "सुमेलित कीजिए", marks: 2, autoGraded: true, blurb: "Pairing two columns; half a mark per pair." },
  { id: "short", name: "Very Short Answer", nameHi: "लघु उत्तर", marks: 2, autoGraded: "partial", blurb: "One or two words, or a number." },
  { id: "medium", name: "Short Answer", nameHi: "लघु शब्द उत्तर", marks: 3, autoGraded: "partial", blurb: "A working line or two, or a labelled diagram." },
  { id: "long", name: "Long Answer", nameHi: "दीर्घ उत्तर", marks: 5, autoGraded: "manual", blurb: "Several steps of working; marked against a rubric." },
  { id: "picture", name: "Picture / Activity Based", nameHi: "चित्र आधारित", marks: 2, autoGraded: "partial", blurb: "Look at the picture, count, compare or draw." },
] as const;

export type QuestionTypeId = (typeof QUESTION_TYPES)[number]["id"];

export const QUESTION_TYPE_IDS = QUESTION_TYPES.map((q) => q.id);
export const QUESTION_TYPE_BY_ID = new Map<string, (typeof QUESTION_TYPES)[number]>(
  QUESTION_TYPES.map((q) => [q.id, q]),
);

/* ------------------------------------------------------------------ */
/* Difficulty / competency bands (CBSE competency-based assessment)   */
/* ------------------------------------------------------------------ */

export const COMPETENCY_LEVELS = [
  { id: "basic", name: "Basic", nameHi: "आधारभूत", weight: 0.5, blurb: "Recall and direct procedure; the child has the fact." },
  { id: "competent", name: "Competent", nameHi: "सक्षम", weight: 0.3, blurb: "Applies the idea in a familiar context, choosing the method." },
  { id: "proficient", name: "Proficient", nameHi: "प्रवीण", weight: 0.2, blurb: "Reasons, explains a choice, and works with a multi-step problem." },
] as const;

export type CompetencyId = (typeof COMPETENCY_LEVELS)[number]["id"];
export const COMPETENCY_IDS = COMPETENCY_LEVELS.map((c) => c.id) as unknown as CompetencyId[];

/* ------------------------------------------------------------------ */
/* Grade bands used for reporting (NEP 2020 style 3-point grading)     */
/* ------------------------------------------------------------------ */

export function gradeBand(pct: number): { grade: string; label: string; color: string; hi: string } {
  if (pct >= 90) return { grade: "A+", label: "Excellent", color: "#10b981", hi: "उत्कृष्ट" };
  if (pct >= 80) return { grade: "A", label: "Very Good", color: "#22c55e", hi: "बहुत अच्छा" };
  if (pct >= 70) return { grade: "B", label: "Good", color: "#84cc16", hi: "अच्छा" };
  if (pct >= 60) return { grade: "C", label: "Satisfactory", color: "#f59e0b", hi: "संतोषजनक" };
  if (pct >= 40) return { grade: "D", label: "Needs Practice", color: "#f97316", hi: "अभ्यास आवश्यक" };
  return { grade: "E", label: "Remedial Support", color: "#ef4444", hi: "उपचारात्मक सहायता" };
}

/** A strand at or below this percentage is flagged as a gap for the class. */
export const STRAND_GAP_THRESHOLD = 60;
/** A topic at or below this percentage is flagged for the individual child. */
export const TOPIC_GAP_THRESHOLD = 50;
/** Repeating a mistake on this share of questions counts as a "recurring error". */
export const RECURRING_ERROR_SHARE = 0.34;
