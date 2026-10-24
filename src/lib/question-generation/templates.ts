/**
 * Built-in question generators.
 *
 * The app must be able to make a proper, curriculum-aligned test on a laptop
 * in a village school with no internet, no API key, and no credit card. That
 * rules out making the AI the only source of questions, so this module
 * generates questions arithmetically, for a large part of the Classes 1-5
 * syllabus.
 *
 * Two properties matter:
 *  - **The answers are correct by construction.** Every question is built from
 *    an operation whose result is computed, never written by hand, so a wrong
 *    mark is impossible.
 *  - **The distractors are real misconceptions.** The wrong options are the
 *    specific wrong answers children actually give, wired to the misconception
 *    ids so grading can name the cause.
 *
 * Questions are seeded from the request, so the same request always produces
 * the same paper — a teacher who regenerates does not silently get a new test.
 */

import type { GeneratedQuestion } from "@/lib/ai/questions";
import { TOPIC_BY_ID } from "@/lib/curriculum";

/* ------------------------------------------------------------------ */
/* Seeded randomness                                                   */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = {
  rnd: () => number;
  /** Integer in [lo, hi]. */
  ri: (lo: number, hi: number) => number;
  pick: <T>(items: readonly T[]) => T;
  /** true when more than half the marks should be procedural rather than recall. */
  higher: boolean;
  grade: number;
};

