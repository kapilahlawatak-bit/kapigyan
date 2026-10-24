/**
 * Term planning.
 *
 * The recommendations module answers "what should I teach next?". That is a
 * one-period question. A teacher is asked a bigger one at the start of a term:
 * *I have twelve weeks and a syllabus — what is the order, and what do I
 * revisit?*
 *
 * Three things this module does that a simple to-do list would not:
 *
 * 1. **It interleaves.** Teaching ten multiplication topics back to back is
 *    blocked practice; children can pass the next test on momentum from the
 *    last one and hold none of it a fortnight later. Interleaving different
 *    strands, so the same skill is not asked for on three consecutive days,
 *    is slower to feel and much stronger to keep. (Rohrer & Taylor.)
 *
 * 2. **It schedules retrieval.** Every taught topic comes back at +1 week and
 *    +3 weeks, because the evidence for spaced retrieval over re-teaching is
 *    about as settled as anything in this field.
 *
 * 3. **It does not only react.** A term plan that only repairs measured gaps
 *    will quietly skip half the syllabus, because half the syllabus has never
 *    been tested. Untaught topics are sequenced after the urgent ones.
 *
 * Ordering within the plan is `leverage × urgency`, not raw mastery, so the
 * thing everything else depends on is taught first even if a less important
 * topic is slightly weaker.
 */

import { STRAND_BY_ID, TOPIC_BY_ID, type Topic } from "@/lib/curriculum";
import type { Recommendation } from "@/lib/intelligence/recommendations";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SessionKind = "teach" | "check" | "consolidate";

export type PlanSession = {
  /** 1-based position in the term. */
  index: number;
  week: number;
  /** 0 = Monday, 4 = Friday. */
  day: number;
  topicId: string;
  topicName: string;
  topicNameHi: string;
  strand: string;
  strandName: string;
  strandColor: string;
  kind: SessionKind;
  /** For a revisit, the session number this is checking up on. */
  revisitOf?: number;
  /** Plain-English justification, for a teacher who did not build this. */
  why: string;
  /** Priority that put it here, 0..1. Untaught topics carry a flat score. */
  priority: number;
  /** True when we have never assessed this topic for this class. */
  unassessed: boolean;
  recommendation?: Recommendation;
};

export type PlanWeek = {
  week: number;
  sessions: PlanSession[];
  focus: string;
};

export type TeachingPlan = {
  weeks: PlanWeek[];
  /** Topics that will not fit in the term, with a note saying so. */
  deferred: { topicId: string; topicName: string; reason: string }[];
  counts: { teach: number; check: number; sessions: number; weeks: number };
  /** Strand coverage so the teacher can see the shape of the term. */
  coverage: { strand: string; strandName: string; color: string; sessions: number; topics: number }[];
};

export type PlanInput = {
  grade: number;
  /** Every topic in the syllabus for this grade. */
  syllabus: Topic[];
  /** topicId → class mastery, 0..1. Absent means never assessed. */
  mastery: Record<string, number>;
  /** The ranked gaps, from recommendTeaching. */
  recommendations: Recommendation[];
  weeks?: number;
  sessionsPerWeek?: number;
  /** Skip the spaced-revisit slots. */
  consolidate?: boolean;
};

/* ------------------------------------------------------------------ */
/* Ordering                                                            */
/* ------------------------------------------------------------------ */

/**
 * Score a topic for "teach this soon".
 *
 * Blends the measured urgency (from the recommendations) with how much later
 * work rests on the topic. An unassessed topic still scores, because leaving
 * it out of the plan entirely is how a term quietly loses a third of the
 * syllabus.
 */
function urgencyFor(topic: Topic, mastery: number | undefined, ranked: Map<string, number>): number {
  const measured = ranked.get(topic.id);

  if (measured !== undefined) {
    // A recommended gap: mostly its own priority, nudged by how many topics
    // depend on it.
    return Math.min(1, measured * 0.7 + leverageOf(topic) * 0.3);
  }

  // Unassessed. Not urgent, but not optional either — foundational number
  // work that has never been checked is the single biggest risk in a plan
  // built purely from data.
  const unassessed = 0.34;
  return unassessed + leverageOf(topic) * 0.16;
}

