/**
 * Competitive-exam depth, as an overlay on the school syllabus.
 *
 * ## Why an overlay and not a second syllabus
 *
 * A Class 4 child sitting the Maths Olympiad is examined on the *same* ideas as
 * a Class 4 child sitting the unit test — place value, fractions, patterns. What
 * changes is depth: the same idea pushed one step further, or asked in a way
 * that cannot be answered by the procedure alone. So the topics are not
 * duplicated. Each one carries a tier, meaning "how far this idea is taken".
 * A second Board full of near-identical concepts would have roughly 80% of its
 * rows saying the same thing, and two reports counting the same child twice.
 *
 * ## The tiers
 *
 * 0 is not "competition" — it is the school syllabus, and every topic has it.
 * Above that, each tier means the idea survives an extra step:
 *
 *   1 ZONE      — district / school-level talent tests. Non-routine problems,
 *                 but reachable from the taught method with thought.
 *   2 STATE     — state olympiad and NMTC-class papers. Two ideas combined, or
 *                 a problem that has to be set up rather than read off.
 *   3 NATIONAL  — national olympiad (SOF NSO/IMO, SEAMO/NSEJS) and NTSE-class
 *                 papers. The child must choose the representation themselves;
 *                 the question does not say which operation to use.
 *
 * NTSE is formally a Class 10+ exam. It is listed here because schools use the
 * *style* of its papers as a Class 4–5 target, and because the abstraction is
 * meant to be extendable — a school that treats tier 3 as its ceiling can do so
 * without the schema changing.
 *
 * ## What this file is not
 *
 * The tier assignments below are a **structural interpretation written from
 * domain knowledge**, not transcribed from any published syllabus or past
 * paper. Which topic appears at which tier varies between boards, between
 * schools and between years. Treat it as a well-reasoned starting point that a
 * teacher can correct per topic — `Topic.compTier` and `Topic.compIdea` are
 * plain columns for exactly that reason — and not as an authoritative map.
 */

export const COMP_TIERS = [
  {
    tier: 0,
    id: "school",
    label: "School",
    labelHi: "विद्यालय",
    blurb: "The taught syllabus and the unit test.",
  },
  {
    tier: 1,
    id: "zone",
    label: "Zone / district",
    labelHi: "ज़ोन",
    blurb: "School and district talent tests. Non-routine, but reachable from the taught method.",
  },
  {
    tier: 2,
    id: "state",
    label: "State",
    labelHi: "राज्य",
    blurb: "State olympiads and NMTC-class papers. Two ideas combined, or a problem that must be set up.",
  },
  {
    tier: 3,
    id: "national",
    label: "National",
    labelHi: "राष्ट्रीय",
    blurb: "SOF NSO/IMO, SEAMO/NSEJS and NTSE-style papers. The question does not say which operation to use.",
  },
] as const;

export type CompTier = (typeof COMP_TIERS)[number]["tier"];

export const COMP_TIER_BY_ID = new Map(COMP_TIERS.map((t) => [t.id, t]));

/**
 * Exam families, so a school can say "we prepare for *this* exam" and the app
 * can report readiness against its ceiling rather than a single vague "tier 3".
 *
 * `maxTier` is what the exam itself reaches. A topic at tier 2 can still be
 * asked in a tier-3 paper — every national paper contains school-level
 * questions — so this is a target, not a filter.
 */
