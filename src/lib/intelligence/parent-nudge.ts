/**
 * Messages a teacher can send home.
 *
 * School–parent communication in most Indian classrooms is a sentence or two
 * in a diary: "please make them do homework". That is easy to ignore, and it
 * tells the family nothing they can act on tonight.
 *
 * This produces something better: a short message built from what the app
 * actually knows about this child, giving one specific thing to try at home,
 * in about ten minutes, with materials the family certainly has.
 *
 * ## The rules that shape every message
 *
 * **No scores, no rankings, no comparisons.** A parent opening this should
 * learn something they can do, not a reason to feel bad. Telling a mother her
 * child is 34th of 30 is not communication.
 *
 * **No blame, and never about attendance or behaviour.** Only mathematics.
 *
 * **One thing, not five.** A list is a list nobody starts.
 *
 * **Nothing invented.** If the app cannot support a suggestion, it says
 * nothing rather than generating generic encouragement. A message with no real
 * content is worse than no message.
 *
 * **Consent still applies.** A message is only produced for a child whose
 * parent has an active, unrevoked link.
 */

import { MISCONCEPTION_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import { retrievalPlan } from "@/lib/intelligence/retrieval";
import type { Evidence } from "@/lib/intelligence/mastery";

export type Nudge = {
  topicId: string;
  topicName: string;
  /** What the family does tonight. One sentence, an action. */
  doThis: string;
  /** How long it should take. Honest, and short. */
  minutes: number;
  /** What the family needs. Never anything they have to buy. */
  needs: string;
  /** Why this topic, in words a parent can follow. */
  why: string;
};

export type ParentMessage = {
  childName: string;
  /** The single thing to focus on. */
  nudge: Nudge | null;
  /** Opening line, deliberately warm and factual. */
  opening: string;
  /** The full message, ready to copy. */
  body: string;
  /** Stated when there is nothing worth sending. */
  honest: boolean;
};

/**
 * What to do at home, keyed by the topic-id prefix.
 *
 * One entry per prefix, not per topic: `as_` covers both addition and
 * subtraction, `md_` both multiplication and division, so the activity has to
 * work for either. One activity a family can genuinely do beats a list of
 * five they will not start.
 */
const HOME_MOVES: Record<string, { doThis: string; needs: string; minutes: number }> = {
  ns: {
    doThis: "Write any three-digit number, then ask which digit is in the hundreds, the tens and the ones. Let them point at each one on the number, not say it.",
    needs: "A pencil and paper",
    minutes: 5,
  },
  fr: {
    doThis: "Cut a chapati or a slice of bread in half, then in quarters. Ask which piece is bigger and how they can tell without eating it.",
    needs: "Something you can cut in half",
    minutes: 5,
  },
  md: {
    doThis: "Share something out equally — spoons, biscuits, chores. Ask how many each person gets, and how they worked it out. For times tables, count objects in fives or tens instead.",
    needs: "Small objects, or something countable",
    minutes: 5,
  },
  as: {
    doThis: "Add up two packets at home, then ask how much would be left after buying one. Let them work it out on paper and say which way they did it.",
    needs: "A note or a receipt",
    minutes: 5,
  },
  ge: {
    doThis: "Look around the house and ask them to find three things the same shape as something in their book. Ask why they match.",
    needs: "Their eyes",
    minutes: 5,
  },
  me: {
    doThis: "Measure one thing at home with a ruler or a step, and ask them to estimate it first and then check. For money, give them a note and ask what change comes back.",
    needs: "A ruler, their feet, or a coin",
    minutes: 5,
  },
  tm: {
    doThis: "Ask what time it will be in one hour, then check together. Repeat with thirty minutes.",
    needs: "A clock",
    minutes: 4,
  },
  da: {
    doThis: "Ask them to count how many of each kind of thing there is in one room, then draw it as a bar chart.",
    needs: "Paper and pencil",
    minutes: 6,
  },
  general: {
    doThis: "Ask them to show you how they worked something out. Listening to the method matters more than getting the answer right.",
    needs: "Ten minutes and patience",
    minutes: 10,
  },
};

function moveFor(topicId: string) {
  // Topic ids are prefixed by strand (`fr_`, `md_`, `as_`…), which is a far
  // better key than the topic itself: every fraction topic then gets the
  // fraction activity instead of falling through to the generic one.
  const prefix = topicId.split("_")[0] ?? "";
  return HOME_MOVES[prefix] ?? HOME_MOVES.general!;
}

/**
 * Pick the one thing worth asking a family to do.
 *
 * Ordered by how much it will help: a topic the child is weak on *and* has
 * only met a couple of times is worth more attention than one they are weak on
 * after many attempts, because the second is not going to move in ten minutes.
 */
function pickNudge(practised: Record<string, Evidence[]>, firstNameHere: string): Nudge | null {
  const due = retrievalPlan({ practised, max: 5 }).topics;
  if (due.length === 0) return null;

  const best = due[0]!;
  const topic = TOPIC_BY_ID.get(best.topicId);
  const move = moveFor(best.topicId);

  return {
    topicId: best.topicId,
    topicName: topic?.name ?? best.topicId,
    doThis: move.doThis,
    minutes: move.minutes,
    needs: move.needs,
    // About this child only. Saying "the class is furthest behind" would need
    // class data this function does not have, and a claim it cannot support is
    // worse than a plain one it can.
    why: `${topic?.name ?? "This topic"} is the area where ${firstNameHere} is furthest behind. A few minutes on it at home will help more than a full evening of anything else.`,
  };
}

/** The misconception, if the child has shown one, turned into advice. */
function misconceptionAdvice(misconceptionId: string | null, firstName: string): string | null {
  if (!misconceptionId) return null;
  const mc = MISCONCEPTION_BY_ID.get(misconceptionId);
  if (!mc) return null;
  // The parent's action, not the child's mistake. A parent who is told their
  // child "holds a wrong belief" is being asked to do nothing; told what to
  // practise, they can. The belief is quoted so it reads as the child's idea
  // rather than an accusation.
  return `If ${firstName} says something surprising, do not correct it straight away — ask how they worked it out. The idea that "${mc.belief}" is a common one in this topic, and it is fixable. It is not a sign the child cannot do it.`;
}

export function parentMessage(args: {
  childName: string;
  practised: Record<string, Evidence[]>;
  misconceptionId?: string | null;
}): ParentMessage {
  const first = args.childName.trim().split(/\s+/)[0] ?? args.childName;
  const nudge = pickNudge(args.practised, first);

  if (!nudge) {
    return {
      childName: first,
      nudge: null,
      opening: `Dear parent, ${first} is doing well in mathematics at the moment.`,
      body: `Dear parent,\n\n${first} is working confidently across the mathematics we have covered, and there is nothing we need you to practise at home this week. Please carry on encouraging the work they are already doing.\n\nThank you for your support.`,
      honest: false,
    };
  }

  const advice = misconceptionAdvice(args.misconceptionId ?? null, first);
  const body = [
    `Dear parent,`,
    ``,
    `${first} is doing well and putting in the effort. This week there is one small thing that would help at home.`,
    ``,
    `What to try: ${nudge.doThis}`,
    ``,
    `How long: about ${nudge.minutes} minutes. That is all — short and often works far better than a long session at the weekend.`,
    `You will need: ${nudge.needs}.`,
    `Why: ${nudge.why}`,
    ...(advice ? [``, advice] : []),
    ``,
    `If ${first} finds it hard, that is completely normal and it is what school is for. Please tell them it is fine to get something wrong while learning.`,
    ``,
    `Thank you for your support.`,
  ].join("\n");

  return { childName: first, nudge, opening: `Dear parent, ${first} is doing well and putting in the effort.`, body, honest: true };
}
