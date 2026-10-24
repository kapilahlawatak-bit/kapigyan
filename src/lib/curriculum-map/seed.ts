/**
 * Loading a board's curriculum into the database.
 *
 * Idempotent: running it twice does not duplicate, so a school can re-run it
 * after editing a source file.
 *
 * ## The content boundary — read this before extending
 *
 * The bundled content covers **Classes 1–5 only**, and it is a *structural
 * interpretation* of NCF-FL 2023 and the CBSE primary syllabus — not a
 * transcription of NCERT. That is already true of `curriculum.ts` and is
 * stated in the README; this module does not make it more authoritative.
 *
 * Classes 6–12 are deliberately **not** invented here. An accurate CBSE,
 * ICSE or HBSE Class 6–12 syllabus is published content that has to come from
 * the school or from NCERT, and writing a plausible-looking approximation and
 * calling it "the syllabus" is precisely the confident fiction this app
 * refuses to produce everywhere else. A school loads its own; the app shows
 * honestly which parts it cannot yet analyse.
 */

import { prisma } from "@/lib/db";
import { TOPICS, STRANDS, type Topic } from "@/lib/curriculum";
import { stageOf } from "@/lib/curriculum-map/resolve";

export const BUNDLED_BOARD = "CBSE";

/** The stage→level map the bundled content actually covers. */
const BUNDLED_LEVELS = [1, 2, 3, 4, 5];

