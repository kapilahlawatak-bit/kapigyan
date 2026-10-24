import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function marks(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  // Primary papers use halves and quarters far more often than decimals.
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function compact(n: number): string {
  if (n >= 10000000) return `${Math.round(n / 10000000)} cr`;
  if (n >= 100000) return `${Math.round(n / 100000)} L`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

export function formatDate(d: Date | string, withYear = false): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

export function relativeTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = Date.now() - date.getTime();
  const day = 86400000;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < day) return `${Math.floor(diff / 3600000)} hours ago`;
  if (diff < day * 7) return `${Math.floor(diff / day)} days ago`;
  return formatDate(date, true);
}

export const TERM_OPTIONS = ["Term 1", "Term 2", "Term 3", "Unit test 1", "Unit test 2", "Half yearly", "Pre-board", "Practice"] as const;

/* ------------------------------------------------------------------ */
/* Curriculum lookups                                                  */
/* ------------------------------------------------------------------ */

import { MISCONCEPTION_BY_ID, STRAND_BY_ID, TOPIC_BY_ID, QUESTION_TYPE_BY_ID } from "@/lib/curriculum";

/** Re-exported so report pages import formatting and grading from one place. */
export { gradeBand } from "@/lib/curriculum";

export function topicName(id: string | null | undefined): string {
  if (!id) return "Untagged";
  return TOPIC_BY_ID.get(id)?.name ?? id;
}

export function topicNameHi(id: string | null | undefined): string {
  if (!id) return "वर्गीकृत नहीं";
  return TOPIC_BY_ID.get(id)?.nameHi ?? id;
}

export function strandMeta(id: string) {
  return STRAND_BY_ID.get(id);
}

export function strandColor(id: string): string {
  return STRAND_BY_ID.get(id)?.color ?? "#64748b";
}

export function strandName(id: string): string {
  return STRAND_BY_ID.get(id)?.name ?? id;
}

export function misconceptionName(id: string | null | undefined): string {
  if (!id) return "";
  return MISCONCEPTION_BY_ID.get(id)?.name ?? id;
}

export function questionTypeName(id: string): string {
  return QUESTION_TYPE_BY_ID.get(id)?.name ?? id;
}

/** Colour for a 0-100 score, used by every score pill in the app. */
export function scoreTone(score: number | null | undefined): "good" | "warn" | "bad" | "none" {
  if (score === null || score === undefined || !Number.isFinite(score)) return "none";
  if (score >= 70) return "good";
  if (score >= 45) return "warn";
  return "bad";
}

/** Heatmap background from a 0-100 value. Uses opacity so dark mode works. */
export function heatStyle(value: number | null): React.CSSProperties {
  if (value === null) {
    return { background: "var(--color-surface-2)", color: "var(--color-ink-4)" };
  }
  const v = Math.max(0, Math.min(100, value));
  const alpha = v === 0 ? 0.12 : 0.14 + (v / 100) * 0.78;
  const hue = v >= 70 ? 155 : v >= 45 ? 75 : 25;
  const light = v >= 70 ? "52% 62%" : v >= 45 ? "70% 50%" : "58% 52%";
  return {
    background: `oklch(${alpha} ${light})`,
    color: v >= 45 ? "#fff" : "var(--color-ink)",
  };
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Deterministic pastel colour from a name, for avatars. */
export function avatarColor(name: string): string {
  const palette = [
    "oklch(0.72 0.14 268)", "oklch(0.75 0.13 210)", "oklch(0.76 0.13 155)",
    "oklch(0.8 0.13 85)", "oklch(0.72 0.15 330)", "oklch(0.74 0.13 295)",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}