export const EXAM_FAMILIES = [
  {
    id: "SCHOOL",
    name: "School syllabus",
    nameHi: "विद्यालय पाठ्यक्रम",
    maxTier: 0 as CompTier,
    typicalClasses: [1, 2, 3, 4, 5],
    note: "Unit tests and the annual exam.",
  },
  {
    id: "ZONE",
    name: "District / school talent test",
    nameHi: "ज़िला प्रतिभा परीक्षा",
    maxTier: 1 as CompTier,
    typicalClasses: [3, 4, 5],
    note: "School- or district-run selective tests. The most common first step, and the one to start with.",
  },
  {
    id: "NMTC",
    name: "NMTC / state-level",
    nameHi: "NMTC / राज्य स्तर",
    maxTier: 2 as CompTier,
    typicalClasses: [4, 5],
    note: "Two-stage talent search with a state paper. NTSE and NMTC papers are the usual reference.",
  },
  {
    id: "SOF",
    name: "Maths Olympiad (SOF NSO / IMO)",
    nameHi: "गणित ओलंपियाड",
    maxTier: 3 as CompTier,
    typicalClasses: [1, 2, 3, 4, 5],
    note: "The Society for Olympiad Foundation papers, and the IMO primary-level paper alongside them.",
  },
  {
    id: "JSCI",
    name: "Junior science olympiad (SEAMO / NSEJS)",
    nameHi: "कनिष्ठ विज्ञान ओलंपियाड",
    maxTier: 3 as CompTier,
    typicalClasses: [4, 5],
    note: "SEAMO and NSEJS. Mathematics-weighted sections follow the same depth as the maths olympiad.",
  },
] as const;

export type ExamFamilyId = (typeof EXAM_FAMILIES)[number]["id"];

export const EXAM_FAMILY_BY_ID = new Map(EXAM_FAMILIES.map((e) => [e.id, e]));

/**
 * How far each topic is taken, and what the extra step actually is.
 *
 * `idea` is the part that matters and the part most likely to be wrong for a
 * particular school, so it is written as the specific thing a child must learn
 * beyond the classroom method rather than as a slogan.
 *
 * **Tier 0 has no `idea`, deliberately.** Tier 0 means the topic is not taken
 * further, so there is no extra step to name. Restating the classroom skill as
 * an "extra step" would be padding, and it would let the panel promise a route
 * it does not have — which is why `compIdeaOf` returns null there and a test
 * asserts it stays null.
 *
 * Read these as "where competition maths usually spends its time", not as a
 * syllabus.
 */