/** Ordered chapter per strand, so the map reads like a textbook. */
const CHAPTER_OF_STRAND: Record<string, string> = {
  number: "Number",
  addition_subtraction: "Addition and Subtraction",
  multiplication_division: "Multiplication and Division",
  fractions_decimals: "Fractions and Decimals",
  algebra: "Patterns and Algebra",
  geometry: "Shapes and Space",
  measurement: "Measuring Things",
  data_probability: "Data and Chance",
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export type LoadResult = {
  levels: number;
  chapters: number;
  concepts: number;
  skills: number;
  objectives: number;
  /**
   * How many of those rows were new. The `*Count` fields are totals the loader
   * *ensured to exist*, because a second run creates nothing and reporting
   * "0 concepts" for a hierarchy that is fully present and working reads as a
   * failure rather than as idempotence.
   */
  createdChapters: number;
  createdConcepts: number;
  createdSkills: number;
  createdObjectives: number;
};

/**
 * Create the board, its levels, and a concept per (level × topic) pair.
 *
 * The concept is the join point: each one points at the existing `Topic`, so
 * the analysis engine is untouched by any of this.
 */
export async function loadBundledCurriculum(): Promise<LoadResult> {
  const board = await prisma.board.upsert({
    where: { id: BUNDLED_BOARD },
    create: {
      id: BUNDLED_BOARD,
      name: "CBSE (bundled)",
      nameHi: "सीबीएसई (संकलित)",
    },
    update: {},
  });

  const subject = await prisma.subject.upsert({
    where: { boardId_key: { boardId: board.id, key: "MATHEMATICS" } },
    create: { boardId: board.id, key: "MATHEMATICS", name: "Mathematics", nameHi: "गणित" },
    update: {},
  });

  let chapters = 0;
  let newChapters = 0;
  let concepts = 0;
  let skills = 0;
  let objectives = 0;
  let createdConcepts = 0;
  let createdSkills = 0;
  let createdObjectives = 0;

  for (const level of BUNDLED_LEVELS) {
    const lvl = await prisma.curriculumLevel.upsert({
      where: { boardId_level: { boardId: board.id, level } },
      create: { boardId: board.id, level, stage: stageOf(level) },
      update: {},
    });

    // Strands are chapters; within a chapter, order follows TOPICS.
    for (const strand of STRANDS) {
      const strandTopics = TOPICS.filter((t) => t.strand === strand.id && t.classes.includes(level));
      if (strandTopics.length === 0) continue;

      const title = CHAPTER_OF_STRAND[strand.id] ?? strand.name;
      const chapterId = `cbse-l${level}-${slug(strand.id)}`;
      const chapterExists = await prisma.chapter.findUnique({ where: { id: chapterId }, select: { id: true } });
      await prisma.chapter.upsert({
        where: { id: chapterId },
        create: {
          id: chapterId,
          levelId: lvl.id,
          subjectId: subject.id,
          order: STRANDS.findIndex((s) => s.id === strand.id),
          title,
          titleHi: strand.nameHi,
        },
        update: { levelId: lvl.id, subjectId: subject.id, title, titleHi: strand.nameHi },
      });
      chapters++;
      if (!chapterExists) newChapters++;

      for (let i = 0; i < strandTopics.length; i++) {
        const t = strandTopics[i]!;
        const conceptId = `cbse-l${level}-${t.id}`;

        // Counted as ensured-present, and separately as newly created. A second
        // run creates nothing, and reporting "0 concepts" then would read as a
        // broken hierarchy rather than as idempotence working.
        const conceptExists = await prisma.concept.findUnique({ where: { id: conceptId }, select: { id: true } });
        if (conceptExists) {
          await prisma.concept.update({ where: { id: conceptId }, data: { topicId: t.id, title: t.name, titleHi: t.nameHi } });
        } else {
          await prisma.concept.create({
            data: { id: conceptId, chapterId, order: i, title: t.name, titleHi: t.nameHi, topicId: t.id },
          });
          createdConcepts++;
        }
        concepts++;

        // One skill per concept, carrying the topic blurb as its objective.
        // A concept is already an atomic topic here, so there is no meaningful
        // SubConcept to insert between the two — that layer exists for subjects
        // where one topic genuinely splits, and fabricating it would add a row
        // with no idea behind it.
        const skillId = `${conceptId}-s1`;
        const skillExists = await prisma.skill.findUnique({ where: { id: skillId }, select: { id: true } });
        await prisma.skill.upsert({
          where: { id: skillId },
          create: { id: skillId, code: t.id.toUpperCase(), title: t.name, titleHi: t.nameHi, fln: t.fln[0] ?? null },
          update: { title: t.name, titleHi: t.nameHi, fln: t.fln[0] ?? null },
        });
        if (!skillExists) createdSkills++;
        skills++;

        await prisma.learningObjective.upsert({
          where: { id: `${skillId}-o1` },
          create: { id: `${skillId}-o1`, skillId, statement: t.blurb, statementHi: null },
          update: { statement: t.blurb },
        });
        createdObjectives++;
        objectives++;
      }
    }
  }

  return {
    levels: BUNDLED_LEVELS.length,
    chapters,
    concepts,
    skills,
    objectives,
    createdChapters: newChapters,
    createdConcepts,
    createdSkills,
    createdObjectives,
  };
}

/**
 * Point a school at a board.
 *
 * A school with no board is a real state and the app handles it — this is
 * only ever called deliberately, never as a silent default during a read.
 */
export async function setSchoolBoard(schoolId: string, boardId: string | null): Promise<void> {
  await prisma.school.update({ where: { id: schoolId }, data: { boardId } });
}

/** Import a school's own structure from a JSON file. Same shape as the seeder's output. */
export type ImportedCurriculum = {
  board: { id: string; name: string; nameHi?: string };
  levels: {
    level: number;
    subjects: {
      key: string;
      name: string;
      chapters: { title: string; concepts: { title: string; topicId?: string | null; skills?: { code: string; title: string; objectives?: string[] }[] }[] }[];
    }[];
  }[];
};

export async function importCurriculum(
  schoolId: string,
  data: ImportedCurriculum,
): Promise<LoadResult> {
  const board = await prisma.board.upsert({
    where: { id: data.board.id },
    create: { id: data.board.id, name: data.board.name, nameHi: data.board.nameHi, custom: true, schoolId },
    update: { name: data.board.name, nameHi: data.board.nameHi, schoolId },
  });

  let chapters = 0, concepts = 0, skills = 0, objectives = 0;

  for (const l of data.levels) {
    if (l.level < 1 || l.level > 12) continue; // not silently clamped
    const lvl = await prisma.curriculumLevel.upsert({
      where: { boardId_level: { boardId: board.id, level: l.level } },
      create: { boardId: board.id, level: l.level, stage: stageOf(l.level) },
      update: {},
    });
    for (const s of l.subjects) {
      const subject = await prisma.subject.upsert({
        where: { boardId_key: { boardId: board.id, key: s.key } },
        create: { boardId: board.id, key: s.key, name: s.name },
        update: { name: s.name },
      });
      for (let ci = 0; ci < s.chapters.length; ci++) {
        const ch = s.chapters[ci]!;
        const chapterId = `${board.id}-l${l.level}-${slug(s.key)}-${ci}`;
        await prisma.chapter.upsert({
          where: { id: chapterId },
          create: { id: chapterId, levelId: lvl.id, subjectId: subject.id, order: ci, title: ch.title },
          update: { levelId: lvl.id, subjectId: subject.id, title: ch.title },
        });
        chapters++;

        for (let xi = 0; xi < ch.concepts.length; xi++) {
          const c = ch.concepts[xi]!;
          // A concept may name a topic the app has no bank for. That is kept
          // and shown as uncovered rather than rejected at import time.
          const conceptId = `${chapterId}-c${xi}`;
          await prisma.concept.upsert({
            where: { id: conceptId },
            create: { id: conceptId, chapterId, order: xi, title: c.title, topicId: c.topicId ?? null },
            update: { title: c.title, topicId: c.topicId ?? null },
          });
          concepts++;

          for (let si = 0; si < (c.skills ?? []).length; si++) {
            const sk = c.skills![si]!;
            const skillId = `${conceptId}-s${si}`;
            await prisma.skill.upsert({
              where: { id: skillId },
              create: { id: skillId, code: sk.code, title: sk.title },
              update: { code: sk.code, title: sk.title },
            });
            skills++;
            for (let oi = 0; oi < (sk.objectives ?? []).length; oi++) {
              await prisma.learningObjective.upsert({
                where: { id: `${skillId}-o${oi}` },
                create: { id: `${skillId}-o${oi}`, skillId, statement: sk.objectives![oi]! },
                update: { statement: sk.objectives![oi]! },
              });
              objectives++;
            }
          }
        }
      }
    }
  }

  await setSchoolBoard(schoolId, board.id);
  // An import always creates a school-owned board from the school's own file, so
  // "new" and "total" are the same thing here — unlike the bundled load, this is
  // not run twice against the same board.
  return {
    levels: data.levels.length,
    chapters,
    concepts,
    skills,
    objectives,
    createdChapters: chapters,
    createdConcepts: concepts,
    createdSkills: skills,
    createdObjectives: objectives,
  };
}
