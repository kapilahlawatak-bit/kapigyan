/**
 * Learning gain — "did the teaching work?"
 *
 * The plan says *teach place value on 12 November*. Then nothing happens. The
 * topic's mastery drifts for reasons nobody can see, and the app never checks
 * whether the lesson landed. That leaves the loop open: diagnose, recommend,
 * teach, and hope.
 *
 * This closes it by splitting each topic's evidence at a teaching date and
 * comparing the class mean on either side.
 *
 * ## What this does and does not claim
 *
 * It is tempting to call the difference "the impact of your teaching". That
 * would be a lie. Between the two points a lot can change: the next test may
 * be easier, a different child may be absent, the cohort may have been
 * taught the topic again elsewhere. Nothing here controls for any of that.
 *
 * So the honest claim is the weaker one, and it is still worth having: *after
 * this topic was taught, the class moved from A to B on it, and here is who
 * moved and who did not.* The "who did not" is the actionable half — those
 * children need something different, and a teacher cannot find them from a
 * class average.
 *
 * Two guards keep the number honest:
 *
 * - **Evidence on both sides is required.** With nothing to compare against,
 *   a jump would be a comparison between "no data" and "some data", which
 *   measures when the child was tested, not what they learned. Questions
 *   asked only after teaching are counted as gain by a naive implementation,
 *   and that is the single easiest way to invent a success story.
 * - **Dropouts are reported, not hidden.** If children stopped being assessed
 *   on a topic after it was taught, the surviving average can rise with no
 *   teaching at all. The coverage drop is surfaced next to the gain.
 */

import { computeMastery, type Evidence } from "@/lib/intelligence/mastery";
import { TOPIC_BY_ID } from "@/lib/curriculum";

/** A topic needs evidence on both sides of the split before it can be judged. */
export const MIN_EVIDENCE_BEFORE = 1;
export const MIN_EVIDENCE_AFTER = 1;
/**
 * Below this many children assessed on both sides, a "movement" is noise.
 * A class of four is not a trend.
 */
export const MIN_CHILDREN = 5;

export type TopicGain = {
  topicId: string;
  topicName: string;
  /** ISO date the topic was scheduled to be taught. */
  taughtAt: string;
  /** Days between teaching and the latest evidence counted as "after". */
  daysSinceTaught: number;

  /** Class mean mastery from evidence before the lesson. */
  before: number;
  /** Class mean mastery from evidence at or after the lesson. */
  after: number;
  /** after − before, in percentage points. */
  gain: number;

  childrenBefore: number;
  childrenAfter: number;
  /**
   * Children assessed before but not after. A large drop here means the
   * average may have risen because the weak ones stopped being tested.
   */
  childrenLost: number;

  /** Verdict, in words. Never a bare number. */
  verdict: "worked" | "no_change" | "regressed" | "untested_after" | "not_enough_data";
  note: string;
};

export type TeachingFeedback = {
  topics: TopicGain[];
  counts: {
    worked: number;
    noChange: number;
    regressed: number;
    /** Taught and later assessed, but movement is too small to call. */
    flat: number;
    /** Taught, but never assessed again — the loop is still open. */
    untested: number;
    /** Not enough evidence to say anything. */
    unknown: number;
  };
  /**
   * Children who were weak before the lesson and stayed weak after it. This
   * is the list a teacher acts on, and it is why per-topic gain matters more
   * than a class average.
   */
  stillStuck: { studentId: string; studentName: string; topicId: string; topicName: string; after: number }[];
  headline: string;
};

/**
 * One child's score on one topic from a slice of evidence.
 *
 * This deliberately uses `raw` — the unshrunk weighted score — rather than
 * `mastery`. Shrinkage exists to stop a single thin result from being read as
 * a judgement about a child, and it is right for that job. But it shrinks
 * every child toward the same prior, which *compresses the difference between
 * two dates*. Measuring change with it would systematically understate the
 * movement, and the whole page is about movement. A class mean is already an
 * average of a dozen children and needs no prior of its own.
 */
function childScore(evidence: Evidence[]): number {
  return computeMastery(evidence, 0).raw;
}

/**
 * Compare class mastery before and after each date a topic was taught.
 *
 * `masteryAt` is supplied by the caller as topicId -> childId -> mastery at a
 * point in time, so this module stays free of database access and can be
 * tested directly.
 */
