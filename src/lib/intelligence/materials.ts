/**
 * Printable lesson materials.
 *
 * The plan tells a teacher *what* to teach and the recommendation engine tells
 * them *how*. Neither is a lesson. A teacher standing in front of thirty
 * children still has to decide what to write on the board, which three
 * questions to do together, and what to put on the worksheet — and that is
 * real preparation time, every single lesson.
 *
 * This closes that gap and produces a sheet a teacher can print and teach from
 * with nothing else to hand.
 *
 * ## The constraint that shaped it
 *
 * The existing material lists say things like "bundles of ten in rubber
 * bands" and "a 1 kg bag of rice". Those are good pedagogy and they assume a
 * school that can buy them. A large share of Indian classrooms cannot, and a
 * lesson plan that assumes equipment is a lesson plan that quietly does not
 * get taught.
 *
 * So every material here carries a **paper substitute** — a version made of
 * paper, pencil and the children's own hands. The manipulative is offered as
 * the better option; the substitute is offered as the one that is always
 * available. Nothing on the sheet is unobtainable.
 *
 * ## Structure
 *
 * The sheet follows NCF-FL 2023's concrete → pictorial → abstract spine,
 * because that is the sequence the framework asks for and because it is also
 * simply the order that works. The blackboard plan is the spine: what to
 * write, when, so a teacher can run the lesson off one page.
 */

import { MISCONCEPTION_BY_ID, TOPIC_BY_ID, STRAND_BY_ID } from "@/lib/curriculum";
import { generateForTopic, topicHasGenerator } from "@/lib/question-generation/templates";
import { materialsFor } from "@/lib/intelligence/recommendations";

export type MaterialLine = {
  /** The good option, if the school has it. */
  ideal: string;
  /** What to use when they do not. Always available. */
  substitute: string;
  /** Why this material, for a teacher who has never taught the topic. */
  why: string;
};

export type BlackboardStep = {
  /** What goes on the board. */
  write: string;
  /** What the teacher asks. Always a question, never a statement. */
  say: string;
  /** What the children do. */
  do: string;
  /** What to watch for — the misconception to catch while it is still cheap. */
  look: string;
  minutes: number;
};

export type WorkedExample = {
  question: string;
  steps: string[];
  answer: string;
};

export type LessonMaterials = {
  topicId: string;
  topicName: string;
  topicNameHi: string;
  grade: number;
  strandName: string;
  minutes: number;
  /** Why this topic today, from the plan. */
  why: string;
  /** The misconception being designed against, if any. */
  misconceptionName: string | null;
  misconceptionFix: string | null;
  materials: MaterialLine[];
  blackboard: BlackboardStep[];
  worked: WorkedExample[];
  /** Do these together, watching the class. */
  guided: string[];
  /** The worksheet, printed for every child. */
  worksheet: string[];
  successCheck: string;
  differentiation: { struggling: string; onTrack: string; advanced: string };
  /** Stated plainly when practice cannot be generated, so nothing looks broken. */
  worksheetNote: string | null;
};

/** A working substitute for each material the engine can ask for. */
const SUBSTITUTES: { match: RegExp; substitute: string; why: string }[] = [
  {
    match: /rubber band|bundles of ten|counters|beans|counting mat/i,
    substitute: "Draw boxes in rows of ten on the board, and have children draw dots in their copies. Fingers work too.",
    why: "Bundling into tens is the whole idea; drawn boxes and fingers make it visible without any equipment.",
  },
  {
    match: /unit squares|thread|paper strip|1×6/i,
    substitute: "Squared paper, and a strip cut from an old exercise book six squares long.",
    why: "Counting squares works better than thread for seeing area, and the strip covers perimeter.",
  },
  {
    match: /paper circles|cut into halves|number line strip/i,
    substitute: "Two circles drawn in the copies, folded along a line, and cut out with scissors.",
    why: "Folding before cutting is what makes halves and quarters real to a child who has never seen a fraction.",
  },
  {
    match: /1 m strip|metre rule|100 g weight|1 kg bag of rice/i,
    substitute: "A ruler, a piece of chalk, and the classroom door or a book measured together.",
    why: "Measuring something they already have makes the unit mean something; a number on a chart does not.",
  },
  {
    match: /clock with movable hands|chalkboard circle/i,
    substitute: "Draw a clock face on the board, numbered, and let a child stand and point to the hands.",
    why: "A drawn face with hands moved by a child teaches the same thing as a bought model.",
  },
  {
    match: /place-value mats|digit cards/i,
    substitute: "Three columns drawn on the board headed H, T, O, and digit cards cut from an old register.",
    why: "The columns are the entire idea of place value; the cards only make them easier to move.",
  },
  {
    match: /cut-out shapes|mirror|squared paper/i,
    substitute: "Shapes traced from the board onto squared paper, and a book used to test symmetry.",
    why: "Tracing and folding test sides, angles and symmetry exactly as well as cut-outs do.",
  },
  {
    match: /tally marks/i,
    substitute: "Tally marks drawn straight onto the board from a quick show of hands.",
    why: "The point is counting real class data, which is free and immediate.",
  },
  {
    match: /number line/i,
    substitute: "A number line ruled onto the board with a chalk line, or drawn along a folded strip of paper.",
    why: "A number line drawn once is a number line; buying one is optional.",
  },
];

