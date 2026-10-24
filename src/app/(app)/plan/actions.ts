"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { TOPIC_BY_ID } from "@/lib/curriculum";

/**
 * Recording what was actually taught.
 *
 * Deliberately one action that toggles rather than a form per session. A
 * teacher marking off a term's worth of sessions is a five-second job and must
 * stay one; anything heavier and they will simply not do it, and the whole
 * learning-gain feature depends on these rows existing.
 */
export async function toggleTaught(formData: FormData): Promise<void> {
  const session = await requireTeacher();
  const classId = String(formData.get("classId") ?? "");
  const topicId = String(formData.get("topicId") ?? "");
  const taughtAt = String(formData.get("taughtAt") ?? "");

  // Bad input here means the page is out of date or tampered with. Swallowing
  // it would leave the teacher thinking a tick was saved when it was not, so
  // let it fail loudly instead.
  if (!classId || !topicId || !TOPIC_BY_ID.has(topicId)) {
    throw new Error("Unknown session.");
  }
  await assertClassAccess(session, classId);

  const when = taughtAt ? new Date(taughtAt) : new Date();
  if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 86_400_000) {
    throw new Error("That date is not a real day.");
  }

  // Midnight UTC, so a topic taught once a day is one row, not several.
  const day = new Date(when);
  day.setUTCHours(0, 0, 0, 0);

  const existing = await prisma.taughtSession.findUnique({
    where: { classId_topicId_taughtAt: { classId, topicId, taughtAt: day } },
    select: { id: true },
  });

  if (existing) {
    await prisma.taughtSession.delete({ where: { id: existing.id } });
  } else {
    await prisma.taughtSession.create({ data: { classId, topicId, taughtAt: day } });
  }

  revalidatePath("/plan");
  revalidatePath("/gain");
}
