"use server";

import { revalidatePath } from "next/cache";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import type { Confidence } from "@/lib/intelligence/reflection";

export type ReflectionInput = {
  classId: string;
  topicId: string;
  topicName: string;
  predicted: Confidence;
  outcome: string;
  calibration: string | null;
  note?: string | null;
};

/**
 * Store one reflection.
 *
 * This is **not** a mark and is not graded. It is written to its own table
 * rather than onto a Submission precisely so that it cannot drift into the
 * mastery calculation later — a child believing they are good at subtraction
 * is not evidence that they can do it, and treating it as such would let a
 * confident guess outrank a demonstrated result.
 */
export async function recordReflection(input: ReflectionInput): Promise<void> {
  const session = await requireTeacher();
  await assertClassAccess(session, input.classId);

  const PREDICTED: Confidence[] = ["not_yet", "getting_there", "got_it"];
  const OUTCOMES = ["got_it", "nearly", "not_yet", "skipped"];
  if (!PREDICTED.includes(input.predicted)) throw new Error("Unknown confidence");
  if (!OUTCOMES.includes(input.outcome)) throw new Error("Unknown outcome");

  // A skipped item has no calibration verdict. Storing one would be a guess
  // about a child who told us nothing.
  const calibration = input.outcome === "skipped" ? null : input.calibration;

  await prisma.reflection.create({
    data: {
      classId: input.classId,
      topicId: input.topicId,
      topicName: input.topicName,
      predicted: input.predicted,
      outcome: input.outcome,
      calibration,
      note: input.note ?? null,
    },
  });

  revalidatePath(`/classes/${input.classId}/reflect/set`);
}
