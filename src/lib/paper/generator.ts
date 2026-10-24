/**
 * Paper generation.
 *
 * A teacher should be able to say "make me a 20-mark test for Class 3 that
 * finds out whether they have got fractions" and get a usable paper. This
 * module does that, and it is deliberately written to work with nothing but
 * the local database, so it never blocks on an AI provider being reachable.
 *
 * Sources are tried in order of trustworthiness, and the source actually used
 * is recorded per question:
 *
 *   1. The question bank — human-written or previously AI-generated and
 *      already reviewed by a teacher. Best option, so it goes first.
 *   2. AI generation — fresh and on-topic, but every question passes
 *      validation before it can be used.
 *   3. Built-in generators — arithmetically generated from templates, so the
 *      answers are correct by construction. Always available.
 *
 * The resulting paper records which source each question came from, so a
 * teacher can tell a bank question from a generated one at a glance.
 */

import { prisma, parseJson, toJson } from "@/lib/db";
import {
  COMPETENCY_LEVELS,
  QUESTION_TYPE_BY_ID,
  TOPIC_BY_ID,
  type CompetencyId,
} from "@/lib/curriculum";
import { generateQuestions, validateGenerated, type GeneratedQuestion } from "@/lib/ai/questions";
import { isAiEnabled } from "@/lib/ai/client";
import { generateForTopic, hashSeed, topicHasGenerator } from "@/lib/question-generation/templates";
import { toCompetition } from "@/lib/question-generation/competition";
import { gradeBand, topicDepth } from "@/lib/curriculum";

/* ------------------------------------------------------------------ */
/* Blueprint                                                           */
/* ------------------------------------------------------------------ */

export type Blueprint = {
  /** topicId → number of questions. */
  topics: Record<string, number>;
  /** Competency mix, e.g. { basic: 0.5, competent: 0.3, proficient: 0.2 }. */
  competency: Partial<Record<CompetencyId, number>>;
  /** Preferred question types; empty means "whatever suits the topic". */
  types: string[];
  totalMarks: number;
  title: string;
  term: string;
  unitName?: string;
  date?: Date;
};

export const DEFAULT_COMPETENCY_MIX: Record<CompetencyId, number> = {
  basic: 0.5,
  competent: 0.3,
  proficient: 0.2,
};

/**
 * A diagnostic paper that touches every strand the class has studied.
 * This is the one that answers "where is the class actually?".
 */
export function diagnosticBlueprint(opts: {
  grade: number;
  totalMarks: number;
  title?: string;
  term?: string;
  topicIds?: string[];
}): Blueprint {
  const total = Math.max(5, Math.round(opts.totalMarks));
  // Roughly one question per 2 marks, spread across the chosen topics.
  const questionCount = Math.max(3, Math.round(total / 2));
  const topicIds = opts.topicIds ?? [];

  const topics: Record<string, number> = {};
  if (topicIds.length === 0) {
    // Default: a spread across the four number strands, which carry the most
    // marks in any primary syllabus and where FLN puts most of its weight.
    const defaults = [
      "ns_place_value", "as_2digit", "md_repeated_addition", "fr_concept",
      "ge_2d_shapes", "me_money", "da_bar_graph",
    ].filter((id) => TOPIC_BY_ID.get(id)?.classes.includes(opts.grade));
    const chosen = defaults.length > 0 ? defaults : Object.keys(TOPIC_BY_ID).slice(0, 6);
    distribute(chosen, questionCount, topics);
  } else {
    distribute(topicIds, questionCount, topics);
  }

  return {
    topics,
    competency: { ...DEFAULT_COMPETENCY_MIX },
    types: [],
    totalMarks: total,
    title: opts.title ?? `Diagnostic Test — Class ${opts.grade}`,
    term: opts.term ?? "Term 1",
  };
}

/**
 * A paper aimed at closing measured gaps. Topics the class is weakest at get
 * more of the paper, which is the whole point of generating from data.
 */