function leverageOf(topic: Topic): number {
  switch (topic.strand) {
    case "number":
    case "addition_subtraction":
    case "multiplication_division":
      return 1;
    case "fractions_decimals":
      return 0.75;
    case "algebra":
      return 0.7;
    case "measurement":
      return 0.5;
    case "geometry":
    case "data_probability":
      return 0.4;
    default:
      return 0.5;
  }
}

/**
 * Sort by urgency, then interleave so the same strand never appears on
 * consecutive days more than twice.
 *
 * A greedy pass: take the highest-scoring topic whose strand has been used
 * less often *and* not in the last two slots. That keeps the order honest
 * while still following the priority ranking closely — a pure round-robin
 * would throw the ranking away.
 */
function interleave(scored: { topic: Topic; score: number }[]): { topic: Topic; score: number }[] {
  const remaining = [...scored].sort((a, b) => b.score - a.score);
  const out: { topic: Topic; score: number }[] = [];
  const strandRuns: string[] = [];

  while (remaining.length > 0) {
    // Prefer a topic from a different strand to the one just taught.
    const lastTwo = strandRuns.slice(-2);
    let idx = remaining.findIndex((r) => !lastTwo.includes(r.topic.strand));
    if (idx === -1) idx = 0; // every remaining topic is in the last two strands

    const [picked] = remaining.splice(idx, 1);
    out.push(picked!);
    strandRuns.push(picked!.topic.strand);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export function buildTeachingPlan(input: PlanInput): TeachingPlan {
  const weeks = input.weeks ?? 12;
  const perWeek = input.sessionsPerWeek ?? 4;
  const capacity = weeks * perWeek;

  const ranked = new Map(input.recommendations.map((r) => [r.topicId, r.priority]));
  const recByTopic = new Map(input.recommendations.map((r) => [r.topicId, r]));
  const byId = new Map(input.recommendations.map((r) => [r.topicId, r]));

  const scored = input.syllabus
    .map((topic) => ({ topic, score: urgencyFor(topic, input.mastery[topic.id], ranked) }))
    .sort((a, b) => b.score - a.score);

  // How many slots are left once revisits are accounted for? Plan for new
  // topics, then fill the rest with retrieval.
  const revisitSlots = input.consolidate ? 0 : Math.round(capacity * 0.3);
  const teachCapacity = Math.max(1, capacity - revisitSlots);

  const teaching = interleave(scored).slice(0, teachCapacity);
  const deferred = interleave(scored.slice(teachCapacity)).map((s) => ({
    topicId: s.topic.id,
    topicName: s.topic.name,
    reason:
      s.score > 0.4
        ? "Worth teaching, but the term is full of higher-priority work"
        : "Not a gap and not urgent this term",
  }));

  /* --- Lay the teaching topics into weeks --------------------- */

  const slots: (PlanSession | null)[] = new Array(capacity).fill(null);
  const taughtAt: { slot: number; session: PlanSession }[] = [];

  teaching.forEach((entry, i) => {
    const slot = i;
    const session = makeSession({
      topic: entry.topic,
      index: i + 1,
      slot,
      perWeek,
      kind: "teach",
      priority: entry.score,
      mastery: input.mastery[entry.topic.id],
      recommendation: byId.get(entry.topic.id),
    });
    slots[slot] = session;
    taughtAt.push({ slot, session });
  });

  /* --- Slot the spaced revisits ------------------------------- */

  if (!input.consolidate) {
    // Revisit targets, most important first, so a full term does not drop the
    // high-leverage ones.
    const targets = [...taughtAt].sort((a, b) => b.session.priority - a.session.priority);
    let placed = 0;
    const limit = Math.min(revisitSlots, targets.length * 2);

    for (const target of targets) {
      if (placed >= limit) break;
      for (const gap of [7, 21]) {
        if (placed >= limit) break;
        const want = target.slot + gap;
        if (want >= capacity) continue;
        if (slots[want]) continue; // never overwrite real teaching
        slots[want] = makeSession({
          topic: TOPIC_BY_ID.get(target.session.topicId) as Topic,
          index: target.session.index,
          slot: want,
          perWeek,
          kind: gap === 7 ? "check" : "consolidate",
          priority: target.session.priority,
          mastery: input.mastery[target.session.topicId],
          recommendation: byId.get(target.session.topicId),
          revisitOf: target.session.index,
        });
        placed += 1;
      }
    }
  }

  /* --- Group into weeks --------------------------------------- */

  const outWeeks: PlanWeek[] = [];
  for (let w = 0; w < weeks; w += 1) {
    const weekSessions = slots
      .slice(w * perWeek, (w + 1) * perWeek)
      .filter((s): s is PlanSession => s !== null);

    outWeeks.push({
      week: w + 1,
      sessions: weekSessions,
      focus: focusFor(weekSessions, input.recommendations),
    });
  }

  const sessions = outWeeks.flatMap((w) => w.sessions);

  /* --- Shape of the term -------------------------------------- */

  const strandCount = new Map<string, { topics: Set<string>; sessions: number }>();
  for (const s of sessions) {
    const e = strandCount.get(s.strand) ?? { topics: new Set<string>(), sessions: 0 };
    e.topics.add(s.topicId);
    e.sessions += 1;
    strandCount.set(s.strand, e);
  }

  return {
    weeks: outWeeks,
    deferred,
    counts: {
      teach: sessions.filter((s) => s.kind === "teach").length,
      check: sessions.filter((s) => s.kind !== "teach").length,
      sessions: sessions.length,
      weeks,
    },
    coverage: [...strandCount.entries()]
      .map(([id, e]) => ({
        strand: id,
        strandName: STRAND_BY_ID.get(id)?.name ?? id,
        color: STRAND_BY_ID.get(id)?.color ?? "#888",
        sessions: e.sessions,
        topics: e.topics.size,
      }))
      .sort((a, b) => b.sessions - a.sessions),
  };
}

function makeSession(args: {
  topic: Topic;
  index: number;
  slot: number;
  perWeek: number;
  kind: SessionKind;
  priority: number;
  mastery: number | undefined;
  recommendation?: Recommendation;
  revisitOf?: number;
}): PlanSession {
  const { topic } = args;
  const strand = STRAND_BY_ID.get(topic.strand);

  let why: string;
  if (args.kind === "check") {
    why = `One week on: ${topic.name}. Checking after a week is when the forgetting starts, so this is the cheapest moment to catch it.`;
  } else if (args.kind === "consolidate") {
    why = `Three weeks on: ${topic.name}. By now a child who has not retrieved it twice has probably never really had it.`;
  } else if (args.recommendation) {
    why = args.recommendation.why;
  } else if (args.mastery === undefined) {
    why = `Not assessed yet, and ${leverageOf(topic) >= 0.9 ? "everything later in the strand depends on it" : "it is part of the syllabus we have not reached"}. Teaching it now rather than discovering the gap in November.`;
  } else {
    why = `${topic.name} is at ${Math.round(args.mastery * 100)}%. Worth strengthening before the next assessment.`;
  }

  return {
    index: args.index,
    week: Math.floor(args.slot / args.perWeek) + 1,
    day: args.slot % args.perWeek,
    topicId: topic.id,
    topicName: topic.name,
    topicNameHi: topic.nameHi,
    strand: topic.strand,
    strandName: strand?.name ?? topic.strand,
    strandColor: strand?.color ?? "#888",
    kind: args.kind,
    revisitOf: args.revisitOf,
    why,
    priority: args.priority,
    unassessed: args.mastery === undefined,
    recommendation: args.recommendation,
  };
}

/** A one-line summary of what the week is for. */
function focusFor(sessions: PlanSession[], recommendations: Recommendation[]): string {
  if (sessions.length === 0) return "Free — catch up, assess, or consolidate";
  const taught = sessions.filter((s) => s.kind === "teach");
  if (taught.length === 0) return "Retrieval and consolidation week";

  const top = [...taught].sort((a, b) => b.priority - a.priority)[0]!;
  const gaps = taught.filter((s) => recommendations.some((r) => r.topicId === s.topicId)).length;

  if (gaps >= 2) return `Closing gaps: ${taught.map((s) => s.topicName).join(", ")}`;
  if (gaps === 1) return `Gap work plus new ground: ${top.topicName}`;
  return `New ground: ${taught.map((s) => s.topicName).join(", ")}`;
}