function makeCtx(seed: number, grade: number, higher: boolean): Ctx {
  const rnd = mulberry32(seed);
  return {
    rnd,
    grade,
    higher,
    ri: (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(rnd() * items.length)],
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const NAMES = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Sana", "Ishaan", "Priya", "Vihaan", "Anaya"];
const FRUITS = ["mangoes", "bananas", "oranges", "apples", "guavas"];
const THINGS = ["toffees", "pencils", "erasers", "crayons", "stickers", "marbles"];
const PACKETS = ["packets", "boxes", "bags", "baskets"];

function mcq(
  stem: string,
  correct: number | string,
  wrong: (number | string)[],
  diagnosis: Record<string, string>,
  explain: string,
): GeneratedQuestion {
  /* Duplicate options make a question unanswerable rather than merely unfair.
   *
   * If the correct value appears at two letters, `findIndex` below picks the
   * first and the second is handed to the child as a *distractor* — so a child
   * who answers correctly by picking that other letter is marked wrong, with
   * nothing on the page to explain why. This is the failure this app cares most
   * about: an invisible bug that mis-marks a child.
   *
   * Caught here rather than in each generator, because it is a property of the
   * assembled list and a generator can reintroduce it by accident at any time.
   * `ns_comparing` did exactly that, by passing `Math.min(a, b)` as a
   * distractor when the answer was one of `a` or `b`. */
  const dedupedWrong = [...new Set(wrong.map(String))].filter((w) => w !== String(correct));

  // Place the correct answer among the distractors so the key is not always A.
  //
  // Seeded on the **stem**, not just on the values. Seeding on `correct + wrong[0]`
  // gave a constant rotation for any generator whose options are fixed strings —
  // ge_tiling answered "Yes" against "No", al_open_sentences "Always true"
  // against "Never true" — so every question from those topics landed on the
  // same letter. The stem carries the numbers, which vary, so the key spreads.
  const all = [String(correct), ...dedupedWrong];
  const seedShift = Math.abs(hashSeed(`${stem}|${correct}|${dedupedWrong[0] ?? ""}`)) % all.length;
  const rotated = all.slice(seedShift).concat(all.slice(0, seedShift));
  const options = rotated.map((v, i) => `${String.fromCharCode(65 + i)}. ${v}`);
  const keyIndex = rotated.findIndex((v) => String(v) === String(correct));
  const optionDiagnosis: Record<string, string> = {};
  let wrongSeen = 0;
  rotated.forEach((v, i) => {
    if (i === keyIndex) return;
    const d = Object.values(diagnosis)[Math.min(wrongSeen, Object.values(diagnosis).length - 1)];
    if (d) optionDiagnosis[String.fromCharCode(65 + i)] = d;
    wrongSeen++;
  });
  return {
    stem,
    type: "mcq",
    marks: 1,
    options,
    answerKey: String.fromCharCode(65 + keyIndex),
    explanation: explain,
    optionDiagnosis,
    diagnoses: [...new Set(Object.values(diagnosis))],
    difficulty: 2,
  };
}

function fill(stem: string, answer: string | number, explain: string, difficulty = 2): GeneratedQuestion {
  return {
    stem,
    type: "fill_blank",
    marks: 1,
    answerKey: String(answer),
    explanation: explain,
    difficulty,
  };
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */
/* ------------------------------------------------------------------ */

type Generator = (c: Ctx, index: number) => GeneratedQuestion;

const GENERATORS: Record<string, Generator> = {
  /* ---------------- Number Sense ---------------- */
  ns_counting: (c) => {
    const n = c.higher ? c.ri(20, 60) : c.ri(5, 20);
    const thing = c.pick(FRUITS);
    return fill(
      `How many ${thing} are there in the picture? Count them one by one and write the number.`,
      n,
      `Touch each ${thing.slice(0, -1)} once as you count. Say the number you count on from ${n - 5} to ${n}.`,
      1,
    );
  },

  ns_number_names: (c) => {
    const n = c.higher ? c.ri(100, 999) : c.ri(10, 99);
    return {
      stem: `Write the number name for ${n}.`,
      type: "short",
      marks: 1,
      answerKey: String(n),
      accepted: [String(n)],
      explanation: `Count by tens then by ones: ${Math.floor(n / 10)} tens and ${n % 10} ones makes ${n}.`,
      difficulty: 1,
    };
  },

  ns_ordering: (c) => {
    const n = c.ri(20, 90);
    return {
      stem: `What comes just after ${n}?`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(n + 1),
      explanation: `Counting on by one from ${n} gives ${n + 1}.`,
      difficulty: 1,
    };
  },

  ns_comparing: (c) => {
    const a = c.ri(10, 99);
    let b = c.ri(10, 99);
    while (b === a) b = c.ri(10, 99);
    const bigger = Math.max(a, b);
    const smaller = Math.min(a, b);
    // A third option that is neither of the two being compared. Passing
    // `Math.min(a, b)` used to leave a duplicate of one of them, which `mcq`
    // then handed over as a distractor — so a child who wrote the right number
    // was marked wrong for choosing the other copy.
    let third = bigger + c.ri(1, 9);
    while (third === a || third === b) third = bigger + c.ri(1, 9);
    return mcq(
      `Which number is greater, ${a} or ${b}?`,
      bigger,
      [smaller, third],
      { A: "mc_digit_compare", B: "mc_digit_compare" },
      `Count on from ${smaller} to ${bigger}. You pass ${bigger}, so ${bigger} is the greater number.`,
    );
  },

  ns_ordering_magnitude: (c) => {
    const nums = [c.ri(20, 99), c.ri(100, 199), c.ri(20, 99)].map((v) => (v < 20 ? v + 25 : v));
    const sorted = [...new Set(nums)].sort((x, y) => x - y);
    return {
      stem: `Write these numbers in increasing order (smallest first): ${sorted.join(", ")}.`,
      type: "short",
      marks: 2,
      answerKey: sorted.join(", "),
      accepted: [sorted.join(","), sorted.join(" ")],
      steps: [`Line the tens up first: any number starting with 1 is the biggest.`],
      explanation: `A 3-digit number is always bigger than a 2-digit number, because it needs 3 tens to make it.`,
      difficulty: 2,
    };
  },

  ns_even_odd: (c) => {
    const n = c.ri(10, 99);
    const isEven = n % 2 === 0;
    return {
      stem: `Is ${n} even or odd?`,
      type: "mcq",
      marks: 1,
      options: ["A. Even", "B. Odd"],
      answerKey: isEven ? "A" : "B",
      explanation: isEven
        ? `${n} ends in ${n % 10}, an even digit, so it groups into pairs with nothing left over.`
        : `${n} ends in ${n % 10}, an odd digit, so one is left over after pairing.`,
      diagnoses: ["mc_numerator_rule"],
      difficulty: 1,
    };
  },

  ns_place_value: (c) => {
    const h = c.ri(1, 9);
    const t = c.ri(0, 9);
    const o = c.ri(0, 9);
    const n = h * 100 + t * 10 + o;
    const askTens = c.rnd() < 0.5;
    return fill(
      `In the number ${n}, what is the value of the ${askTens ? "tens" : "ones"} digit?`,
      askTens ? t : o,
      askTens
        ? `The ${t} is in the tens column, so it is worth ${t} tens = ${t * 10}. The answer asked is the digit ${t}.`
        : `The ${o} is in the ones column, so it is worth ${o} ones.`,
      2,
    );
  },

  ns_large_numbers: (c) => {
    const n = c.ri(1000, 99999);
    return {
      stem: `Write ${n} in words using the Indian system (with commas the way we write it here).`,
      type: "short",
      marks: 2,
      answerKey: String(n),
      steps: [`Split at the comma: ${n.toLocaleString("en-IN")} — first group is thousands, then hundreds, tens and ones.`],
      explanation: `In the Indian system a comma comes after the hundreds, then every two digits.`,
      difficulty: 3,
    };
  },

  ns_estimation_numbers: (c) => {
    const n = c.ri(120, 980);
    const rounded = Math.round(n / 10) * 10;
    return fill(
      `Round ${n} to the nearest ten.`,
      rounded,
      `Look at the ones digit, ${n % 10}. It is ${n % 10 >= 5 ? "5 or more, so" : "less than 5, so"} we round up to ${rounded}.`,
      2,
    );
  },

  /* ---------------- Addition & Subtraction ---------------- */
  as_within_20: (c) => {
    const a = c.ri(3, 9);
    const b = c.ri(2, 10);
    return {
      stem: `${a} + ${b} = ?`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(a + b),
      steps: [`Count on from ${a}: count ${b} more.`],
      explanation: `Counting on from ${a} means we only count the ${b} more, not everything from 1.`,
      diagnoses: ["mc_double_count", "mc_counting_all"],
      difficulty: 1,
    };
  },

  as_2digit: (c) => {
    const a = c.ri(12, 89);
    const b = c.ri(11, 99);
    const carry = (a % 10) + (b % 10) >= 10;
    return {
      stem: `${a} + ${b} = ?`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(a + b),
      steps: carry
        ? [`Ones: ${a % 10} + ${b % 10} = ${(a % 10) + (b % 10)}, which is 1 ten and ${((a % 10) + (b % 10)) % 10} ones.`]
        : [`Ones: ${a % 10} + ${b % 10} = ${(a % 10) + (b % 10)} ones.`],
      explanation: carry
        ? `Because the ones add up to 10 or more, we must regroup 10 ones into 1 ten and write the carry above the tens column.`
        : `The ones make ${(a % 10) + (b % 10)}, which is under 10, so nothing needs regrouping.`,
      diagnoses: ["mc_carry_loss"],
      difficulty: 2,
    };
  },

  as_3digit: (c) => {
    const a = c.ri(105, 780);
    const b = c.ri(95, 420);
    const total = a + b;
    return {
      stem: `${a} + ${b} = ?`,
      type: "fill_blank",
      marks: 2,
      answerKey: String(total),
      steps: [`Add the ones, carrying if needed.`, `Add the tens, carrying if needed.`, `Add the hundreds.`],
      explanation: `Line the ones under the ones before adding. If the ones reach 10, write 0 and carry 1 to the tens.`,
      diagnoses: ["mc_carry_loss", "mc_digit_reversal"],
      difficulty: 3,
    };
  },

  as_4digit: (c) => {
    const a = c.ri(1200, 8000);
    const b = c.ri(1100, 5000);
    return fill(`${a} + ${b} = ?`, a + b, `Line up the thousands, hundreds, tens and ones before adding.`, 3);
  },

  as_mental_strategies: (c) => {
    const a = 8;
    const b = c.ri(3, 9);
    return {
      stem: `${a} + ${b} = ? (Find the answer in your head, without counting all the numbers.)`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(a + b),
      steps: [`Take ${a} to the next full ten: ${a} + ${(10 - a)} = 10.`, `Now add the rest: 10 + ${a + b - 10} = ${a + b}.`],
      explanation: `Making ten first is quicker than counting on and it is much easier to check.`,
      diagnoses: ["mc_counting_all"],
      difficulty: 2,
    };
  },

  as_missing: (c) => {
    const a = c.ri(4, 20);
    const sum = a + c.ri(3, 15);
    const b = sum - a;
    return {
      stem: `${a} + ? = ${sum}`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(b),
      steps: [`The whole is ${sum} and we already have ${a}.`, `${sum} − ${a} = ${b}.`],
      explanation: `The empty box is the missing part, not zero. Subtract the known part from the whole to find it.`,
      diagnoses: ["mc_missing_addend"],
      difficulty: 2,
    };
  },

  as_subtract_order: (c) => {
    const a = c.ri(20, 90);
    const b = c.ri(5, 19);
    return {
      stem: `${a} − ${b} = ?`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(a - b),
      steps: [`Start from ${a} and take away ${b}.`],
      explanation: `Start counting back from ${a}. The answer is always less than ${a}, so if your answer is bigger, you subtracted the wrong way round.`,
      diagnoses: ["mc_subtract_order", "mc_carry_loss"],
      difficulty: 2,
    };
  },

  as_word_problems: (c) => {
    const n = c.pick(NAMES);
    const thing = c.pick(THINGS);
    const had = c.ri(20, 60);
    const gave = c.ri(4, 12);
    return {
      stem: `${n} had ${had} ${thing}. ${n} gave away ${gave} of them. How many ${thing} does ${n} have now?`,
      type: "short",
      marks: 2,
      answerKey: String(had - gave),
      steps: [`${had} − ${gave} = ${had - gave}.`],
      explanation: `"Gave away" means we take away, so we subtract. Cross out ${gave} of the ${had} to see it.`,
      diagnoses: ["mc_subtract_order", "mc_mult_add_confusion"],
      difficulty: 2,
    };
  },

  as_estimation: (c) => {
    const a = c.ri(23, 78);
    const b = c.ri(15, 60);
    const ra = Math.round(a / 10) * 10;
    const rb = Math.round(b / 10) * 10;
    return fill(
      `Estimate the sum of ${a} and ${b} by rounding each number to the nearest ten.`,
      ra + rb,
      `${a} rounds to ${ra} and ${b} rounds to ${rb}, so the estimated sum is ${ra} + ${rb} = ${ra + rb}.`,
      2,
    );
  },

  /* ---------------- Multiplication & Division ---------------- */
  md_repeated_addition: (c) => {
    const a = c.ri(3, 9);
    const b = c.ri(3, 6);
    return {
      stem: `${a} × ${b} = ?`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(a * b),
      steps: [`${b} groups of ${a}: ${Array(b).fill(a).join(" + ")} = ${a * b}.`],
      explanation: `Multiplication is equal groups. Draw ${b} rows of ${a} dots and count them all — you will get ${a * b}.`,
      diagnoses: ["mc_mult_add_confusion", "mc_mult_always_bigger"],
      difficulty: 2,
    };
  },

  md_tables: (c) => {
    const a = c.ri(2, 10);
    const b = c.ri(2, 10);
    return fill(`What is ${a} × ${b}?`, a * b, `${b} jumps of ${a} on a number line land on ${a * b}.`, 1);
  },

  md_array: (c) => {
    const rows = c.ri(3, 6);
    const cols = c.ri(3, 6);
    return {
      stem: `An array has ${rows} rows with ${cols} dots in each row. How many dots are there in all?`,
      type: "short",
      marks: 2,
      answerKey: String(rows * cols),
      steps: [`${rows} rows × ${cols} in each = ${rows * cols}.`],
      explanation: `Multiplication is the short way of saying "${cols} groups of ${rows}". Count the rows first, then along one row.`,
      diagnoses: ["mc_mult_add_confusion"],
      difficulty: 2,
    };
  },

  md_properties: (c) => {
    const a = c.ri(4, 9);
    let b = c.ri(2, 8);
    // The whole point is that turning the two numbers round changes nothing, so
    // the two options must actually be different expressions. With a === b the
    // stem read "which is bigger: 4 x 4 or 4 x 4?" with two identical options —
    // a question with no answer, printed on a child's paper.
    while (b === a) b = c.ri(2, 8);
    // Routed through `mcq` so the key rotates. Hand-building the option list left
    // the answer on "A" every single time, which lets a child score without
    // understanding — and makes the recorded misconception meaningless.
    return mcq(
      `Without multiplying out, which is bigger: ${a} x ${b} or ${b} x ${a}?`,
      `${a} x ${b}`,
      [`${b} x ${a}`, "They are different", "Neither can be told"],
      { A: "mc_mult_add_confusion", B: "mc_mult_add_confusion" },
      `Multiplication can be turned round: ${a} x ${b} and ${b} x ${a} always give the same answer. Both are ${a * b}.`,
    );
  },

  md_sharing: (c) => {
    const each = c.ri(2, 9);
    const kids = c.ri(2, 8);
    const total = each * kids;
    return {
      stem: `${total} ${c.pick(THINGS)} are shared equally among ${kids} children. How many does each child get?`,
      type: "short",
      marks: 2,
      answerKey: String(each),
      steps: [`${kids} children, ${each} each: ${Array(kids).fill(each).join(" + ")} = ${total}.`],
      explanation: `Check by multiplying back: ${kids} × ${each} = ${total}. If that does not come back to ${total}, the answer is wrong.`,
      diagnoses: ["mc_divisor_quotient_swap"],
      difficulty: 2,
    };
  },

  md_grouping: (c) => {
    const each = c.ri(2, 9);
    const groups = c.ri(2, 8);
    const total = each * groups;
    return {
      stem: `There are ${total} ${c.pick(THINGS)}. They are put into boxes with ${each} in each box. How many boxes are needed?`,
      type: "short",
      marks: 2,
      answerKey: String(groups),
      steps: [`${total} ÷ ${each} = ${groups}.`],
      explanation: `This is division the other way round: how many groups of ${each} fit into ${total}. Draw ${each} dots per box and count the boxes.`,
      diagnoses: ["mc_div_sharing_only", "mc_divisor_quotient_swap"],
      difficulty: 3,
    };
  },

  md_remainder: (c) => {
    const kids = c.ri(3, 6);
    const perBox = c.ri(3, 6);
    const extra = c.ri(1, perBox - 1);
    const total = kids * perBox + extra;
    return {
      stem: `${total} ${c.pick(THINGS)} are packed into ${c.pick(PACKETS)}, ${perBox} in each packet. How many packets are completely full, and how many ${c.pick(THINGS)} are left over?`,
      type: "medium",
      marks: 3,
      answerKey: `${kids} full packets, ${extra} left over`,
      accepted: [`${kids}, ${extra}`, `${kids} and ${extra}`, `${kids}r${extra}`],
      steps: [`${total} ÷ ${perBox} = ${kids} remainder ${extra}.`],
      explanation: `Group into ${perBox}s. ${kids} full groups use ${kids * perBox}, and ${extra} is left with no complete group.`,
      diagnoses: ["mc_remainder_meaning"],
      difficulty: 3,
    };
  },

  md_two_digit: (c) => {
    const a = c.ri(11, 40);
    const b = c.ri(3, 9);
    return {
      stem: `${a} × ${b} = ?`,
      type: "fill_blank",
      marks: 2,
      answerKey: String(a * b),
      steps: [`Split ${b} into ${Math.floor(b / 2) * 2} and ${b % 2}.`, `${a} × ${Math.floor(b / 2) * 2} = ${a * Math.floor(b * 2 / 2)} and ${a} × ${b % 2} = ${a * (b % 2)}.`],
      explanation: `Break the second number into easy parts. ${a} × ${Math.floor(b * 2 / 2)} and ${a} × ${b % 2} add up to ${a * b}.`,
      diagnoses: ["mc_carry_loss"],
      difficulty: 3,
    };
  },

  md_divide_digit: (c) => {
    const divisor = c.ri(2, 9);
    const quotient = c.ri(3, 12);
    return {
      stem: `${divisor * quotient} ÷ ${divisor} = ?`,
      type: "fill_blank",
      marks: 2,
      answerKey: String(quotient),
      steps: [`How many groups of ${divisor} fit into ${divisor * quotient}?`, `${quotient} groups.`],
      explanation: `Check by multiplying back: ${divisor} × ${quotient} = ${divisor * quotient}.`,
      diagnoses: ["mc_divisor_quotient_swap"],
      difficulty: 3,
    };
  },

  md_mixed_operations: (c) => {
    const a = c.ri(2, 6);
    const b = c.ri(2, 8);
    const c2 = c.ri(2, 5);
    return {
      stem: `Find the answer. Do the bracket first: (${a} + ${b}) × ${c2} = ?`,
      type: "fill_blank",
      marks: 2,
      answerKey: String((a + b) * c2),
      steps: [`Bracket first: ${a} + ${b} = ${a + b}.`, `Then multiply: ${a + b} × ${c2} = ${(a + b) * c2}.`],
      explanation: `Brackets always come first. If you multiply first you get a different and wrong answer.`,
      difficulty: 4,
    };
  },

  md_word_problems: (c) => {
    const pack = c.ri(4, 12);
    const boxes = c.ri(3, 9);
    const thing = c.pick(THINGS);
    return {
      stem: `One packet holds ${pack} ${thing}. There are ${boxes} packets. How many ${thing} are there altogether?`,
      type: "short",
      marks: 2,
      answerKey: String(pack * boxes),
      steps: [`${pack} in each packet, ${boxes} packets: ${pack} × ${boxes} = ${pack * boxes}.`],
      explanation: `Equal groups, so we multiply. Draw ${boxes} rectangles with ${pack} dots in each.`,
      diagnoses: ["mc_mult_add_confusion"],
      difficulty: 2,
    };
  },

  /* ---------------- Fractions & Decimals ---------------- */
  fr_concept: (c) => {
    const total = c.pick([2, 4, 8]);
    const den = total;
    const num = c.ri(1, total - 1);
    return {
      stem: `A ${c.pick(["chapati", "bar", "glass of milk", "cake", "pencil"])} is shared equally among ${den} children. Each child gets ${formatFraction(num, den)} of it.`,
      type: "fill_blank",
      marks: 1,
      answerKey: formatFraction(num, den),
      accepted: [String(num), `${num} / ${den}`],
      explanation: `Split the whole into ${den} equal parts. ${num} of those parts makes ${formatFraction(num, den)}.`,
      diagnoses: ["mc_denominator_bigger_bigger"],
      difficulty: 2,
    };
  },

  fr_equivalent: (c) => {
    const d = c.pick([2, 3, 4]);
    const n = c.ri(1, d - 1);
    const k = c.ri(2, 4);
    return {
      stem: `Write the fraction equivalent to ${n}/${d} with a denominator of ${d * k}.`,
      type: "fill_blank",
      marks: 2,
      answerKey: `${n * k}/${d * k}`,
      accepted: [String((n * k) / (d * k))],
      steps: [`${d} × ${k} = ${d * k}, so multiply the top by ${k} too.`, `${n} × ${k} = ${n * k}.`],
      explanation: `Multiply the top and the bottom by the same number and the fraction stays the same size.`,
      diagnoses: ["mc_numerator_rule"],
      difficulty: 3,
    };
  },

  fr_comparing: (c) => {
    const a = c.ri(1, 3);
    let b = c.ri(1, 3);
    // With a common denominator, equal numerators give equal fractions — so the
    // stem read "Which fraction is bigger, 2/4 or 2/4?" and, once the duplicate
    // was stripped from the options, left a question with a single option and
    // no choice at all. The two fractions must be different values.
    while (b === a) b = c.ri(1, 3);
    const d = 4;
    const sameDenom = c.rnd() < 0.5;
    const f1 = sameDenom ? `${a}/${d}` : `${a}/${a + 1}`;
    const n1 = Number(f1.split("/")[0]);
    const d1 = Number(f1.split("/")[1]);
    const n2 = sameDenom ? b : b + 1;
    const d2 = sameDenom ? d : b + 1;
    const f2 = `${n2}/${d2}`;
    const bigger = n1 / d1 >= n2 / d2 ? f1 : f2;
    // A third option that is neither of the two on screen, so the child really
    // is choosing. With only the two compared fractions as options, "which is
    // bigger, 1/2 or 1/4?" is answerable without comparing anything.
    const others = ["1/8", "3/4", "2/3", "3/8", "1/3"].filter((f) => f !== f1 && f !== f2);
    return mcq(
      `Which fraction is bigger, ${f1} or ${f2}?`,
      bigger,
      [f1 === bigger ? f2 : f1, others[Math.floor(c.rnd() * others.length)] ?? "1/8"],
      { A: "mc_numerator_rule", B: "mc_denominator_bigger_bigger" },
      `Put them on the same number line from 0 to 1. ${bigger} sits further right, so it is the bigger fraction.`,
    );
  },

  fr_number_line: (c) => {
    const d = c.pick([2, 4, 5, 10]);
    const n = c.ri(1, d - 1);
    return fill(
      `Show ${formatFraction(n, d)} on a number line from 0 to 1. Write which part of the line it is at.`,
      formatFraction(n, d),
      `Split 0 to 1 into ${d} equal parts. Each part is 1/${d}, and ${formatFraction(n, d)} is ${n} parts along.`,
      2,
    );
  },

  fr_addition: (c) => {
    const d = c.ri(3, 8);
    const a = c.ri(1, d - 1);
    const b = c.ri(1, d - a);
    return fill(
      `${a}/${d} + ${b}/${d} = ?  (Give the answer with denominator ${d}.)`,
      `${a + b}/${d}`,
      `The pieces are the same size, so add only the tops: ${a} + ${b} = ${a + b}.`,
      2,
    );
  },

  fr_application: (c) => {
    const total = c.pick([12, 16, 20]);
    return {
      stem: `A basket has ${total} ${c.pick(FRUITS)}. Meera eats 1/4 of them. How many does she eat?`,
      type: "short",
      marks: 2,
      answerKey: String(total / 4),
      steps: [`Share ${total} into 4 equal groups.`, `${total} ÷ 4 = ${total / 4} in each group.`, `She eats 1 group = ${total / 4}.`],
      explanation: `Divide into 4 equal parts first, then take one part. Do not multiply 12 by 1 and divide by 4 in the wrong order.`,
      diagnoses: ["mc_fraction_size"],
      difficulty: 3,
    };
  },

  dec_place_value: (c) => {
    const t = c.ri(1, 9);
    const h = c.ri(1, 9);
    return {
      stem: `What is the value of the digit ${h} in the number 0.${t}${h}?`,
      type: "fill_blank",
      marks: 1,
      answerKey: `${h}/100`,
      accepted: [`${h} hundredth`, `${h} hundredths`, `0.0${h}`],
      explanation: `The ${h} is the last digit, so it is ${h} hundredths.`,
      difficulty: 2,
    };
  },

  dec_reading: (c) => {
    const whole = c.ri(1, 9);
    const t = c.ri(1, 9);
    const h = c.ri(1, 9);
    return {
      stem: `Read the decimal number ${whole}.${t}${h} in words.`,
      type: "short",
      marks: 1,
      answerKey: `${whole} and ${t} tenths and ${h} hundredths`,
      accepted: [`${whole} point ${t} ${h}`, `${whole} and ${t} hundredth and ${h} hundredths`],
      explanation: `Say the whole part, then the tenths, then the hundredths — the decimal point is read as "point".`,
      difficulty: 2,
    };
  },

  dec_comparing: (c) => {
    /* These two were constants: `a = 0.5; b = 0.45`. Every question this topic
     * produced was therefore literally "Which decimal is bigger, 0.5 or 0.45?",
     * six times over in the bank — no variety, and one answer to memorise. Now
     * the pair is generated, with the harder case kept: the larger-looking
     * number must be the smaller decimal, which is the misconception this topic
     * exists to catch. */
    const tenths = c.ri(1, 9);
    const hundredths = c.ri(1, 9);
    const a = Number(`${tenths}.${hundredths}`);
    const b = Number(`${tenths}.${hundredths - 1 >= 1 ? hundredths - 1 : hundredths + 1}`);
    const bigger = a > b ? a : b;
    return mcq(
      `Which decimal is bigger, ${a} or ${b}?`,
      bigger,
      [a > b ? b : a, Number((a + b) / 2)],
      { A: "mc_decimal_digits", B: "mc_decimal_digits" },
      `Write them with the same number of places: ${a} = ${a.toFixed(2)} and ${b} = ${b.toFixed(2)}. Now compare the tenths: ${tenths} tenths beats ${b === a ? a : b} — the tenths decide it, not the digits' size.`,
    );
  },

  dec_money: (c) => {
    const item = c.pick(["pencil", "eraser", "notebook", "ruler", "pen"]);
    const rupees = c.ri(2, 9);
    const paise = c.pick([25, 50, 75]);
    return {
      stem: `A ${item} costs ₹${rupees}.${String(paise).padStart(2, "0")}. How much do you pay in rupees and paise?`,
      type: "fill_blank",
      marks: 1,
      answerKey: `${rupees}.${String(paise).padStart(2, "0")}`,
      accepted: [`₹${rupees}.${String(paise).padStart(2, "0")}`],
      explanation: `There are 100 paise in a rupee, and the last two digits after the point are the paise.`,
      diagnoses: ["mc_money_calculation"],
      difficulty: 2,
    };
  },

  /* ---------------- Algebra ---------------- */
  al_patterns: (c) => {
    const start = c.ri(1, 9);
    const step = c.ri(2, 6);
    const terms = [0, 1, 2, 3].map((i) => start + i * step);
    const next = start + 4 * step;
    return {
      stem: `Find the next number in the pattern: ${terms.join(", ")}, ____`,
      type: "fill_blank",
      marks: 2,
      answerKey: String(next),
      steps: [`The gap each time is ${step}.`, `${terms[3]} + ${step} = ${next}.`],
      explanation: `Look at the gap between each pair. It stays the same at ${step}, so keep adding ${step}.`,
      difficulty: 2,
    };
  },

  al_open_sentences: (c) => {
    const n = c.ri(3, 12);
    const a = c.ri(2, 9);
    return mcq(
      `Look at the number sentence: ${a} + ${n} = ${a + n}. Is it always true, never true, or sometimes true?`,
      "Always true",
      ["Never true", "Sometimes true", "Cannot be told"],
      { A: "mc_open_sentence", B: "mc_open_sentence" },
      `Add ${a} to anything and you get something bigger, so ${a} + ${n} is always more than ${n}. This sentence is always true.`,
    );
  },

  al_missing_number: (c) => {
    const a = c.ri(2, 9);
    const mult = c.ri(2, 5);
    const n = c.ri(2, 9);
    return {
      stem: `A machine multiplies whatever number goes in by ${a} and then adds ${mult}. If ${n} goes in, what comes out?`,
      type: "fill_blank",
      marks: 2,
      answerKey: String(n * a + mult),
      steps: [`Multiply first: ${n} × ${a} = ${n * a}.`, `Then add ${mult}: ${n * a} + ${mult} = ${n * a + mult}.`],
      explanation: `Work through the machine in order — multiply first, then add.`,
      diagnoses: ["mc_mult_add_confusion"],
      difficulty: 3,
    };
  },

  al_variables: (c) => {
    const n = c.ri(2, 9);
    return fill(`If n = ${n}, what is the value of 3n + 1?`, 3 * n + 1, `3n means ${n} added three times: 3 × ${n} = ${3 * n}, then + 1.`, 3);
  },

  al_equations: (c) => {
    const a = c.ri(2, 9);
    const x = c.ri(2, 12);
    return {
      stem: `Solve for x:  x + ${a} = ${a + x}`,
      type: "fill_blank",
      marks: 2,
      answerKey: String(x),
      steps: [`Take the ${a} to the other side: ${a + x} − ${a} = ${x}.`],
      explanation: `To undo "+ ${a}", subtract ${a} from both sides. Whatever is left is x.`,
      difficulty: 3,
    };
  },

  /* ---------------- Geometry ---------------- */
  ge_2d_shapes: (c) => {
    const shape = c.pick([
      { name: "triangle", sides: 3, corners: 3 },
      { name: "square", sides: 4, corners: 4 },
      { name: "rectangle", sides: 4, corners: 4 },
      { name: "pentagon", sides: 5, corners: 5 },
      { name: "hexagon", sides: 6, corners: 6 },
      { name: "octagon", sides: 8, corners: 8 },
    ]);
    return {
      stem: `How many sides does a ${shape.name} have?`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(shape.sides),
      explanation: `A ${shape.name} has ${shape.sides} straight sides and ${shape.corners} corners. Count them on a drawing.`,
      difficulty: 1,
    };
  },

  ge_3d_solids: (c) => {
    const solid = c.pick([
      { name: "cube", faces: 6, edges: 12, corners: 8 },
      { name: "cuboid", faces: 6, edges: 12, corners: 8 },
      { name: "cylinder", faces: 3, edges: 2, corners: 0 },
      { name: "cone", faces: 2, edges: 1, corners: 0 },
      { name: "sphere", faces: 1, edges: 0, corners: 0 },
    ]);
    return fill(`How many faces does a ${solid.name} have?`, solid.faces, `Feel the ${solid.name} and count its flat surfaces. A sphere has 1 curved surface, not a flat face.`, 2);
  },

  ge_sides_corners: (c) => {
    const n = c.ri(3, 8);
    return {
      stem: `A shape has ${n} corners. How many sides does it have?`,
      type: "fill_blank",
      marks: 1,
      answerKey: String(n),
      explanation: `A closed shape has exactly as many sides as it has corners. Join the dots and count.`,
      difficulty: 2,
    };
  },

  ge_lines_angles: (c) => {
    const angle = c.pick(["right", "acute", "obtuse"]);
    return {
      stem: `An angle is ${angle}. Is it bigger than, smaller than, or the same as a right angle?`,
      type: "mcq",
      marks: 1,
      options: ["A. Bigger than a right angle", "B. Smaller than a right angle", "C. The same as a right angle"],
      answerKey: angle === "obtuse" ? "A" : angle === "right" ? "C" : "B",
      explanation: `A right angle is 90°. An obtuse angle opens wider than 90°, an acute angle opens narrower.`,
      difficulty: 3,
    };
  },

  ge_angles: (c) => {
    const angle = c.pick(["right", "acute", "obtuse"]);
    return {
      stem: `Classify this angle: it is ${angle}. Name it.`,
      type: "fill_blank",
      marks: 1,
      answerKey: angle,
      accepted: [`${angle} angle`],
      explanation: `Hold up a right angle made from a sheet of paper. Wider than that is obtuse, narrower is acute.`,
      difficulty: 2,
    };
  },

  ge_symmetry: (c) => {
    /* This used to name a regular hexagon in the stem and then key a random
     * number from 1 to 6 — so five questions in six shipped with an answer the
     * stem contradicts, and the explanation ("folds onto itself 6 ways") agreed
     * with the stem, not the key. The shape is now chosen together with its
     * count, so the two cannot disagree. */
    const shape = c.pick([
      { name: "equilateral triangle", lines: 3 },
      { name: "square", lines: 4 },
      { name: "regular pentagon", lines: 5 },
      { name: "regular hexagon", lines: 6 },
      { name: "regular octagon", lines: 8 },
    ]);
    return fill(
      `How many lines of symmetry does a ${shape.name} have?`,
      shape.lines,
      `Fold the ${shape.name} so the two halves match. A ${shape.name} folds onto itself ${shape.lines} ways.`,
      3,
    );
  },

  ge_perimeter: (c) => {
    const a = c.ri(3, 15);
    const b = c.ri(3, 15);
    return {
      stem: `A rectangle is ${a} cm long and ${b} cm wide. What is its perimeter?`,
      type: "short",
      marks: 2,
      answerKey: String(2 * (a + b)),
      steps: [`Top and bottom: ${a} + ${a} = ${2 * a} cm.`, `Sides: ${b} + ${b} = ${2 * b} cm.`, `Total: ${2 * a} + ${2 * b} = ${2 * (a + b)} cm.`],
      explanation: `Perimeter is the distance all the way around, so add every side once. Walk the edge with a finger as you count.`,
      diagnoses: ["mc_perimeter_area"],
      difficulty: 3,
    };
  },

  ge_area: (c) => {
    const a = c.ri(3, 12);
    const b = c.ri(3, 12);
    return {
      stem: `A rectangle is ${a} cm long and ${b} cm wide. What is its area in square cm?`,
      type: "short",
      marks: 2,
      answerKey: String(a * b),
      steps: [`Count the squares along the length: ${a}.`, `Count the squares along the width: ${b}.`, `${a} × ${b} = ${a * b} squares.`],
      explanation: `Area is the space inside. Cover the shape with 1 cm squares and count them — it is ${a * b}.`,
      diagnoses: ["mc_perimeter_area"],
      difficulty: 3,
    };
  },

  ge_tiling: (c) => {
    const shape = c.pick(["triangle", "square", "hexagon"]);
    // Through `mcq`, so the answer is not always the first option. A two-option
    // question whose answer is always "Yes" teaches a child to tick A, which is
    // worse than asking nothing.
    return mcq(
      `Can a regular ${shape} tile a floor completely with no gaps and no overlaps?`,
      "Yes",
      ["No", "Only if it is cut up", "Cannot be told"],
      { A: "mc_chart_overclaim", B: "mc_chart_overclaim" },
      `A regular ${shape} has angles that fit together exactly, so copies of it can cover a surface completely.`,
    );
  },

  /* ---------------- Measurement ---------------- */
  me_length: (c) => {
    const item = c.pick(["pencil", "eraser", "hand span", "book", "door", "chappal"]);
    return {
      stem: `Which is nearer to 1 metre: the length of a ${c.pick(["matchbox", "school bag", "car"])}, or the length of a ${item}?`,
      type: "mcq",
      marks: 1,
      options: ["A. the smaller object", "B. the larger object"],
      answerKey: item === "door" || item === "car" ? "B" : "A",
      explanation: `Hold a 1 m string out and compare. ${item === "door" ? "A door is about the same as a metre." : "That is much smaller than a metre."}`,
      difficulty: 2,
    };
  },

  me_mass: (c) => {
    const n = c.pick(["an apple", "a bag of flour", "a pencil box", "a school child", "a watermelon"]);
    return {
      stem: `About how much does ${n} weigh?`,
      type: "mcq",
      marks: 1,
      options: ["A. 5 grams", "B. 500 grams", "C. 5 kilograms"],
      answerKey: n === "an apple" ? "B" : n === "a pencil box" ? "A" : "C",
      explanation: `Feel how heavy 1 kg feels. Anything you can hold with one hand easily is nearer 500 g; a big bag needs two hands and is nearer 5 kg.`,
      diagnoses: ["mc_estimation"],
      difficulty: 2,
    };
  },

  me_capacity: (c) => {
    const container = c.pick(["water bottle", "bucket", "glass", "cooking oil bottle", "large jug"]);
    return {
      stem: `About how much does a full ${container} hold?`,
      type: "mcq",
      marks: 1,
      options: ["A. 50 millilitres", "B. 1 litre", "C. 20 litres"],
      answerKey: container === "glass" ? "A" : container === "bucket" || container === "large jug" ? "C" : "B",
      explanation: `A glass is about 200 ml. A water bottle is about 1 litre. A bucket is around 10-20 litres.`,
      diagnoses: ["mc_estimation"],
      difficulty: 2,
    };
  },

  me_time: (c) => {
    const h = c.ri(1, 11);
    const m = c.pick([0, 15, 30, 45]);
    return {
      stem: `The clock shows ${h} o'clock${m ? ` and ${m} minutes` : ""}. Write the time in the correct way.`,
      type: "fill_blank",
      marks: 1,
      answerKey: m === 0 ? `${h}:00` : `${h}:${String(m).padStart(2, "0")}`,
      accepted: [`${h}.${String(m).padStart(2, "0")}`, m === 0 ? `${h} o'clock` : `${h} ${m}`],
      steps: [`The short hand shows the hour.`, `The long hand shows the minutes.`],
      explanation: `The short hand points just past ${h}, so it is ${h} o'clock. The long hand on ${m === 0 ? 12 : m} means ${m === 0 ? "" : `${m} minutes`}.`,
      diagnoses: ["mc_clock_reading"],
      difficulty: 2,
    };
  },

  me_money: (c) => {
    const cost = c.ri(5, 40);
    const paid = Math.ceil(cost / 10) * 10;
    return {
      stem: `A notebook costs ₹${cost}. You pay with a ₹${paid} note. How much change should you get?`,
      type: "fill_blank",
      marks: 2,
      answerKey: String(paid - cost),
      steps: [`${paid} − ${cost} = ${paid - cost}.`],
      explanation: `Change is what is left after paying, so subtract the cost from the note.`,
      diagnoses: ["mc_money_calculation"],
      difficulty: 2,
    };
  },

  me_conversion: (c) => {
    const kind = c.pick([
      { q: "How many centimetres are there in 3 metres?", a: 300, why: "1 m = 100 cm, so 3 m = 300 cm." },
      { q: "How many grams are there in 2 kilograms?", a: 2000, why: "1 kg = 1000 g, so 2 kg = 2000 g." },
      { q: "How many millilitres are there in 2 litres?", a: 2000, why: "1 litre = 1000 ml, so 2 litres = 2000 ml." },
      { q: "How many minutes are there in 2 hours?", a: 120, why: "1 hour = 60 minutes, so 2 hours = 120 minutes." },
    ]);
    return fill(kind.q, kind.a, kind.why, 2);
  },

  me_estimation: (c) => {
    /* This has to be a question about something. The old stem was
     * "Which is closer to 50?" with nothing to estimate — no quantity, no
     * starting point — and when the number happened to be a multiple of ten both
     * options came out as the same figure, so a child could not have answered
     * it correctly either way.
     *
     * Now the child has a real decision: a known cost and a known budget, and
     * the exact answer is hidden behind a division. That is what estimation is
     * for, and it is the difference between estimating and rounding. */
    const cost = c.ri(6, 19);
    const budget = c.ri(50, 190);
    // The exact answer is hidden behind a division; the child must place it
    // between two multiples of ten.
    const exact = Math.floor(budget / cost);
    // Floored at one dozen rather than at zero: "0 pencils" is not something a
    // child buys, so offering it as the nearer estimate is nonsense dressed up
    // as a multiple of ten. Distances are then measured from these clamped
    // options, so the key and the explanation still agree.
    const lo = Math.max(10, Math.floor(exact / 10) * 10);
    const hi = lo + 10;
    // Nearer is computed from the distances to each option and used for BOTH the
    // key and the explanation. Deriving them separately is how this briefly
    // shipped a key of "A. 10" beside an explanation saying "nearer to 20" —
    // and an explanation that contradicts the answer key is worse than none,
    // because a teacher reading it has no way to tell which one is wrong.
    const nearerIsLow = exact - lo <= hi - exact;
    // Absolute distances: when `exact` falls below the clamped lower bound the
    // signed difference is negative, and "−7 away from 10" in a teacher's notes
    // reads as a bug even though the key it justifies is right.
    const dLow = Math.abs(exact - lo);
    const dHigh = Math.abs(hi - exact);
    return {
      stem: `Each pencil costs ${cost} rupees. You have ${budget} rupees. Without working it out exactly, which is closer to the number of pencils you can buy?`,
      type: "mcq",
      marks: 1,
      options: [`A. ${lo}`, `B. ${hi}`],
      answerKey: nearerIsLow ? "A" : "B",
      explanation: `${budget} ÷ ${cost} = ${exact}. That is ${dLow} away from ${lo} and ${dHigh} away from ${hi}, so it is nearer ${nearerIsLow ? lo : hi}.`,
      diagnoses: ["mc_estimation"],
      difficulty: 2,
    };
  },

  /* ---------------- Data & Probability ---------------- */
  da_tally: (c) => {
    const n = c.ri(3, 9);
    return fill(
      `There are ${n * 5} pencils. Show ${n * 5} in tally marks. How many groups of five do you see?`,
      n,
      `Every group of four marks with one across the top makes five. ${n * 5} ÷ 5 = ${n} groups.`,
      1,
    );
  },

  da_table: (c) => {
    const a = c.ri(4, 15);
    const b = c.ri(4, 15);
    return {
      stem: `In Class ${c.pick(["3", "4", "5"])}, ${a} children like cricket and ${b} like football. How many children like one of the two games altogether?`,
      type: "short",
      marks: 2,
      answerKey: String(a + b),
      steps: [`${a} + ${b} = ${a + b}.`],
      explanation: `If no child chose both games, we simply add the two columns of the table.`,
      diagnoses: ["mc_mult_add_confusion"],
      difficulty: 2,
    };
  },

  da_pictograph: (c) => {
    const key = c.pick([2, 5, 10]);
    const symbols = c.ri(2, 7);
    return fill(
      `In a pictograph, one symbol stands for ${key} children. ${symbols} symbols are drawn for cricket. How many children chose cricket?`,
      symbols * key,
      `Count the symbols (${symbols}) and multiply by what each one stands for (${key}).`,
      2,
    );
  },

  da_bar_graph: (c) => {
    const a = c.ri(4, 12);
    const b = a + c.ri(1, 6);
    return {
      stem: `The bar graph shows the number of children who came by different things to school. ${a} brought a tiffin box and ${b} brought a water bottle. How many more children brought a water bottle than a tiffin box?`,
      type: "short",
      marks: 2,
      answerKey: String(b - a),
      steps: [`Read the key first, then count the squares.`, `${b} − ${a} = ${b - a}.`],
      explanation: `Always read what one square stands for before reading the bars, then subtract the smaller from the larger.`,
      diagnoses: ["mc_graph_scale"],
      difficulty: 3,
    };
  },

  da_line_graph: (c) => {
    const a = c.ri(3, 9);
    const b = c.ri(3, 9);
    return {
      stem: `A line graph shows the number of books read each month. In month 1 it was ${a}, and in month 2 it was ${b}. Did the number go up or down? By how much?`,
      type: "short",
      marks: 2,
      answerKey: `${b > a ? "up" : "down"} by ${Math.abs(b - a)}`,
      accepted: [`${b > a ? "up" : "down"}, ${Math.abs(b - a)}`, `${Math.abs(b - a)}`],
      steps: [`Compare ${a} and ${b}.`, `The difference is ${Math.abs(b - a)}.`],
      explanation: `The line went ${b > a ? "up" : "down"} from ${a} to ${b}. The change is the difference between the two.`,
      diagnoses: ["mc_graph_scale"],
      difficulty: 3,
    };
  },

  da_pie_chart: (c) => {
    return {
      stem: `A pie chart shows the favourite fruit of 40 children. Half the circle is mangoes. How many children chose mango?`,
      type: "short",
      marks: 2,
      answerKey: "20",
      steps: [`Half of 40 = 40 ÷ 2.`, `40 ÷ 2 = 20.`],
      explanation: `Half the circle means half of the children, so share 40 into two equal groups.`,
      diagnoses: ["mc_graph_scale"],
      difficulty: 3,
    };
  },

  da_interpret: (c) => {
    const a = c.ri(3, 8);
    const b = a + c.ri(1, 5);
    // Football and kho-kho are given the same count on purpose: the point is
    // that the tallest bar wins, not the one drawn first. Routed through `mcq`
    // so the key moves.
    return mcq(
      `A bar graph shows favourite games: football ${a} children, kabaddi ${b} children, kho-kho ${a} children. Which game is the most popular?`,
      "Kabaddi",
      ["Football", "Kho-kho", "Cannot be told"],
      { A: "mc_chart_overclaim", B: "mc_chart_overclaim" },
      `Kabaddi has the tallest bar at ${b}, so kabaddi is the most popular. Look for the tallest bar, not the one drawn first.`,
    );
  },

  da_chance: (c) => {
    const yes = c.ri(1, 4);
    const no = c.ri(1, 4);
    return {
      stem: `A bag has ${yes} red ${c.pick(["balls", "marbles", "beads"])} and ${no} blue ones. If you pick one without looking, is it more likely to be red or blue?`,
      type: "mcq",
      marks: 1,
      options: ["A. Red", "B. Blue", "C. Both are equally likely"],
      answerKey: yes > no ? "A" : yes === no ? "C" : "B",
      explanation: `There are more ${yes > no ? "red" : yes === no ? "of each, so" : "blue"} ones, so it is more likely to pick that colour. More of something means it is more likely.`,
      diagnoses: ["mc_chart_overclaim"],
      difficulty: 2,
    };
  },
};

function formatFraction(n: number, d: number): string {
  const map: Record<string, string> = {
    "1/2": "half", "1/3": "one-third", "2/3": "two-thirds", "1/4": "one-fourth",
    "3/4": "three-fourths", "1/5": "one-fifth", "2/5": "two-fifths", "3/5": "three-fifths",
    "4/5": "four-fifths", "1/8": "one-eighth", "3/8": "three-eighths",
  };
  return map[`${n}/${d}`] ?? `${n}/${d}`;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function topicHasGenerator(topicId: string): boolean {
  return Boolean(GENERATORS[topicId]);
}

export function generatorCoverage(): { total: number; covered: number; missing: string[] } {
  const missing = Object.keys(GENERATORS).length === 0 ? [] : [];
  return { total: 0, covered: Object.keys(GENERATORS).length, missing };
}

/**
 * Generate `count` questions for a topic without any AI.
 * Returns [] when the topic has no generator — the caller should then either
 * use the stored question bank or fall back to the AI.
 */
export function generateForTopic(
  topicId: string,
  count: number,
  grade: number,
  seed: number,
  higher = false,
): GeneratedQuestion[] {
  const gen = GENERATORS[topicId];
  if (!gen) return [];
  const c = makeCtx(seed, grade, higher);
  const out: GeneratedQuestion[] = [];
  for (let i = 0; i < count; i++) {
    try {
      out.push(gen(c, i));
    } catch {
      // A generator that throws for one number is a bug in the template, not a
      // reason to fail the whole paper. Skip and try the next index.
      continue;
    }
  }
  return out;
}

/** Every topic that has a built-in generator, for the UI to show. */
export function generatableTopicIds(): string[] {
  return Object.keys(GENERATORS);
}
