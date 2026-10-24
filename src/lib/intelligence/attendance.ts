/**
 * Attendance patterns.
 *
 * A single percentage is the obvious number and nearly the least useful one.
 * A child at 80% could be missing one day a week steadily, or missing a month
 * and then never again. Those are different children needing different
 * responses, and the percentage cannot tell them apart.
 *
 * What is worth knowing, in rough order of how much it matters:
 *
 * 1. **Consecutive days off.** Three or more days without contact is where
 *    families quietly stop sending children — the absence stops being a
 *    barrier and becomes a decision. It is the single most actionable thing
 *    here, and it is invisible in a percentage.
 * 2. **Chronic absence.** Often absent rather than occasionally absent.
 * 3. **Which days.** Absences clustered on one weekday usually mean something
 *    other than illness.
 * 4. **Direction.** Trending worse matters more than a stable mediocre rate.
 *
 * The honest limit: absence is a *signal*, never a diagnosis. A child absent
 * on Fridays may be working in a family shop. Every finding here is phrased
 * so a teacher can check it rather than accept it, and none of it is used to
 * make a claim about a child without saying what would confirm it.
 */

/** Absence that qualifies as chronic, as a share of recorded school days. */
export const CHRONIC_ABSENCE_RATE = 0.2;
/** Days off in a row that turn absence into something to act on today. */
export const CONSECUTIVE_ABSENCE_ALERT = 3;
/** Absence on a single weekday that out of twice the average is a pattern. */
export const WEEKDAY_CLUSTER_RATIO = 2;

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

/**
 * `excused` is a real, voluntary attendance — a medical appointment, a
 * festival, a death in the family — and counting it as absence would be both
 * wrong and insulting to a family doing the right thing. It is excluded from
 * the absence rate but still counts as a recorded school day, so marking a
 * child excused never inflates their attendance.
 */
export const ATTENDANCE_STATUSES = ["present", "absent", "late", "excused"] as const;

export const ATTENDANCE_LABEL: Record<AttendanceStatus, { en: string; hi: string; tone: string }> = {
  present: { en: "Present", hi: "उपस्थित", tone: "good" },
  late: { en: "Late", hi: "विलंब", tone: "warn" },
  absent: { en: "Absent", hi: "अनुपस्थित", tone: "bad" },
  excused: { en: "Excused", hi: "अनुपस्थि स्वीकृत", tone: "neutral" },
};

export type AttendanceInput = {
  /** ISO dates, one per recorded school day. */
  days: { date: string; status: AttendanceStatus }[];
  /** Today's date, to measure the current absence streak. */
  today: string;
};

export type AttendanceFinding = {
  id: string;
  /** One line, phrased so a teacher can act or dismiss it. */
  note: string;
  /** What would confirm or rule this out. */
  check: string;
  severity: "low" | "medium" | "high";
};