export const COMPETITION_DEPTH: Record<string, { tier: CompTier; idea?: string }> = {
  /* ---------------------------------------------------------- number */
  ns_counting: { tier: 0 },
  ns_number_names: { tier: 1, idea: "Place-value reasoning behind a numeral, not reciting the list." },
  ns_ordering: { tier: 1, idea: "Continuing a sequence whose rule has to be inferred from the terms." },
  ns_comparing: {
    tier: 1,
    idea: "Comparing without converting to place value — using line length or one unit as the benchmark.",
  },
  ns_ordering_magnitude: { tier: 1, idea: "Arranging a set where the ordering depends on a digit other than the first." },
  ns_place_value: {
    tier: 3,
    idea: "Expanded form used to reason about arithmetic you cannot yet do fluently — the single most load-bearing idea in primary competition maths.",
  },
  ns_even_odd: { tier: 1, idea: "Parity of an expression, worked out from the parity of its parts." },
  ns_large_numbers: { tier: 2, idea: "Reading and comparing numbers written in the Indian system, including crores." },
  ns_estimation_numbers: {
    tier: 2,
    idea: "Choosing a bound and proving an answer lies inside it, rather than estimating roughly.",
  },

  /* ---------------------------------------------- addition/subtraction */
  as_within_20: { tier: 0 },
  as_2digit: { tier: 1, idea: "Choosing between column and mental method, and checking the estimate." },
  as_3digit: { tier: 1, idea: "Regrouping where a second regroup is needed (999 + 1 style)." },
  as_4digit: { tier: 2, idea: "Multi-step additions where carrying happens in more than one column." },
  as_mental_strategies: {
    tier: 2,
    idea: "Compensation and near-double strategies chosen deliberately for a specific structure in the numbers.",
  },
  as_missing: { tier: 2, idea: "Recovering a missing part by reasoning about structure rather than by inverting the operation." },
  as_word_problems: {
    tier: 3,
    idea: "Problems with no explicit operation, where the wording hides a two-step structure — the hardest thing on any primary paper.",
  },
  as_estimation: { tier: 2, idea: "Rounding to a bound and then narrowing it, a second time." },

  /* ------------------------------------------ multiplication/division */
  md_repeated_addition: { tier: 0 },
  md_tables: {
    tier: 2,
    idea: "Table facts used as a *tool* inside a larger problem, recalled under time pressure rather than tested directly.",
  },
  md_array: { tier: 1, idea: "Deducing dimensions from the total, in either direction." },
  md_properties: {
    tier: 2,
    idea: "Using commutativity, associativity and distributivity to simplify an expression that looks hard only because it is written the hard way.",
  },
  md_sharing: { tier: 1, idea: "Distinguishing the two meanings of division, and saying which one a story uses." },
  md_grouping: { tier: 1, idea: "Choosing between the two division meanings without being told." },
  md_remainder: {
    tier: 3,
    idea: "Interpreting a remainder as a quantity to be reasoned about (how many full groups, how many left over, and what that permits).",
  },
  md_two_digit: {
    tier: 2,
    idea: "Multiplication where the efficient method is the area or distributive one, not long multiplication.",
  },
  md_divide_digit: {
    tier: 2,
    idea: "Choosing a quotient by estimation and then proving it correct, rather than by the formal algorithm alone.",
  },
  md_mixed_operations: {
    tier: 3,
    idea: "A chain of operations where one bracket must be inserted at the right place, found by reasoning about magnitude.",
  },
  md_word_problems: {
    tier: 3,
    idea: "Equal groups hidden inside a story, often behind two layers of wording, with a remainder that has to be interpreted.",
  },

  /* ---------------------------------------------- fractions/decimals */
  fr_concept: { tier: 1, idea: "Fraction of a quantity that is not a simple whole, where the wholes have to be found first." },
  fr_equivalent: { tier: 2, idea: "Simplifying to lowest terms and using equivalence to compare by cross-multiplication." },
  fr_comparing: { tier: 2, idea: "Comparing fractions with unlike denominators by scaling to a common one." },
  fr_number_line: { tier: 2, idea: "Locating a fraction exactly between two others, and reasoning about spacing." },
  fr_addition: { tier: 3, idea: "Adding unlike fractions where the answer must be reasoned about, not computed." },
  fr_application: {
    tier: 3,
    idea: "Fraction problems where the whole is unknown — the situation that defeats most primary children.",
  },
  dec_place_value: {
    tier: 3,
    idea: "Treating a decimal as a fraction over a power of ten, which is how nearly every hard decimal problem is actually solved.",
  },
  dec_reading: { tier: 1, idea: "Decimal place value and reading a decimal against its scale." },
  dec_comparing: { tier: 2, idea: "Comparing decimals by scaling to the same number of places rather than digit by digit." },
  dec_operations: { tier: 3, idea: "Decimal operations where scale has to be tracked explicitly across two operations." },
  dec_money: { tier: 2, idea: "Money as the decimal system made concrete, including change from a note." },

  /* --------------------------------------------------------- algebra */
  al_patterns: {
    tier: 3,
    idea: "Extending a pattern and then describing *why* it continues the way it does — the highest-yield opening question on an olympiad paper.",
  },
  al_open_sentences: { tier: 1, idea: "Finding the value that makes a sentence true, by trial and by reasoning." },
  al_missing_number: { tier: 2, idea: "Missing parts where the structure, not the operation, gives the answer." },
  al_variables: { tier: 2, idea: "A symbol standing for an unknown quantity inside a word problem." },
  al_equations: {
    tier: 3,
    idea: "Solving a small equation by balancing, including one where the same letter appears on both sides.",
  },

  /* -------------------------------------------------------- geometry */
  ge_2d_shapes: { tier: 1, idea: "Classifying a shape by its properties rather than by how it looks drawn." },
  ge_3d_solids: { tier: 1, idea: "Counting faces, edges and vertices, and recognising a solid from its net." },
  ge_sides_corners: { tier: 1, idea: "Reasoning about sides and corners as quantities, including in composite shapes." },
  ge_lines_angles: { tier: 2, idea: "Angle as a quantity, and the fact that a right angle is fixed however the shape is drawn." },
  ge_angles: { tier: 2, idea: "Finding an unknown angle by subtraction from a known total." },
  ge_symmetry: { tier: 2, idea: "Counting lines of symmetry, and using symmetry to reason about area." },
  ge_perimeter: { tier: 2, idea: "Perimeter of a shape whose sides are given indirectly." },
  ge_area: {
    tier: 3,
    idea: "Counting squares to find area, then generalising to a rectangle that is not a whole number of units across.",
  },
  ge_tiling: { tier: 2, idea: "Tiling, and what a shape that cannot tile tells you about it." },

  /* ------------------------------------------------------ measurement */
  me_length: { tier: 1, idea: "Choosing a sensible unit, and reasoning about which measure is bigger without a ruler." },
  me_mass: { tier: 1, idea: "Mass compared by reasoning, not by weighing." },
  me_capacity: { tier: 1, idea: "Capacity as a quantity, including in containers that are not cylinders." },
  me_time: {
    tier: 2,
    idea: "Elapsed time across a boundary, and the 24-hour clock read as a number line.",
  },
  me_money: {
    tier: 2,
    idea: "Money problems whose answer is a change, a shortfall or a set of notes, not a single subtraction.",
  },
  me_conversion: { tier: 2, idea: "Converting between units by reasoning from a known reference." },
  me_estimation: { tier: 2, idea: "Estimating a measurement to a stated degree of accuracy." },

  /* -------------------------------------------------- data/probability */
  da_tally: { tier: 0 },
  da_table: { tier: 1, idea: "Reading a value out of a table by more than one route." },
  da_pictograph: { tier: 1, idea: "Reading a scale key and reasoning about the picture rather than the symbol." },
  da_bar_graph: { tier: 2, idea: "Reading a graph accurately enough to notice what is missing from it." },
  da_line_graph: { tier: 3, idea: "Reading a line graph at an intermediate point, and reasoning about the trend." },
  da_pie_chart: { tier: 2, idea: "Fractions of a whole read off a pie chart and combined." },
  da_interpret: {
    tier: 3,
    idea: "Deciding what a display does *not* show — the question a national paper asks and a unit test never does.",
  },
  da_chance: { tier: 2, idea: "Chance described with words before it is described with numbers." },
};