export function gapBlueprint(opts: {
  grade: number;
  totalMarks: number;
  /** topicId → mastery 0..1, from the analytics. */
  mastery: Record<string, number>;
  /** How many topics to include. */
  topicCount?: number;
  title?: string;
  term?: string;
}): Blueprint {
  const ranked = Object.entries(opts.mastery)
    .filter(([id]) => TOPIC_BY_ID.get(id)?.classes.includes(opts.grade))
    .sort((a, b) => a[1] - b[1]);

  const n = Math.max(2, opts.topicCount ?? 4);
  const chosen = ranked.slice(0, n).map(([id]) => id);
  const total = Math.max(5, Math.round(opts.totalMarks));
  const questionCount = Math.max(3, Math.round(total / 2));

  const topics: Record<string, number> = {};
  if (chosen.length > 0) {
    distribute(chosen, questionCount, topics);
  } else {
    return diagnosticBlueprint({ grade: opts.grade, totalMarks: total, title: opts.title, term: opts.term });
  }

  return {
    topics,
    // Weak classes need more Basic questions to establish the floor, fewer
    // Proficient ones until the basics are secure.
    competency: { basic: 0.6, competent: 0.3, proficient: 0.1 },
    types: [],
    totalMarks: total,
    title: opts.title ?? `Gap-filling Practice — Class ${opts.grade}`,
    term: opts.term ?? "Term 1",
  };
}

function distribute(items: string[], total: number, into: Record<string, number>): void {
  if (items.length === 0) return;
  const base = Math.floor(total / items.length);
  let left = total - base * items.length;
  items.forEach((id, i) => {
    const extra = left > 0 && i < left % items.length ? 1 : 0;
    if (left > 0 && i < items.length) left -= extra;
    into[id] = base + extra;
  });
  // Remove any zero entries.
  for (const [k, v] of Object.entries(into)) if (v <= 0) delete into[k];
}

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

export type BuildResult = {
  paperId: string;
  questionCount: number;
  totalMarks: number;
  sources: { bank: number; ai: number; builtIn: number };
  shortfalls: { topicId: string; requested: number; filled: number }[];
  warnings: string[];
};

/**
 * Read the competition flags off a generated question.
 *
 * Type-asserted rather than `in`-checked because `GeneratedQuestion` is the
 * bank and AI shape, while `CompetitionQuestion` adds the flags. The assertion
 * is safe here and only here: the sole producer of a flagged question is
 * `toCompetition`, and everything else returns undefined and falls through.
 */
function compFlags(q: GeneratedQuestion): { isCompetition: true; style: string; compTier: number } | null {
  const c = q as Partial<{ isCompetition: true; style: string; compTier: number }>;
  return c.isCompetition === true && typeof c.style === "string" ? { isCompetition: true, style: c.style, compTier: c.compTier ?? 2 } : null;
}

const isCompetitionQuestion = (q: GeneratedQuestion): boolean => compFlags(q) !== null;
const compStyleOf = (q: GeneratedQuestion): string => compFlags(q)?.style ?? "standard";
const compTierOfQuestion = (q: GeneratedQuestion): number => compFlags(q)?.compTier ?? 0;

export type BuildOptions = Blueprint & {
  schoolId: string;
  classId?: string | null;
  grade: number;
  createdBy?: string | null;
  /** Persist generated questions into the bank so they can be reused. */
  saveToBank?: boolean;
  seed?: string;
  /**
   * Ask for competition-style questions derived from the ordinary generators,
   * at this competitive tier (see src/lib/competition.ts).
   *
   * When set, the bank and the AI are skipped for the competition questions and
   * only the transforms are used — the point of a zone paper is that every
   * question is one step past the classroom method, and a bank question that
   * happens to be tagged would quietly dilute that.
   */
  competitionTier?: number;
};

/**
 * Create a paper from a blueprint.
 * Never throws for a partial fill — it reports the shortfall instead, so a
 * teacher gets a shorter paper and a clear message rather than an error page.
 */
