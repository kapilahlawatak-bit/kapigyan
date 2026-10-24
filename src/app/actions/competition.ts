"use server";

/**
 * Correcting the competitive-depth map, for one school.
 *
 * The bundled tier assignment is an interpretation, and which tier a topic
 * reaches varies by board, school and year. So it has to be correctable. What it
 * must *not* be is correctable into everyone else's answer, which is why this
 * writes a `TopicDepthOverride` row rather than touching `Topic.compTier`.
 *
 * Permission is ADMIN-only, deliberately. Any teacher may be wrong about a tier,
 * but a wrong depth map changes what the whole school's planning page says, and
 * a teacher's guess silently becoming school policy is harder to notice — and
 * harder to undo — than a colleague's.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/audit";
import { TOPIC_BY_ID } from "@/lib/curriculum";
import { COMP_TIERS } from "@/lib/competition";

const schema = z.object({
  topicId: z.string().trim().min(1),
  tier: z.coerce.number().int().min(0).max(3),
  idea: z.string().trim().max(400),
  note: z.string().trim().max(200).optional(),
});

/**
 * The shape of a shared depth map.
 *
 * `.strict()` on the envelope so a file from a different format fails loudly
 * rather than being read as "a map with no corrections in it". The correction
 * rows keep `bundledTier`/`bundledIdea` because the file is meant to show what
 * the sender changed, even though this side does not act on them.
 */
const depthMapFile = z
  .object({
    format: z.literal("kapigyan-depth-map"),
    version: z.literal(1),
    exportedAt: z.string(),
    school: z.object({ name: z.string(), code: z.string() }),
    corrections: z
      .array(
        z.object({
          topicId: z.string().min(1),
          topicName: z.string().default(""),
          tier: z.number().int().min(0).max(3),
          idea: z.string().nullable().default(null),
          note: z.string().nullable().default(null),
          bundledTier: z.number().int().min(0).max(3).default(0),
          bundledIdea: z.string().nullable().default(null),
          bundledChanged: z.boolean().default(false),
        }),
      )
      .max(5000),
    manifest: z.array(z.string()).default([]),
  })
  .strict();

export type DepthState = { error?: string; saved?: boolean } | null;

