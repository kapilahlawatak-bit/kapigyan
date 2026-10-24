/**
 * Parsing a typed bubble sheet.
 *
 * Kept free of any database import so a client component can use it. The
 * sheet-building half of this feature lives in `analytics/omr.ts` and talks
 * to Prisma; importing that from the browser would drag the whole ORM into
 * the client bundle.
 */

/**
 * Turn a typed answer string into per-question letters.
 *
 * Accepts `ABCDABCD`, `A B C D A B C D`, `1A 2B 3C`. Anything unrecognised
 * returns null for that question rather than a guess — a blank on the sheet and
 * a blank the app could not read are different problems, and the second one
 * must be visible.
 *
 * Answers are positional. A child who skipped question 4 must still leave a
 * placeholder, because dropping the gap would shift every later mark onto the
 * wrong question.
 */
export function parseOmr(input: string, questionNumbers: number[]): (string | null)[] {
  const cleaned = input.toUpperCase().replace(/[^A-E0-9\s.\-]/g, " ").trim();
  const letters = [...cleaned.matchAll(/[A-E]/g)].map((m) => m[0]!);
  return questionNumbers.map((_, i) => letters[i] ?? null);
}