export function learningGain(args: {
  /** topicId -> the dates it was taught (from the plan or the teacher's log). */
  taught: Record<string, string[]>;
  /** topicId -> childId -> evidence before the teaching date. */
  before: Record<string, Record<string, Evidence[]>>;
  /** topicId -> childId -> evidence at or after the teaching date. */
  after: Record<string, Record<string, Evidence[]>>;
  studentNames: Record<string, string>;
  now?: Date;
}): TeachingFeedback {
  const now = args.now ?? new Date();
  const topics: TopicGain[] = [];
  const stillStuck: TeachingFeedback["stillStuck"] = [];

  for (const [topicId, dates] of Object.entries(args.taught)) {
    const name = TOPIC_BY_ID.get(topicId)?.name ?? topicId;
    // Use the most recent teaching of the topic; an earlier one has had longer
    // to be followed by evidence and makes a fairer comparison.
    const taughtAt = dates.map((d) => new Date(d)).sort((a, b) => b.getTime() - a.getTime())[0]!;

    const beforeBy = args.before[topicId] ?? {};
    const afterBy = args.after[topicId] ?? {};

    const childrenBefore = Object.keys(beforeBy).filter((k) => beforeBy[k]!.length >= MIN_EVIDENCE_BEFORE);
    const childrenAfter = Object.keys(afterBy).filter((k) => afterBy[k]!.length >= MIN_EVIDENCE_AFTER);

    const meanBefore = meanOf(childrenBefore.map((c) => childScore(beforeBy[c]!)));
    const meanAfter = meanOf(childrenAfter.map((c) => childScore(afterBy[c]!)));

    const lost = childrenBefore.filter((c) => !childrenAfter.includes(c));
    const days = Math.max(
      0,
      Math.round((now.getTime() - taughtAt.getTime()) / 86_400_000),
    );

    const base = { topicId, topicName: name, taughtAt: taughtAt.toISOString(), daysSinceTaught: days };

    if (childrenAfter.length === 0) {
      topics.push({
        ...base,
        before: pct(meanBefore), after: pct(meanAfter), gain: 0,
        childrenBefore: childrenBefore.length, childrenAfter: 0, childrenLost: lost.length,
        verdict: "untested_after",
        note: childrenBefore.length === 0
          ? "No evidence before the lesson either, so there is nothing to compare."
          : `Taught ${days} days ago and not assessed since. You cannot know whether it worked.`,
      });
      continue;
    }

    if (childrenBefore.length === 0) {
      topics.push({
        ...base,
        before: pct(meanBefore), after: pct(meanAfter), gain: 0,
        childrenBefore: 0, childrenAfter: childrenAfter.length, childrenLost: 0,
        verdict: "untested_after",
        note: "Only assessed after the lesson. The gain would just be measuring when the child sat the test.",
      });
      continue;
    }

    const gain = pct(meanAfter) - pct(meanBefore);

    if (childrenAfter.length < MIN_CHILDREN || childrenBefore.length < MIN_CHILDREN) {
      topics.push({
        ...base,
        before: pct(meanBefore), after: pct(meanAfter), gain,
        childrenBefore: childrenBefore.length, childrenAfter: childrenAfter.length,
        childrenLost: lost.length, verdict: "not_enough_data",
        note: `Only ${Math.min(childrenBefore.length, childrenAfter.length)} children had evidence on both sides. Too few to call movement.`,
      });
      continue;
    }

    // "Was weak, and did not move" is the actionable list. Both halves need
    // evidence on each side, so a child first assessed *after* the lesson —
    // a new joiner, or a topic the class had never been asked before — has no
    // baseline to be stuck against and is simply left out rather than guessed.
    for (const childId of childrenAfter) {
      if (!beforeBy[childId]) continue;
      const wasWeakBefore = childScore(beforeBy[childId]) < 0.5;
      const didNotMove = childScore(afterBy[childId]!) < childScore(beforeBy[childId]) + 0.1;
      if (wasWeakBefore && didNotMove) {
        stillStuck.push({
          studentId: childId,
          studentName: args.studentNames[childId] ?? "Child",
          topicId, topicName: name,
          after: pct(childScore(afterBy[childId]!)),
        });
      }
    }

    // A move of exactly 10 points is a single mark out of ten. That is not a
    // trend, so the bar sits strictly above it.
    const verdict: TopicGain["verdict"] =
      gain > 10 ? "worked" : gain <= -10 ? "regressed" : "no_change";

    // A large coverage drop makes a gain untrustworthy, whatever the number says.
    const lostShare = childrenBefore.length > 0 ? lost.length / childrenBefore.length : 0;
    const note =
      verdict === "worked"
        ? lostShare >= 0.3
          ? `Up ${Math.round(gain)} points since the lesson, but ${lost.length} of ${childrenBefore.length} children were not assessed afterwards, so part of that may be who stopped being tested.`
          : `Up ${Math.round(gain)} points since the lesson, with ${childrenAfter.length} children assessed on both sides.`
        : verdict === "regressed"
          ? `Down ${Math.abs(Math.round(gain))} points since the lesson. Worth looking at how it was taught before trying again.`
          : `No real movement (${gain > 0 ? "+" : ""}${Math.round(gain)} points). Different approach, or a closer look at why the first attempt did not land.`;

    topics.push({
      ...base,
      before: pct(meanBefore), after: pct(meanAfter), gain,
      childrenBefore: childrenBefore.length, childrenAfter: childrenAfter.length,
      childrenLost: lost.length, verdict, note,
    });
  }

  topics.sort((a, b) => b.gain - a.gain);

  const counts = { worked: 0, noChange: 0, regressed: 0, flat: 0, untested: 0, unknown: 0 };
  for (const t of topics) {
    if (t.verdict === "worked") counts.worked++;
    else if (t.verdict === "regressed") counts.regressed++;
    else if (t.verdict === "no_change") counts.noChange++;
    else if (t.verdict === "untested_after") counts.untested++;
    else counts.unknown++;
  }

  const judged = counts.worked + counts.noChange + counts.regressed;
  const headline =
    judged === 0
      ? `Nothing taught has been assessed again yet, so there is no way to tell what worked.`
      : counts.untested > 0
        ? `${counts.worked} of ${judged} topics improved after teaching. ${counts.untested} still have not been checked.`
        : `${counts.worked} of ${judged} topics improved after teaching.`;

  return { topics, counts, stillStuck, headline };
}

function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const pct = (n: number) => Math.round(n * 100);