export async function buildPaper(opts: BuildOptions): Promise<BuildResult> {
  const seedBase = opts.seed ?? `${opts.schoolId}:${opts.grade}:${JSON.stringify(opts.topics)}`;
  const seed = hashSeed(seedBase);
  const warnings: string[] = [];
  const sources = { bank: 0, ai: 0, builtIn: 0 };
  const shortfalls: BuildResult["shortfalls"] = [];

  const competencyByLevel = expandCompetency(opts.competency);
  const collected: { topicId: string; q: GeneratedQuestion; source: "bank" | "ai" | "builtIn"; questionId?: string }[] = [];

  for (const [topicId, want] of Object.entries(opts.topics)) {
    if (want <= 0) continue;
    const filled: typeof collected = [];

    /* 0. Competition questions, when this paper is a competition paper.
     *
     * Placed before the bank deliberately: a zone paper should be *only*
     * competition questions, and filling the gaps from the bank first would put
     * ordinary questions into it. Only the built-in generators are used, because
     * the transforms recompute their answer from the base stem — an AI-written
     * stem would have no such guarantee.
     */
    if (opts.competitionTier !== undefined && opts.competitionTier > 0) {
      const depth = topicDepth(topicId).tier;
      if (depth >= opts.competitionTier && topicHasGenerator(topicId)) {
        const seeds = generateForTopic(topicId, want * 3, opts.grade, seed + collected.length, opts.grade >= 4);
        const seenStems = new Set<string>();
        for (const base of seeds) {
          if (filled.length >= want) break;
          for (const c of toCompetition(base, topicId, want)) {
            if (filled.length >= want) break;
            if (seenStems.has(c.stem)) continue;
            seenStems.add(c.stem);
            filled.push({ topicId, source: "builtIn", q: { ...c, marks: marksForType(c.type) } });
          }
        }
      }
    }

    // 1. The bank.
    const bank = opts.competitionTier === undefined || opts.competitionTier === 0
      ? await prisma.question.findMany({
          where: {
            archived: false,
            grade: { in: gradeWindow(opts.grade) },
            topicId,
            OR: [{ schoolId: opts.schoolId }, { schoolId: null }],
          },
          orderBy: [{ verified: "desc" }, { usageCount: "asc" }],
          take: want * 2,
        })
      : [];

    for (const bq of bank) {
      if (filled.length >= want) break;
      filled.push({
        topicId,
        source: "bank",
        questionId: bq.id,
        q: {
          stem: bq.stem,
          stemHi: bq.stemHi ?? undefined,
          type: bq.type,
          marks: bq.marks,
          options: parseJson<string[]>(bq.options, []),
          answerKey: bq.answerKey,
          accepted: parseJson<string[]>(bq.accepted, []),
          steps: parseJson<{ steps?: string[] }>(bq.markScheme, {}).steps ?? [],
          explanation: bq.explanation ?? undefined,
          diagnoses: parseJson<string[]>(bq.diagnoses, []),
          optionDiagnosis: parseJson<{ optionDiagnosis?: Record<string, string> }>(bq.markScheme, {}).optionDiagnosis,
          difficulty: bq.difficulty,
        },
      });
    }

    // 2. AI, for whatever the bank could not fill.
    // 2. AI, for whatever the bank could not fill. Skipped for a competition
    //    paper: the transforms guarantee their own answers and an AI-written
    //    stem does not.
    const competitionPaper = (opts.competitionTier ?? 0) > 0;
    if (!competitionPaper && filled.length < want && isAiEnabled()) {
      try {
        const need = want - filled.length;
        const generated = await generateQuestions({
          topicIds: [topicId],
          grade: opts.grade,
          competency: pickCompetency(competencyByLevel, seed + collected.length),
          count: need * 2, // ask for extra, because validation rejects some
          language: "both",
        });
        const valid = new Set([topicId]);
        for (const g of generated) {
          if (filled.length >= want) break;
          const checked = validateGenerated(g, valid, topicId);
          if (!checked) continue;
          filled.push({ topicId, source: "ai", q: { ...checked, marks: marksForType(checked.type) } });
        }
      } catch {
        warnings.push(`Could not generate extra questions for ${topicId} — the AI service did not answer. Using built-in questions instead.`);
      }
    }

    // 3. Built-in generators. Always available, always correct.
    //    Skipped on a competition paper once transforms have had their turn —
    //    filling the remaining slots with ordinary questions would quietly
    //    produce a paper that is mostly not competitive.
    if (filled.length < want && !competitionPaper) {
      const need = want - filled.length;
      const built = topicHasGenerator(topicId)
        ? generateForTopic(topicId, need, opts.grade, seed + collected.length + filled.length, opts.grade >= 4)
        : [];
      filled.push(...built.map((q) => ({ topicId, source: "builtIn" as const, q: { ...q, marks: marksForType(q.type) } })));
    }

    if (filled.length < want) {
      shortfalls.push({ topicId, requested: want, filled: filled.length });
    }
    collected.push(...filled);
  }

  if (collected.length === 0) {
    throw new Error(
      "No questions could be produced for this blueprint. Add questions to the bank, or choose topics that have generators.",
    );
  }

  // 4. Persist, then link.
  const paper = await prisma.paper.create({
    data: {
      schoolId: opts.schoolId,
      classId: opts.classId ?? null,
      createdBy: opts.createdBy ?? null,
      title: opts.title,
      grade: opts.grade,
      term: opts.term,
      unitName: opts.unitName ?? null,
      date: opts.date ?? new Date(),
      source: "GENERATED",
      status: "DRAFT",
      maxMarks: collected.reduce((a, c) => a + c.q.marks, 0),
      blueprint: toJson({ topics: opts.topics, competency: opts.competency, types: opts.types }),
      sourceMeta: toJson({ sources, builtIn: true }),
    },
  });

  let position = 0;
  for (const item of collected) {
    position += 1;
    const meta = TOPIC_BY_ID.get(item.topicId);
    let questionId = item.questionId;

    // AI and built-in questions are saved so they can be reused and edited.
    if (!questionId && (opts.saveToBank !== false) && (item.source === "ai" || item.source === "builtIn")) {
      const created = await prisma.question.create({
        data: {
          schoolId: item.source === "ai" ? opts.schoolId : null,
          authorId: opts.createdBy ?? null,
          grade: opts.grade,
          strand: meta?.strand ?? "number",
          topicId: item.topicId,
          type: item.q.type,
          competency: pickCompetencyName(seed + position),
          marks: item.q.marks,
          stem: item.q.stem,
          stemHi: item.q.stemHi ?? null,
          options: toJson(item.q.options ?? []),
          answerKey: item.q.answerKey,
          accepted: toJson(item.q.accepted ?? []),
          markScheme: toJson({ steps: item.q.steps ?? [], optionDiagnosis: item.q.optionDiagnosis ?? {} }),
          diagnoses: toJson(item.q.diagnoses ?? []),
          explanation: item.q.explanation ?? null,
          explanationHi: item.q.explanationHi ?? null,
          difficulty: item.q.difficulty ?? 2,
          // Carried so a competition question is still identifiable after it has
          // been through the bank and read back out on the mark page.
          isCompetition: isCompetitionQuestion(item.q),
          style: compStyleOf(item.q),
          compTier: compTierOfQuestion(item.q),
          verified: false,
        },
      });
      questionId = created.id;
    }
    await prisma.paperQuestion.create({
      data: {
        paperId: paper.id,
        questionId,
        position,
        topicId: item.topicId,
        strand: meta?.strand ?? "number",
        competency: pickCompetencyName(seed + position),
        type: item.q.type,
        marks: item.q.marks,
        difficulty: item.q.difficulty ?? 2,
        stem: item.q.stem,
        stemHi: item.q.stemHi ?? null,
        options: toJson(item.q.options ?? []),
        answerKey: item.q.answerKey,
        accepted: toJson(item.q.accepted ?? []),
        markScheme: toJson({ steps: item.q.steps ?? [], optionDiagnosis: item.q.optionDiagnosis ?? {} }),
        explanation: item.q.explanation ?? null,
        imageUrl: null,
        isCompetition: isCompetitionQuestion(item.q),
        style: compStyleOf(item.q),
        compTier: compTierOfQuestion(item.q),
      },
    });
    sources[item.source] += 1;
  }

  return {
    paperId: paper.id,
    questionCount: collected.length,
    totalMarks: paper.maxMarks,
    sources,
    shortfalls,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** A Class 4 paper may draw on Class 3 material, but not Class 5. */
function gradeWindow(grade: number): number[] {
  const out = [grade];
  if (grade >= 2) out.push(grade - 1);
  return out;
}

function marksForType(type: string): number {
  return QUESTION_TYPE_BY_ID.get(type)?.marks ?? 1;
}

function expandCompetency(mix: Partial<Record<CompetencyId, number>>): CompetencyId[] {
  const out: CompetencyId[] = [];
  const entries = COMPETENCY_LEVELS.filter((c) => (mix[c.id] ?? 0) > 0);
  if (entries.length === 0) return ["basic", "competent", "proficient"];
  const total = entries.reduce((a, c) => a + (mix[c.id] ?? 0), 0);
  entries.forEach((entry) => {
    const n = Math.max(1, Math.round(((mix[entry.id] ?? 0) / total) * 10));
    for (let i = 0; i < n; i++) out.push(entry.id);
  });
  return out;
}

function pickCompetency(list: CompetencyId[], seed: number): CompetencyId {
  return list[Math.abs(seed) % list.length] ?? "basic";
}

function pickCompetencyName(seed: number): CompetencyId {
  const mix: CompetencyId[] = ["basic", "basic", "basic", "competent", "competent", "proficient"];
  return mix[Math.abs(seed) % mix.length];
}

/** A printable summary of a paper's shape, for the review screen. */
export function describeBlueprint(bp: Blueprint): string[] {
  const lines: string[] = [];
  const entries = Object.entries(bp.topics).sort((a, b) => b[1] - a[1]);
  for (const [topicId, count] of entries) {
    const meta = TOPIC_BY_ID.get(topicId);
    lines.push(`${count} × ${meta?.name ?? topicId}`);
  }
  return lines;
}

export function blueprintFromScores(scores: number[]): string {
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  return gradeBand(avg).label;
}