function substituteFor(ideal: string): { substitute: string; why: string } {
  for (const row of SUBSTITUTES) {
    if (row.match.test(ideal)) return { substitute: row.substitute, why: row.why };
  }
  return {
    substitute: "Squared paper, a pencil, and the board. Every lesson here can be taught with those three things.",
    why: "A topic that genuinely needs equipment is rare in primary mathematics; this one does not.",
  };
}

/** Split a materials sentence so each item gets its own line. */
function splitMaterials(sentence: string): string[] {
  return sentence
    .split(/,\s*(?:and\s+)?/)
    .map((s) => s.trim().replace(/^and\s+/i, ""))
    .filter((s) => s.length > 2);
}

export function buildMaterials(args: {
  topicId: string;
  grade: number;
  minutes?: number;
  why?: string;
  misconceptionId?: string | null;
}): LessonMaterials | null {
  const topic = TOPIC_BY_ID.get(args.topicId);
  if (!topic) return null;

  const grade = Math.min(5, Math.max(1, args.grade)) as 1 | 2 | 3 | 4 | 5;
  const minutes = args.minutes ?? 40;
  const misconception = args.misconceptionId ? MISCONCEPTION_BY_ID.get(args.misconceptionId) : null;
  const strandName = STRAND_BY_ID.get(topic.strand)?.name ?? "";

  // Materials, each with a version that is always to hand.
  const raw = splitMaterials(materialsFor(topic.strand, misconception ?? null));
  const materials: MaterialLine[] = raw.map((ideal) => {
    const { substitute, why } = substituteFor(ideal);
    return { ideal, substitute, why };
  });

  // Questions. The bank is the source, so the worksheet and the teacher's
  // examples are the same questions the app will later mark.
  const canGenerate = topicHasGenerator(args.topicId);
  const seed = hash(args.topicId + grade + (args.misconceptionId ?? ""));
  const made = canGenerate
    ? generateForTopic(args.topicId, 9, grade, seed, true)
    : [];
  const worksheetNote = made.length === 0
    ? "No generated worksheet exists for this topic yet. Use the paper generator, or write three questions on the board and have children copy them."
    : null;

  // Two worked examples from the top of the set, with steps where the
  // generator supplies them.
  const worked: WorkedExample[] = made.slice(0, 2).map((q) => ({
    question: q.stem,
    steps: q.steps?.length ? q.steps : ["Ask the children to say what they notice first, before writing anything."],
    answer: typeof q.answerKey === "string" ? q.answerKey : String(q.answerKey),
  }));
  const guided = made.slice(2, 5).map((q) => q.stem);
  const worksheet = made.slice(5).map((q) => q.stem);

  // The blackboard plan. The order is the concrete → pictorial → abstract
  // spine, and the "look" on each step names the misconception to catch while
  // it is still one child's error rather than a class's.
  const look = misconception
    ? `Watch for ${misconception.belief} Look for ${misconception.evidence.toLowerCase()}`
    : "Watch for answers given by pattern rather than by thinking. Ask how they got there.";
  const split: [number, number, number] = [
    Math.round(minutes * 0.35), Math.round(minutes * 0.3), Math.round(minutes * 0.35),
  ];
  const blackboard: BlackboardStep[] = [
    {
      write: `Write: ${topic.name}`,
      say: `What do you already know about ${topic.name.toLowerCase()}?`,
      do: "Children answer from what they remember. Take three different ones.",
      look: "Listen for who has a secure idea — start the lesson from them, not from silence.",
      minutes: Math.max(2, Math.round(minutes * 0.1)),
    },
    {
      write: worked[0] ? `Do together: ${worked[0].question}` : `Do together: the first example on the worksheet`,
      say: "What do you notice first? Tell me before you write anything.",
      do: "One child comes to the board. The rest watch and talk to a partner about what they think.",
      look,
      minutes: split[0],
    },
    {
      write: "Draw it. Two or three children show a way of seeing it on paper.",
      say: "Can you show that another way? Draw it so someone else could follow it.",
      do: "Children draw. Compare drawings with a partner.",
      look: "A child who draws a correct method and cannot explain it is not yet secure.",
      minutes: split[1],
    },
    {
      write: `Now try these on your own:\n${guided.slice(0, 2).map((g, i) => `${i + 1}. ${g}`).join("\n") || "the guided questions above"}`,
      say: "What will you try first? If you get stuck, write a question mark and carry on.",
      do: "Independent work, about ten minutes, in silence.",
      look: "Children writing a question mark rather than stopping is worth praising out loud.",
      minutes: split[2],
    },
  ];

  return {
    topicId: args.topicId,
    topicName: topic.name,
    topicNameHi: topic.nameHi,
    grade,
    strandName,
    minutes,
    why: args.why ?? "",
    misconceptionName: misconception?.name ?? null,
    misconceptionFix: misconception?.strategy ?? null,
    materials,
    blackboard,
    worked,
    guided,
    worksheet,
    successCheck:
      "Before the bell, ask three children who found it hard to explain their answer. If they can say it in one sentence, the lesson landed. If they cannot, the same lesson tomorrow — not the next topic.",
    differentiation: {
      struggling: `Sit them with a child who explains well, and give them the worksheet with the last two questions removed. ${misconception ? `They need ${misconception.name.toLowerCase()} fixed before anything else on this topic matters.` : "Reduce the amount, not the difficulty."}`,
      onTrack: "The worksheet as printed. If they finish, they explain the second worked example to a partner.",
      advanced: `Ask them to write the same answer a different way and say why both are right.${worked[0] ? " Then give them the next topic's first question." : ""}`,
    },
    worksheetNote,
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