/** The tier for a topic, defaulting to school-only rather than guessing upward. */
export function compTierOf(topicId: string): CompTier {
  return COMPETITION_DEPTH[topicId]?.tier ?? 0;
}

export function compIdeaOf(topicId: string): string | null {
  return COMPETITION_DEPTH[topicId]?.idea ?? null;
}

/* ------------------------------------------------------------------ */
/* Per-school corrections                                              */
/* ------------------------------------------------------------------ */

export type DepthOverride = { topicId: string; tier: number; idea: string | null; note?: string | null };

export type ResolvedDepth = {
  tier: number;
  idea: string | null;
  /** True when this school has corrected the bundled answer. */
  overridden: boolean;
  note: string | null;
};

/**
 * The depth a school actually sees.
 *
 * The bundled answer is an interpretation, so a school has to be able to
 * correct it — but only for itself. Editing `Topic.compTier` directly would
 * change the answer for every other school on the server, which is not a
 * correction but a cross-tenant edit. So a correction is stored per school and
 * resolved here, in preference, and the panel says which it is showing.
 */
export function resolveDepth(topicId: string, overrides?: Map<string, DepthOverride>): ResolvedDepth {
  const o = overrides?.get(topicId);
  if (o) {
    return { tier: o.tier, idea: o.idea, overridden: true, note: o.note ?? null };
  }
  return { tier: compTierOf(topicId), idea: compIdeaOf(topicId), overridden: false, note: null };
}

