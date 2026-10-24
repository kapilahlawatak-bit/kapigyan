/**
 * Per-child spaced retrieval.
 *
 * The class teaching plan schedules revisits for a whole class. Nothing
 * schedules anything for an individual child, which is a gap where it matters
 * most: a child weak in fractions needs three questions on Monday, three next
 * week and three the week after, driven by *their* forgetting. Every child
 * getting the same sheet wastes a struggling child's time on what they already
 * know and gives a secure child nothing to retrieve.
 *
 * ## Why intervals, and why these
 *
 * The intervals follow the classic expanding schedule (1, 3, 7, 16, 35 days)
 * from Ebbinghaus' forgetting curve work as refined for classroom retrieval.
 * The shape matters more than the exact numbers: gaps lengthen because
 * retention strengthens each time the item is recalled, so a later gap costs
 * less effort for the same benefit.
 *
 * Crucially, the interval is scaled by how badly the child knows the topic.
 * A child at 40% gets the next item sooner than a child at 70%. That is the
 * whole difference between a scheduler and a fixed timetable.
 *
 * ## What it is not
 *
 * This does not predict when a child *will* forget. It approximates. The
 * intervals are defensible defaults, not a measurement of one particular
 * child, and a teacher who knows otherwise should override rather than defer.
 */

import { computeMastery, type Evidence } from "@/lib/intelligence/mastery";
import { TOPIC_BY_ID } from "@/lib/curriculum";

/** Day gaps between successive reviews of the same topic. */
const BASE_INTERVALS = [1, 3, 7, 16, 35] as const;
/** Mastery at or above this is treated as secure and dropped from rotation. */
const SECURE_AT = 0.8;
/**
 * Only a topic this far below is skipped.
 *
 * The instinct is to exclude anything very low as "not worth practising", but
 * that is exactly backwards: those are the children who need practice most, and
 * giving them an empty screen is how a struggling child decides the app is not
 * for them. The floor exists only for a topic answered almost entirely wrong,
 * where a few questions would be demoralising rather than useful.
 */
const NOT_WORTH_IT_BELOW = 0.15;

export type DueTopic = {
  topicId: string;
  topicName: string;
  topicNameHi: string;
  /** 0..1, unshrunk — a raw score reads truer for a child's own practice. */
  mastery: number;
  /** Why this topic is on the list, in a sentence the child can understand. */
  why: string;
  /** Which review this is: 1 = first since it was last taught. */
  reviewNumber: number;
  /**
   * Days from the last attempt until this topic is next due.
   *
   * Exposed so a teacher can see the reasoning, not just its output. It is
   * deliberately not shown to the child — telling a six-year-old "due in two
   * days" while handing them the questions now would only confuse them.
   */
  dueInDays: number;
  /** True when the topic is weak enough to be worth interrupting the day. */
  urgent: boolean;
};

export type RetrievalPlan = {
  topics: DueTopic[];
  /** The strongest reason the plan is short, for the parent and the teacher. */
  headline: string;
  /** Topics dropped because the child is secure there, with the count. */
  secureCount: number;
};

/**
 * Schedule reviews for one child.
 *
 * `practised` is every topic the child has been asked about, with the evidence
 * behind it. A topic practised once is treated as freshly taught and comes
 * back tomorrow; a topic practised six times across a term comes back much
 * later. The number of attempts, not the calendar, drives the interval.
 */
export function retrievalPlan(args: {
  practised: Record<string, Evidence[]>;
  /** Limit the day's list. Three is deliberate: a child will not do more. */
  max?: number;
}): RetrievalPlan {
  const max = args.max ?? 3;
  const rows: (DueTopic & { dueInDays: number; lastPractised: number })[] = [];

  for (const [topicId, evidence] of Object.entries(args.practised)) {
    if (evidence.length === 0) continue;
    const score = computeMastery(evidence, 0).raw;
    if (score >= SECURE_AT) continue;
    if (score < NOT_WORTH_IT_BELOW) continue;

    const last = evidence.reduce((a, e) => Math.max(a, new Date(e.at).getTime()), 0);
    const reviewNumber = Math.min(evidence.length, BASE_INTERVALS.length);
    const base = BASE_INTERVALS[reviewNumber - 1]!;

    // The weaker the child is, the sooner they come back. The multiplier falls
    // as urgency rises, so a struggling child's gap is cut to about two thirds
    // while a nearly-secure child's is stretched to roughly one and a third.
    //
    // The scaling is deliberately weakest on the first review: everything
    // comes back in a day, because a first revisit is worth doing soon whether
    // the child is at 40% or 70%. The separation grows on later reviews, which
    // is where a few days actually changes what a child retains.
    const urgency = 1 - score;
    const dueInDays = Math.max(1, Math.round(base * (1.6 - urgency * 1.2)));

    const topic = TOPIC_BY_ID.get(topicId);
    const days = Math.floor((Date.now() - last) / 86_400_000);
    rows.push({
      topicId,
      topicName: topic?.name ?? topicId,
      topicNameHi: topic?.nameHi ?? "",
      mastery: Math.round(score * 100) / 100,
      why: whyFor(score, reviewNumber, days),
      reviewNumber,
      urgent: score < 0.5,
      dueInDays,
      lastPractised: last,
    });
  }

  // Most overdue first, then weakest. Overdue beats weak: a topic due today
  // has already slipped, while a weak one may not be due for three days.
  rows.sort((a, b) => {
    const aOverdue = a.dueInDays <= 0 ? 0 : 1;
    const bOverdue = b.dueInDays <= 0 ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    if (aOverdue === 0 && a.dueInDays !== b.dueInDays) return a.dueInDays - b.dueInDays;
    return a.mastery - b.mastery;
  });

  const all = rows;
  const chosen = all.filter((r) => r.dueInDays <= 0).slice(0, max);
  // A child with nothing overdue still gets the weakest thing back, because
  // an empty practice screen teaches them the app is decorative.
  const topics = chosen.length > 0 ? chosen : all.slice(0, Math.min(max, all.length));

  return {
    topics,
    secureCount: Object.keys(args.practised).length - all.length,
    headline: headlineFor(topics),
  };
}

function whyFor(score: number, reviewNumber: number, daysSince: number): string {
  const pct = Math.round(score * 100);
  if (reviewNumber === 1) {
    return `You met this ${daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`} and got about ${pct} out of 100. A quick try now, while it is still fresh, is what makes it stick.`;
  }
  if (daysSince < 3) {
    return `You were at about ${pct} out of 100 last time. It is still fresh, so this is the cheap moment to revisit it.`;
  }
  return `Last time you were at about ${pct} out of 100, ${daysSince} days ago. Old things fade fastest when you do not use them, so today is the right day.`;
}

function headlineFor(topics: DueTopic[]): string {
  if (topics.length === 0) return "Nothing is due today. Come back tomorrow — the schedule is working.";
  const n = topics.length;
  return `${n} ${n === 1 ? "topic is" : "topics are"} due. Short and often beats long and rare.`;
}