export async function saveTopicDepth(_prev: DepthState, formData: FormData): Promise<DepthState> {
  const session = await requireRole("ADMIN");
  if (!session.schoolId) return { error: "This account has no school" };

  const parsed = schema.safeParse({
    topicId: formData.get("topicId"),
    tier: formData.get("tier"),
    idea: formData.get("idea") ?? "",
    note: formData.get("note") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the values" };
  }

  const { topicId, tier, note } = parsed.data;
  const topic = TOPIC_BY_ID.get(topicId);
  if (!topic) return { error: "Unknown topic" };

  // A tier of 0 means the topic is not taken further, so there is no extra step
  // to state. Allowing one would put a claim on the page that the tier itself
  // contradicts — which the tier-0 assertion in `verify` exists to catch.
  const idea = tier === 0 ? null : parsed.data.idea.trim() || null;
  if (tier > 0 && !idea) {
    return { error: "Say what the extra step is, or set the level to School" };
  }

  const before = await prisma.topicDepthOverride.findUnique({
    where: { schoolId_topicId: { schoolId: session.schoolId, topicId } },
    select: { tier: true, idea: true },
  });

  await prisma.topicDepthOverride.upsert({
    where: { schoolId_topicId: { schoolId: session.schoolId, topicId } },
    create: { schoolId: session.schoolId, topicId, tier, idea, note: note ?? null, updatedBy: session.userId },
    update: { tier, idea, note: note ?? null, updatedBy: session.userId },
  });

  await recordAudit({
    schoolId: session.schoolId,
    actorId: session.userId,
    actorName: session.name,
    action: "topic_depth_corrected",
    after: { topicId, tier, idea },
    before: before ?? undefined,
    detail:
      `Competitive level for "${topic.name}" set to ${COMP_TIERS[tier]?.label ?? `tier ${tier}`}` +
      (note ? ` — ${note}` : "."),
  });

  revalidatePath("/curriculum");
  revalidatePath("/home/curriculum");
  return { saved: true };
}

/**
 * Apply another school's map to this school.
 *
 * Importing is deliberately **additive and opt-out** rather than a replace. The
 * obvious alternative — delete everything this school had, then load the file —
 * would mean one hand-picked JSON destroys months of argued-over corrections on
 * a school that already has a map, and the person holding the file has no way to
 * know that. So a row in the file is applied on top, and a school that disagrees
 * resets that one topic by hand afterwards, which it can already do.
 *
 * Unknown topics are reported rather than dropped, so a file from a newer or
 * different build cannot quietly apply "successfully" while skipping the rows
 * that would have mattered.
 */
export async function importDepthMap(_prev: DepthState, formData: FormData): Promise<DepthState> {
  const session = await requireRole("ADMIN");
  if (!session.schoolId) return { error: "This account has no school" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a map file first" };
  if (file.size > 2_000_000) return { error: "That file is larger than a depth map should be" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { error: "That file is not readable as JSON" };
  }

  const doc = depthMapFile.safeParse(parsed);
  if (!doc.success) return { error: "That file is not a Kapigyan depth map" };
  if (doc.data.version !== 1) {
    return { error: `This file is version ${doc.data.version}; this app reads version 1` };
  }

  const unknown: string[] = [];
  const valid = doc.data.corrections.filter((row) => {
    if (TOPIC_BY_ID.has(row.topicId)) return true;
    unknown.push(row.topicId);
    return false;
  });

  if (valid.length === 0) {
    return {
      error:
        unknown.length > 0
          ? `None of these topics exist in this build (e.g. ${unknown.slice(0, 3).join(", ")})`
          : "That file has no corrections to apply",
    };
  }

  for (const row of valid) {
    await prisma.topicDepthOverride.upsert({
      where: { schoolId_topicId: { schoolId: session.schoolId, topicId: row.topicId } },
      create: {
        schoolId: session.schoolId,
        topicId: row.topicId,
        tier: row.tier,
        // Tier 0 means "not taken further", so an idea would contradict the tier.
        idea: row.tier === 0 ? null : row.idea,
        note: row.note ? `${row.note} (from ${doc.data.school.name})` : `From ${doc.data.school.name}`,
        updatedBy: session.userId,
      },
      update: {
        tier: row.tier,
        idea: row.tier === 0 ? null : row.idea,
        note: row.note ? `${row.note} (from ${doc.data.school.name})` : `From ${doc.data.school.name}`,
        updatedBy: session.userId,
      },
    });
  }

  await recordAudit({
    schoolId: session.schoolId,
    actorId: session.userId,
    actorName: session.name,
    action: "topic_depth_corrected",
    after: { from: doc.data.school.name, applied: valid.length, unknown: unknown.length },
    detail:
      `Applied ${valid.length} competitive-level correction(s) from ${doc.data.school.name}'s map` +
      (unknown.length > 0 ? `; ${unknown.length} topic(s) were not in this build and were skipped` : "") +
      ".",
  });

  revalidatePath("/curriculum");
  revalidatePath("/home/curriculum");

  return {
    saved: true,
    error:
      unknown.length > 0
        ? `Applied ${valid.length} of ${valid.length + unknown.length}. Not in this build: ${unknown.slice(0, 3).join(", ")}${unknown.length > 3 ? "…" : ""}.`
        : `Applied ${valid.length} correction${valid.length === 1 ? "" : "s"} from ${doc.data.school.name}.`,
  };
}
export async function resetTopicDepth(formData: FormData): Promise<void> {
  const session = await requireRole("ADMIN");
  if (!session.schoolId) return;

  const topicId = String(formData.get("topicId") ?? "");
  const topic = TOPIC_BY_ID.get(topicId);
  if (!topic) return;

  await prisma.topicDepthOverride.deleteMany({ where: { schoolId: session.schoolId, topicId } });

  await recordAudit({
    schoolId: session.schoolId,
    actorId: session.userId,
    actorName: session.name,
    action: "topic_depth_corrected",
    before: { topicId },
    detail: `Competitive level for "${topic.name}" reset to this build's bundled answer.`,
  });

  revalidatePath("/curriculum");
  revalidatePath("/home/curriculum");
}