/** Index a school's overrides by topic, ready for `resolveDepth`. */
export function indexOverrides(
  rows: { topicId: string; tier: number; idea: string | null; note: string | null }[],
): Map<string, DepthOverride> {
  return new Map(rows.map((r) => [r.topicId, { topicId: r.topicId, tier: r.tier, idea: r.idea, note: r.note }]));
}

/**
 * The extra step a child needs before this topic can be attacked at `target`.
 *
 * Reported rather than assumed: a topic already at or above the target needs
 * nothing, which is worth saying out loud so a teacher does not spend a period
 * on "olympiad readiness" for a topic the child already owns.
 */
export function competitionGap(
  topicId: string,
  target: CompTier,
): { ready: boolean; atTier: CompTier; idea: string | null } {
  const atTier = compTierOf(topicId);
  return {
    ready: atTier >= target,
    atTier,
    idea: atTier >= target ? null : compIdeaOf(topicId),
  };
}

/**
 * Topics in a class that are actually worth competing on at `target`.
 *
 * Deliberately lives in `curriculum.ts` instead (`competitionTopicsForClass`),
 * because filtering by class needs the topic list and `competition.ts` must not
 * import `curriculum.ts` — the dependency runs the other way, so that the topic
 * table can reach its depth without a cycle.
 */

/** Problem styles a competition paper uses and a unit test does not. */
export const COMP_STYLES = [
  { id: "standard", label: "Taught method", blurb: "Applies the classroom procedure directly." },
  { id: "multi_step", label: "Multi-step", blurb: "Two or three ideas chained; each step is known on its own." },
  { id: "reverse", label: "Reasoned backwards", blurb: "Starts from the answer and works out the question." },
  { id: "estimation", label: "Estimation & bounds", blurb: "Asks for a range, or for a value good enough to decide." },
  { id: "pattern", label: "Pattern & sequence", blurb: "The rule must be inferred from what is given." },
  { id: "logic", label: "Logic & reasoning", blurb: "Deduces an answer from constraints, with no arithmetic to do." },
  { id: "representation", label: "Representation", blurb: "The child must choose the diagram, table or model themselves." },
  { id: "number_theory", label: "Number properties", blurb: "Parity, divisibility and digit structure as arguments." },
  /* Declared but not generated. The five above are derived from a base question
   * by arithmetic on numbers read back out of it; these need a stem the
   * transforms cannot read, because the answer depends on *what the question is
   * about* rather than on two numbers in it. Measured over the bundled bank,
   * the largest single group is 121 questions across 21 topics that no general
   * transform reaches — see `coverageReport`. Naming them here keeps the gap
   * visible instead of leaving the app quietly short. */
  { id: "place_value", label: "Place-value reasoning", blurb: "Digit structure as an argument. Not generated yet." },
  { id: "place_value_digit", label: "Value of a digit", blurb: "One digit's worth derived from its position. Not generated yet." },
  { id: "round_to_nearest", label: "Rounding", blurb: "Rounding to a bound and justifying it. Not generated yet." },
  { id: "comparison", label: "Comparison without counting", blurb: "Ordering without converting. Not generated yet." },
  { id: "missing_operand", label: "Missing part", blurb: "A missing addend or factor recovered by structure. Not generated yet." },
  { id: "sequence", label: "Sequence", blurb: "The next term of a stated sequence. Not generated yet." },
] as const;

export type CompStyleId = (typeof COMP_STYLES)[number]["id"];

export function isCompStyle(value: string): value is CompStyleId {
  return (COMP_STYLES as readonly { id: string }[]).some((s) => s.id === value);
}
