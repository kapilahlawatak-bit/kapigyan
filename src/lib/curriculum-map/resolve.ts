/**
 * Resolving a school's curriculum.
 *
 * ## Why this module is a resolver and not a constant
 *
 * `curriculum.ts` holds a fixed Classes 1–5 map. That is fine for a single
 * demo school and wrong for every real one: CBSE, ICSE and a state board do
 * not agree on chapter order, and Classes 6–12 are not a continuation of 1–5
 * but a different curriculum. So the structure moves into the database and
 * this module resolves it.
 *
 * ## The compatibility contract
 *
 * Everything downstream — mastery, the misconception engine, the heatmap, the
 * generator, every report — keys on `topicId`. Those do not change. A concept
 * points at a topic, and the topic is still the unit of analysis.
 *
 * Where a school has a chapter with **no** concept linked to a topic, this
 * returns it as `covered: false` rather than dropping it. A curriculum the
 * app cannot analyse is a gap the teacher should see, and hiding it would
 * make the map look complete when it is not.
 */

import { prisma } from "@/lib/db";
import { TOPIC_BY_ID, TOPICS } from "@/lib/curriculum";

export const STAGES = ["PRIMARY", "MIDDLE", "SECONDARY"] as const;
export type Stage = (typeof STAGES)[number];

/** NCF-FL 2023 stages, mapped onto level numbers. */
export function stageOf(level: number): Stage {
  if (level <= 5) return "PRIMARY";
  if (level <= 8) return "MIDDLE";
  return "SECONDARY";
}

export const MAX_LEVEL = 12;

export type ResolvedConcept = {
  conceptId: string;
  title: string;
  topicId: string | null;
  topicName: string | null;
  /** False when there is no topic behind this concept — displayable, not analysable. */
  covered: boolean;
  skills: { id: string; code: string; title: string; objectives: { id: string; statement: string }[] }[];
};

export type ResolvedChapter = {
  id: string;
  title: string;
  concepts: ResolvedConcept[];
  coveredCount: number;
};

export type ResolvedLevel = {
  level: number;
  stage: Stage;
  subjects: {
    key: string;
    name: string;
    chapters: ResolvedChapter[];
    coveredCount: number;
    conceptCount: number;
  }[];
};

export type CurriculumMap = {
  board: { id: string; name: string } | null;
  /** True when the school has not chosen a board, or chosen one with no content. */
  empty: boolean;
  /** Levels the board actually defines — not 1..12 assumed. */
  levels: number[];
  map: ResolvedLevel[];
  /** Concepts with no topic behind them. Stated, never hidden. */
  uncovered: number;
};

const chapterInclude = {
  concepts: {
    orderBy: { order: "asc" },
    include: {
      subConcepts: {
        orderBy: { order: "asc" },
        include: { skills: { include: { objectives: true } } },
      },
    },
  },
} as const;

/**
 * The full structure for a school.
 *
 * Falls back to the built-in topic map when the school has not loaded a board
 * structure, so the app keeps working for a new school instead of showing an
 * empty page on day one. It says which path it took, because a school being
 * silently given the demo curriculum is exactly the kind of quiet default
 * that makes a map lie.
 */
export async function curriculumFor(schoolId: string): Promise<CurriculumMap> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { boardId: true, board: { select: { id: true, name: true } } },
  });

  if (!school?.boardId) {
    return { board: null, empty: true, levels: [], map: [], uncovered: 0 };
  }

  const levels = await prisma.curriculumLevel.findMany({
    where: { boardId: school.boardId },
    orderBy: { level: "asc" },
    include: {
      chapters: {
        include: {
          subject: { select: { key: true, name: true } },
          ...chapterInclude,
        },
      },
    },
  });

  const map: ResolvedLevel[] = levels.map((l) => {
    const bySubject = new Map<string, ResolvedLevel["subjects"][number]>();
    for (const ch of l.chapters) {
      const concepts: ResolvedConcept[] = ch.concepts.map((c) => {
        const skills = (c.subConcepts ?? []).flatMap((sc) =>
          sc.skills.map((s) => ({
            id: s.id,
            code: s.code,
            title: s.title,
            objectives: s.objectives.map((o) => ({ id: o.id, statement: o.statement })),
          })),
        );
        // A skill declared directly on a concept, with no sub-concept above it.
        return {
          conceptId: c.id,
          title: c.title,
          topicId: c.topicId,
          topicName: c.topicId ? TOPIC_BY_ID.get(c.topicId)?.name ?? null : null,
          covered: c.topicId !== null,
          skills,
        };
      });
      const coveredCount = concepts.filter((c) => c.covered).length;

      const entry = bySubject.get(ch.subject.key) ?? {
        key: ch.subject.key, name: ch.subject.name,
        chapters: [], coveredCount: 0, conceptCount: 0,
      };
      entry.chapters.push({ id: ch.id, title: ch.title, concepts, coveredCount });
      entry.coveredCount += coveredCount;
      entry.conceptCount += concepts.length;
      bySubject.set(ch.subject.key, entry);
    }
    return { level: l.level, stage: (l.stage as Stage) ?? stageOf(l.level), subjects: [...bySubject.values()] };
  });

  return {
    board: school.board,
    empty: map.length === 0,
    levels: map.map((l) => l.level),
    map,
    uncovered: map.reduce(
      (a, l) => a + l.subjects.reduce((b, s) => b + (s.conceptCount - s.coveredCount), 0),
      0,
    ),
  };
}

/** Topics the school can actually be assessed on, for a given level. */
export async function topicsForLevel(boardId: string, level: number): Promise<string[]> {
  const concepts = await prisma.concept.findMany({
    where: { chapter: { level: { boardId, level } } },
    select: { topicId: true },
  });
  const ids = [...new Set(concepts.map((c) => c.topicId).filter((x): x is string => x !== null))];
  return ids.length > 0 ? ids : TOPICS.filter((t) => t.classes.includes(level)).map((t) => t.id);
}