export type AttendanceSummary = {
  /** Share of recorded days present. `null` when nothing has been recorded. */
  presentRate: number | null;
  daysRecorded: number;
  daysAbsent: number;
  /** Current run of days off, counting back from today. */
  currentStreak: number;
  longestStreak: number;
  chronic: boolean;
  /** The weekday absences cluster on, when that stands out. */
  clusterDay: string | null;
  /** Present rate in the earlier half vs the later half of the record. */
  direction: "improving" | "steady" | "worsening" | null;
  findings: AttendanceFinding[];
  /**
   * A 0..1 number for the at-risk model, or `null` when nothing is recorded.
   * Null is meaningful: a child with no attendance record must not be treated
   * as fully present, and must not be treated as absent either.
   */
  concern: number | null;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function summariseAttendance(input: AttendanceInput): AttendanceSummary {
  const { days, today } = input;
  const none: AttendanceSummary = {
    presentRate: null, daysRecorded: 0, daysAbsent: 0,
    currentStreak: 0, longestStreak: 0, chronic: false,
    clusterDay: null, direction: null, findings: [], concern: null,
  };
  if (days.length === 0) return none;

  // Oldest first, so streak and direction maths read naturally.
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  // Excused days count as recorded school days but not as absence, so
  // marking one never flatters a child's attendance rate.
  const isAway = (s: AttendanceStatus) => s === "absent" || s === "late";

  const daysAbsent = sorted.filter((d) => isAway(d.status)).length;
  const presentRate = (sorted.length - daysAbsent) / sorted.length;

  // Streaks over recorded days. Weekends are not recorded at all, so a run of
  // three recorded absences is a run of three school days, not calendar days.
  let longest = 0;
  let run = 0;
  for (const d of sorted) {
    run = isAway(d.status) ? run + 1 : 0;
    if (run > longest) longest = run;
  }

  const todayMs = new Date(today).getTime();
  void todayMs;
  const recorded = new Set(sorted.map((d) => d.date));
  // The current streak only counts if today itself is recorded, otherwise an
  // unrecorded register would silently look like a long absence.
  const currentStreak = recorded.has(today)
    ? isAway(sorted[sorted.length - 1]!.status) ? runOfLatest(sorted) : 0
    : 0;

  const chronic = daysAbsent / sorted.length >= CHRONIC_ABSENCE_RATE;

  // Which weekday carries the absence.
  const byWeekday = new Map<number, number>();
  for (const d of sorted) {
    if (!isAway(d.status)) continue;
    const wd = new Date(d.date).getDay();
    byWeekday.set(wd, (byWeekday.get(wd) ?? 0) + 1);
  }
  let clusterDay: string | null = null;
  let clusterCount = 0;
  for (const [wd, n] of byWeekday) {
    if (n >= 3 && n >= WEEKDAY_CLUSTER_RATIO * (daysAbsent / 5)) {
      if (n > clusterCount) { clusterCount = n; clusterDay = WEEKDAYS[wd]!; }
    }
  }

  // Direction: split the record in half.
  let direction: AttendanceSummary["direction"] = null;
  if (sorted.length >= 6) {
    const half = Math.floor(sorted.length / 2);
    const rate = (xs: typeof sorted) => 1 - xs.filter((d) => isAway(d.status)).length / xs.length;
    const early = rate(sorted.slice(0, half));
    const late = rate(sorted.slice(half));
    const delta = late - early;
    if (delta <= -0.15) direction = "worsening";
    else if (delta >= 0.15) direction = "improving";
    else direction = "steady";
  }

  const findings: AttendanceFinding[] = [];

  if (currentStreak >= CONSECUTIVE_ABSENCE_ALERT) {
    findings.push({
      id: "streak",
      note: `Absent ${currentStreak} school days running. At three days, families often stop bringing children back without saying so.`,
      check: "Contact the family today. Find out whether something has changed at home before assuming illness.",
      severity: "high",
    });
  } else if (longest >= CONSECUTIVE_ABSENCE_ALERT) {
    findings.push({
      id: "long_gap",
      note: `There was a run of ${longest} days off earlier in the record.`,
      check: "Worth asking what happened around that date; a single long gap usually has a reason behind it.",
      severity: "medium",
    });
  }

  if (chronic) {
    findings.push({
      id: "chronic",
      note: `Absent or late for ${Math.round((1 - presentRate) * 100)}% of recorded days. Frequent absence, rather than occasional.`,
      check: "Look for a pattern in when it happens — work, care at home, health, or transport — before treating it as motivation.",
      severity: "high",
    });
  }

  if (clusterDay) {
    findings.push({
      id: "weekday",
      note: `Absences cluster on ${clusterDay}s.`,
      check: "Ask the family about that day specifically. A single weekday usually means something other than illness.",
      severity: "medium",
    });
  }

  if (direction === "worsening") {
    findings.push({
      id: "worsening",
      note: "Attendance has got steadily worse across the record.",
      check: "Compare with marks over the same period. When both fall together the cause is usually outside school.",
      severity: "high",
    });
  }

  if (findings.length === 0 && daysAbsent > 0) {
    findings.push({
      id: "occasional",
      note: `${daysAbsent} ${daysAbsent === 1 ? "day" : "days"} absent, with no run and no weekday pattern.`,
      check: "Nothing here suggests a pattern. Ordinary absence is not a concern on its own.",
      severity: "low",
    });
  }

  // One number for the at-risk model. Deliberately capped well below the
  // other components: absence is a contributing signal, and letting it
  // dominate would flag every child in a school with a long holiday or a
  // seasonal illness.
  let concern: number | null = 0;
  for (const f of findings) {
    concern += f.severity === "high" ? 0.2 : f.severity === "medium" ? 0.1 : 0.03;
  }
  concern = Math.round(Math.min(1, concern) * 100) / 100;

  return {
    presentRate, daysRecorded: sorted.length, daysAbsent,
    currentStreak, longestStreak: longest, chronic, clusterDay, direction,
    findings, concern,
  };
}

/** Length of the run of absences ending on the most recent recorded day. */
function runOfLatest(sorted: { date: string; status: AttendanceStatus }[]): number {
  let run = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.status !== "absent") break;
    run++;
  }
  return run;
}
