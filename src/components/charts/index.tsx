"use client";

/**
 * Charts.
 *
 * Recharts is client-only, so each chart is a client component receiving
 * plain serialisable props. Kept in one file so the chart defaults — colours,
 * grid weight, axis styling — stay consistent, and so a school can be given a
 * different palette by editing one object.
 *
 * Two deliberate choices for the Indian school context:
 *  - Every chart has a text alternative rendered alongside it. A heatmap with
 *    numbers in every cell and a table fallback is readable by a colour-blind
 *    teacher and printable in black and white.
 *  - No 3D, no gradients on data, no animation on first paint beyond a short
 *    fade — these run on old school laptops and get printed.
 */

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, PolarAngleAxis, PolarGrid,
  PolarRadiusAxis, Radar, RadarChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { STRANDS } from "@/lib/curriculum";
import { heatStyle } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Shared chrome                                                       */
/* ------------------------------------------------------------------ */

const AXIS = { fontSize: 11, fill: "var(--color-ink-3)" };
const GRID = "var(--color-line-2)";

type TooltipItem = { name?: string; value?: number | string; color?: string; fill?: string };
type TooltipBoxProps = { active?: boolean; payload?: TooltipItem[]; label?: string | number };

function TooltipBox({ active, payload, label }: TooltipBoxProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-control border bg-surface px-2.5 py-1.5 shadow-lift text-[11px]">
      {label ? <p className="font-semibold text-ink mb-0.5">{label}</p> : null}
      {payload.map((p: TooltipItem) => (
        <p key={p.name} className="text-ink-2">
          <span className="inline-block size-2 rounded-full mr-1.5" style={{ background: p.color ?? p.fill }} />
          {p.name}: <span className="font-semibold text-ink">{p.value}{typeof p.value === "number" && p.name?.toLowerCase().includes("%") ? "%" : ""}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Topic performance                                                   */
/* ------------------------------------------------------------------ */

export function TopicBarChart({
  data,
  height = 260,
  threshold = 60,
}: {
  data: { name: string; percent: number; strand: string; questions: number }[];
  height?: number;
  threshold?: number;
}) {
  const rows = [...data].slice(0, 12);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} unit="%" />
          <YAxis type="category" dataKey="name" width={150} tick={AXIS} tickLine={false} axisLine={false} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--color-surface-2)" }} />
          <ReferenceLine
            x={threshold}
            stroke="var(--color-bad)"
            strokeDasharray="3 3"
            label={{ value: "gap line", position: "top", fontSize: 9, fill: "var(--color-ink-4)" }}
          />
          <Bar dataKey="percent" name="Correct" radius={[0, 4, 4, 0]} barSize={16}>
            {rows.map((r) => (
              <Cell key={r.name} fill={strandColorOf(r.strand)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Strand mix                                                          */
/* ------------------------------------------------------------------ */

export function StrandRadar({ data }: { data: { strand: string; percent: number }[] }) {
  const rows = data.map((d) => ({
    name: STRANDS.find((s) => s.id === d.strand)?.name ?? d.strand,
    percent: d.percent,
  }));
  if (rows.length < 3) return null;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={rows} outerRadius="72%">
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="name" tick={{ ...AXIS, fontSize: 10 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar name="Class average" dataKey="percent" stroke="var(--color-brand)" fill="var(--color-brand)" fillOpacity={0.25} />
          <Tooltip content={<TooltipBox />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Score trend                                                         */
/* ------------------------------------------------------------------ */

export function ScoreTrend({ data }: { data: { label: string; percent: number; name?: string }[] }) {
  if (data.length < 2) return null;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} unit="%" width={46} />
          <Tooltip content={<TooltipBox />} />
          <Line
            type="monotone"
            dataKey="percent"
            name="Score"
            stroke="var(--color-brand)"
            strokeWidth={2.5}
            dot={{ r: 3, fill: "var(--color-brand)", strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grade distribution                                                  */
/* ------------------------------------------------------------------ */

export function BandDistribution({ data }: { data: { band: string; count: number }[] }) {
  const tones: Record<string, string> = {
    "A+": "oklch(0.62 0.15 155)", A: "oklch(0.7 0.14 150)", B: "oklch(0.78 0.13 120)",
    C: "oklch(0.76 0.14 80)", D: "oklch(0.72 0.15 55)", E: "oklch(0.6 0.19 25)",
  };
  const total = data.reduce((a, b) => a + b.count, 0);
  if (total === 0) return null;
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -24 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="band" tick={AXIS} tickLine={false} axisLine={false} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={40} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--color-surface-2)" }} />
          <Bar dataKey="count" name="Students" radius={[4, 4, 0, 0]} barSize={34}>
            {data.map((d) => (
              <Cell key={d.band} fill={tones[d.band] ?? "var(--color-brand)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mastery by topic for one child                                     */
/* ------------------------------------------------------------------ */

export function MasteryBars({ data }: { data: { name: string; mastery: number; trend: string }[] }) {
  const rows = data.slice(0, 14);
  if (rows.length === 0) return null;
  return (
    <div className="w-full space-y-2">
      {rows.map((r) => {
        const v = Math.round(r.mastery * 100);
        return (
          <div key={r.name} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate text-[11px] text-ink-2" title={r.name}>
              {r.name}
            </span>
            <div className="h-2.5 flex-1 rounded-full bg-surface-3 overflow-hidden">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{
                  width: `${v}%`,
                  background: v >= 70 ? "var(--color-good)" : v >= 45 ? "var(--color-warn)" : "var(--color-bad)",
                }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-[11px] font-semibold tabular-nums text-ink-2">{v}%</span>
            <span
              className="w-14 shrink-0 text-right text-[10px]"
              title={`${r.trend}`}
            >
              {r.trend === "improving" ? "↑ better" : r.trend === "declining" ? "↓ slipping" : r.trend === "steady" ? "→ steady" : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Heatmap                                                             */
/* ------------------------------------------------------------------ */

export type HeatmapData = {
  students: { id: string; name: string; rollNo: number | null; percent: number }[];
  topics: { topicId: string; name: string; strand: string; questionCount: number }[];
  cells: { percent: number | null; attempted: number; blank: number; correct: number }[][];
};

/**
 * Students × topics. Deliberately a table of divs, not an SVG chart: it has to
 * print cleanly, work without JavaScript layout maths, and remain readable when
 * the school prints it in black and white.
 */
export function Heatmap({ data }: { data: HeatmapData }) {
  if (data.students.length === 0 || data.topics.length === 0) return null;
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface px-2 py-1.5 text-left font-semibold text-ink-3 min-w-[9rem]">
              Student
            </th>
            {data.topics.map((t) => (
              <th key={t.topicId} className="px-1 py-1.5 font-semibold text-ink-3" title={t.name}>
                <span
                  className="block w-7 truncate"
                  style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: "6.5rem" }}
                >
                  {t.name}
                </span>
              </th>
            ))}
            <th className="px-2 py-1.5 font-semibold text-ink-3">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.students.map((s, i) => (
            <tr key={s.id}>
              <td className="sticky left-0 z-10 bg-surface px-2 py-1 font-medium text-ink-2 whitespace-nowrap">
                {s.rollNo ? `${s.rollNo}. ` : ""}{s.name}
              </td>
              {data.topics.map((t, j) => {
                const cell = data.cells[i]?.[j];
                return (
                  <td key={t.topicId} className="p-0">
                    <div
                      className="heat-cell mx-0.5 my-0.5 flex h-7 items-center justify-center rounded-[3px] font-semibold"
                      style={heatStyle(cell?.percent ?? null)}
                      title={`${s.name} — ${t.name}: ${cell?.percent === null || cell?.percent === undefined ? "not assessed" : `${cell.percent}% correct of ${cell.attempted} attempted`}${cell && cell.blank > 0 ? `, ${cell.blank} not attempted` : ""}`}
                    >
                      {cell?.percent === null || cell?.percent === undefined ? "·" : cell.percent}
                    </div>
                  </td>
                );
              })}
              <td className="px-2 py-1 text-right font-semibold tabular-nums text-ink-2">{s.percent}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function strandColorOf(strand: string): string {
  return STRANDS.find((s) => s.id === strand)?.color ?? "#64748b";
}
