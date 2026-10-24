"use client";

import { useActionState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Circle, Download, MinusCircle, Pencil, Trophy } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
  Select,
} from "@/components/ui/primitives";
import {
  STRANDS,
  FLN_DOMAINS,
  topicsForClass,
  competitionTopicsForClass,
  topicDepth,
  type Topic,
} from "@/lib/curriculum";
import {
  COMP_TIERS,
  COMP_TIER_BY_ID,
  resolveDepth,
  type DepthOverride,
  type ResolvedDepth,
} from "@/lib/competition";
import { saveTopicDepth, resetTopicDepth, importDepthMap, type DepthState } from "@/app/actions/competition";
import { cn } from "@/lib/utils";

export type CurriculumRow = {
  topicId: string;
  mastery: number;
  assessed: number;
  gap: number;
};

/**
 * The syllabus as a map rather than a list.
 *
 * Shared by the school teacher and the home educator, because it is the same
 * job in both: it replaces the textbook index, the annual planner and the
 * progress register, and answers the only two questions that matter — what
 * have we covered, and what still needs teaching.
 *
 * Three states per topic, because "not assessed" and "assessed and weak" are
 * completely different jobs and a single progress bar would blur them.
 *
 * This is a Client Component because the depth editor needs `useActionState`.
 * That costs the links a hand: they arrive as **templates** rather than as
 * functions, because a server component cannot hand a function to a client
 * component — Next rejects it outright with "Event handlers cannot be passed
 * to Client Component props". `{topic}` and `{tier}` are substituted here.
 */
export function CurriculumMap({
  grade,
  rows,
  classId,
  topicHrefTemplate,
  compTarget,
  compHrefTemplate,
  compOverrides,
  canEditDepth,
}: {
  grade: number;
  rows: CurriculumRow[];
  classId?: string;
  topicHrefTemplate?: string;
  compTarget?: number;
  compHrefTemplate?: string;
  compOverrides?: Map<string, DepthOverride>;
  canEditDepth?: boolean;
}) {
  const onTopicHref = topicHrefTemplate
    ? (topicId: string) => topicHrefTemplate.replace("{topic}", encodeURIComponent(topicId))
    : undefined;
  const masteryByTopic = new Map(rows.map((r) => [r.topicId, r]));
  const topics = topicsForClass(grade);

  const assessed = topics.filter((t) => masteryByTopic.has(t.id));
  const strong = topics.filter((t) => (masteryByTopic.get(t.id)?.mastery ?? 0) >= 0.7);
  const weak = topics.filter((t) => {
    const row = masteryByTopic.get(t.id);
    return row !== undefined && row.mastery < 0.5;
  });
  const unassessed = topics.length - assessed.length;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label={`Topics in Class ${grade}`} value={topics.length} sub="the whole syllabus" />
        <Stat
          label="Assessed so far"
          value={assessed.length}
          sub={`${unassessed} never tested`}
          progress={(assessed.length / Math.max(1, topics.length)) * 100}
          tone="brand"
        />
        <Stat
          label="Secure (70%+)"
          value={strong.length}
          sub="move on from these"
          progress={(strong.length / Math.max(1, topics.length)) * 100}
          tone="good"
        />
        <Stat
          label="Needs teaching"
          value={weak.length}
          sub="below 50%"
          progress={(weak.length / Math.max(1, topics.length)) * 100}
          tone="bad"
        />
      </div>

      {compTarget !== undefined && compHrefTemplate ? (
        <CompetitionPanel
          grade={grade}
          rows={rows}
          target={compTarget}
          hrefTemplate={compHrefTemplate}
          overrides={compOverrides}
          canEdit={canEditDepth}
        />
      ) : null}

      {/* Gaps first. A teacher opening this page wants the red, not the list. */}
      {weak.length > 0 ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Teaching these first</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">
                The topics this class has actually been assessed on and has not got.{" "}
                <Link href="/plan" className="text-brand hover:underline">See them in the term plan</Link>.
              </p>
            </div>
            <Badge tone="bad" size="lg">{weak.length}</Badge>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5">
              {weak
                .sort((a, b) => (masteryByTopic.get(a.id)?.mastery ?? 0) - (masteryByTopic.get(b.id)?.mastery ?? 0))
                .map((t) => {
                  const row = masteryByTopic.get(t.id)!;
                  return (
                    <span
                      key={t.id}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-bad-soft/50 px-2.5 py-1 text-[10px] text-ink-2"
                    >
                      {t.name}
                      <span className="font-semibold tabular-nums text-bad">{Math.round(row.mastery * 100)}%</span>
                    </span>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {STRANDS.map((strand) => {
        const strandTopics = topics.filter((t) => t.strand === strand.id);
        if (strandTopics.length === 0) return null;
        return (
          <Card key={strand.id}>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: strand.color }} />
                  {strand.name}
                </CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-4">{strand.nameHi}</p>
              </div>
              <Badge tone="outline" size="sm">{strandTopics.length} topics</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {strandTopics.map((t) => (
                  <TopicCard
                    key={t.id}
                    topic={t}
                    row={masteryByTopic.get(t.id)}
                    href={onTopicHref?.(t.id)}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Foundation Literacy &amp; Numeracy domains</CardTitle>
            <p className="mt-0.5 text-[11px] text-ink-3">
              The national assessment checks these five areas in Grade 3. Anything not covered above is
              a gap in the plan, not a gap in the child.
            </p>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {FLN_DOMAINS.map((d) => {
              const mapped = topics.filter((t) => t.fln.includes(d.id));
              const covered = mapped.filter((t) => (masteryByTopic.get(t.id)?.mastery ?? 0) >= 0.7).length;
              return (
                <div key={d.id} className="rounded-control border p-3">
                  <p className="text-[11px] font-semibold text-ink">{d.name}</p>
                  <p className="mt-0.5 text-[10px] text-ink-4">{d.nameHi}</p>
                  <p className="mt-1.5 text-[10px] text-ink-3">
                    {covered} of {mapped.length} secure
                  </p>
                  <Progress
                    value={(covered / Math.max(1, mapped.length)) * 100}
                    tone={covered === mapped.length ? "good" : covered > 0 ? "warn" : "bad"}
                    className="mt-1"
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  progress,
  tone = "brand",
}: {
  label: string;
  value: number;
  sub: string;
  progress?: number;
  tone?: "brand" | "good" | "bad" | "warn";
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {progress !== undefined ? <Progress value={progress} tone={tone} className="mt-1.5" /> : null}
      <p className="mt-1 text-[10px] text-ink-4">{sub}</p>
    </Card>
  );
}

function TopicCard({ topic, row, href }: { topic: Topic; row?: CurriculumRow; href?: string }) {
  const mastery = row?.mastery;
  const assessed = mastery !== undefined;
  const depth = topicDepth(topic.id);

  return (
    <div className={cn("rounded-control border p-3", !assessed && "opacity-80")}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold leading-snug text-ink">{topic.name}</p>
        {assessed ? (
          mastery >= 0.7 ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-good" />
          ) : (
            <Circle className={cn("size-3.5 shrink-0", mastery < 0.5 ? "text-bad" : "text-warn")} />
          )
        ) : (
          <MinusCircle className="size-3.5 shrink-0 text-ink-4" />
        )}
      </div>
      <p className="mt-0.5 text-[10px] text-ink-4">{topic.nameHi}</p>
      {depth.tier > 0 ? (
        <p className="mt-1 text-[10px] leading-snug text-brand-ink">
          Also examined at {COMP_TIER_BY_ID.get(COMP_TIERS[depth.tier].id)?.label ?? `tier ${depth.tier}`} level
        </p>
      ) : null}
      <p className="mt-1.5 text-[10px] leading-snug text-ink-3">{topic.blurb}</p>
      <div className="mt-2 flex items-center gap-2">
        {assessed ? (
          <>
            <Progress value={mastery * 100} tone={mastery >= 0.7 ? "good" : mastery >= 0.5 ? "warn" : "bad"} className="flex-1" />
            <span className="text-[10px] font-semibold tabular-nums text-ink-3">{Math.round(mastery * 100)}%</span>
          </>
        ) : href ? (
          <Link href={href} className="inline-flex items-center gap-1 text-[10px] font-medium text-brand hover:underline">
            <BookOpen className="size-3" /> Make practice
          </Link>
        ) : (
          <span className="text-[10px] text-ink-4">Not assessed yet</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Competitive readiness                                                */
/* ------------------------------------------------------------------ */

/**
 * Which topics carry a competition paper, and where the class stands on them.
 *
 * This answers a different question from the rest of the map. The map above
 * asks "what has this class not understood"; this asks "if this class sat the
 * zone or the olympiad next term, which topics would decide it". A class can be
 * secure on everything the unit test covers and still be unready, because the
 * extra step in a competition question is not the same as the next bit of
 * syllabus.
 *
 * The honesty note is not decoration. The tier each topic reaches is a
 * structural interpretation written from domain knowledge, not a published
 * syllabus, and it varies by school. Saying so on the page is the difference
 * between a teacher correcting one column and a teacher distrusting the page.
 */
export function CompetitionPanel({
  grade,
  rows,
  target,
  hrefTemplate,
  overrides,
  canEdit,
}: {
  grade: number;
  rows: CurriculumRow[];
  target: number;
  hrefTemplate: string;
  overrides?: Map<string, DepthOverride>;
  canEdit?: boolean;
}) {
  const carried = competitionTopicsForClass(grade, target, overrides);
  const hrefFor = (t: number) => hrefTemplate.replace("{tier}", String(t));

  if (carried.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-[11px] text-ink-3">Competitive exams</p>
        <p className="mt-1 text-xs text-ink-2">
          Class {grade} is not yet examined on any topic that a competition paper turns on.
        </p>
      </Card>
    );
  }

  const masteryByTopic = new Map(rows.map((r) => [r.topicId, r]));
  const scored = carried.filter((t) => masteryByTopic.has(t.id));
  const ready = scored.filter((t) => (masteryByTopic.get(t.id)?.mastery ?? 0) >= 0.7);
  const building = scored.filter((t) => {
    const m = masteryByTopic.get(t.id)?.mastery ?? 0;
    return m >= 0.5 && m < 0.7;
  });
  const notStarted = carried.filter((t) => !masteryByTopic.has(t.id));

  const tierLabel = COMP_TIERS[target]?.label ?? "this level";

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-1.5">
            <Trophy className="size-3.5" /> Competitive exams
          </CardTitle>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {carried.length} of this class&apos;s topics are examined at {tierLabel} level. The rest of the
            syllabus still matters, but it is not what decides a competition paper.
          </p>
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {/* Level switcher. A link, not a select, so the choice survives a
            shared URL — a teacher comparing two levels with a colleague should
            both be looking at the same thing. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-3">Prepare for</span>
          {COMP_TIERS.filter((t) => t.tier > 0).map((t) => {
            const n = competitionTopicsForClass(grade, t.tier, overrides).length;
            return (
              <Link
                key={t.id}
                href={hrefFor(t.tier)}
                className={cn(
                  "rounded-control border px-2.5 py-1 text-[11px] font-medium transition-colors",
                  target === t.tier
                    ? "border-brand bg-brand-soft text-brand-ink"
                    : "border-line bg-surface text-ink-2 hover:border-ink-4",
                )}
              >
                {t.label}
                <span className="ml-1.5 text-[10px] opacity-70">{n}</span>
              </Link>
            );
          })}
        </div>

        {target > 0 && COMP_TIERS[target] ? (
          <p className="text-[11px] leading-relaxed text-ink-3">{COMP_TIERS[target].blurb}</p>
        ) : null}

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Stat label="Secure (70%+)" value={ready.length} sub="would hold up" tone="good" />
          <Stat label="Building (50–69%)" value={building.length} sub="close" tone="warn" />
          <Stat label="Not assessed" value={notStarted.length} sub="no evidence either way" />
          <Stat label="On this paper" value={carried.length} sub={`for Class ${grade}`} tone="brand" />
        </div>

        {/* The extra step, where there is one. This is the part a teacher cannot
            get from a textbook index, and the part that is a structural
            interpretation rather than a fact — so it is shown, and labelled. */}
        {notStarted.length > 0 ? (
          <div>
            <p className="text-[11px] font-semibold text-ink-2">Where the extra step is</p>
            <ul className="mt-1.5 space-y-1.5">
              {notStarted.slice(0, 8).map((t) => {
                const d = resolveDepth(t.id, overrides);
                return (
                  <li key={t.id} className="text-[11px] leading-snug text-ink-3">
                    <span className="font-medium text-ink-2">{t.name}</span>
                    {d.idea ? ` — ${d.idea}` : ""}
                    {d.overridden ? (
                      <span className="ml-1.5 text-[10px] text-brand-ink">
                        {d.note ? `${d.note} ` : ""}corrected here
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {notStarted.length > 8 ? (
              <p className="mt-1 text-[10px] text-ink-4">and {notStarted.length - 8} more.</p>
            ) : null}
          </div>
        ) : null}

        <p className="text-[10px] leading-relaxed text-ink-4">
          Which tier each topic reaches is a structural interpretation, not a published syllabus — it varies
          by board, by school and by year.{" "}
          {canEdit ? (
            <>
              Correct it below where you disagree; the change applies to this school only, so another
              school on the same server keeps this build&apos;s answer.
            </>
          ) : (
            <>Ask whoever administers this school to correct it where they disagree.</>
          )}
        </p>

        {canEdit ? <DepthEditor rows={carried} overrides={overrides} /> : null}
        {canEdit ? <DepthMapTransfer /> : null}
      </CardContent>
    </Card>
  );
}

/**
 * Taking the map away, and taking someone else's.
 *
 * The two sit together because they are the same file in both directions, and a
 * school that has corrected twenty topics will want to know it can keep them.
 * Without this, corrections live only in the database and vanish on reinstall —
 * which is the one outcome that makes the whole feature look like a bug.
 *
 * The import is additive on purpose; see `importDepthMap` for why a replace
 * would be the wrong default.
 */
function DepthMapTransfer() {
  const [state, formAction, pending] = useActionState<DepthState, FormData>(importDepthMap, null);

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-[11px] font-semibold text-ink-2">Take this map away, or take one on</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="secondary" size="sm">
          <a href="/api/depth-map" download>
            <Download className="size-3.5" /> Download our corrections
          </a>
        </Button>
        <span className="text-[10px] text-ink-4">
          No child&apos;s name is in this file. It contains only topic ids, levels and your reasons.
        </span>
      </div>

      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label>Another school&apos;s map</Label>
          <input
            type="file"
            name="file"
            accept="application/json,.json"
            required
            className="block w-full text-[11px] text-ink-2 file:mr-2 file:rounded-control file:border file:border-line file:bg-surface file:px-2 file:py-1 file:text-[11px] file:text-ink-2"
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Applying…" : "Apply on top of ours"}
        </Button>
      </form>

      {state?.error ? (
        <Alert tone={state.saved ? "info" : "bad"}>
          {state.error}
        </Alert>
      ) : null}
    </div>
  );
}

/**
 * Correcting the map, for an administrator.
 *
 * A `<details>` per topic rather than an always-open form for all sixty-odd of
 * them: the great majority are right, and sixty forms on one page would bury the
 * readouts they exist to correct. The school-level override is stated in the
 * button, because "editing the syllabus" is a thing a teacher will reasonably
 * assume changes it for everyone, and it does not.
 */
function DepthEditor({ rows, overrides }: { rows: Topic[]; overrides?: Map<string, DepthOverride> }) {
  return (
    <div className="space-y-1.5 border-t pt-3">
      <p className="text-[11px] font-semibold text-ink-2">Correct a level</p>
      {rows.map((t) => (
        <DepthEditorRow key={t.id} topic={t} resolved={resolveDepth(t.id, overrides)} />
      ))}
    </div>
  );
}

function DepthEditorRow({ topic, resolved }: { topic: Topic; resolved: ResolvedDepth }) {
  const [state, formAction, pending] = useActionState<DepthState, FormData>(saveTopicDepth, null);
  const bundled = topicDepth(topic.id);

  // Deliberately uncontrolled. The obvious version tracks `open` in state and
  // closes it from an effect when the save succeeds — which the React Compiler
  // lints as `set-state-in-effect`, correctly: an effect that flips state
  // synchronously causes a second render pass to do something an event handler
  // could have done directly. Worse, it is not needed. Saving revalidates the
  // path, so the server re-renders this row with the corrected tier, and an
  // uncontrolled <details> keeps its own open state across that — which is also
  // the better outcome, since the teacher can see the value they just saved.
  return (
    <details>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-control px-2 py-1.5 text-[11px] text-ink-2 hover:bg-surface-2">
        <span className="font-medium text-ink">{topic.name}</span>
        <span className="text-[10px] text-ink-4">{COMP_TIERS[resolved.tier]?.label ?? `Tier ${resolved.tier}`}</span>
        {resolved.overridden ? (
          <Badge tone="brand" size="sm">corrected here</Badge>
        ) : null}
        <Pencil className="ml-auto size-3 text-ink-4" />
      </summary>

      <form action={formAction} className="space-y-2 rounded-control border bg-surface-2 p-3">
        {state?.error ? <Alert tone="bad">{state.error}</Alert> : null}

        <input type="hidden" name="topicId" value={topic.id} />

        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40 space-y-1">
            <Label>Examined up to</Label>
            <Select name="tier" defaultValue={String(resolved.tier)}>
              {COMP_TIERS.map((t) => (
                <option key={t.tier} value={t.tier}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[12rem] flex-1 space-y-1">
            <Label>The extra step</Label>
            <Input
              name="idea"
              defaultValue={resolved.idea ?? ""}
              placeholder="What a child must learn beyond the classroom method"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Why (optional)</Label>
          <Input name="note" placeholder="e.g. our zone paper last year did not test this" />
        </div>

        <p className="text-[10px] text-ink-4">
          This build&apos;s bundled answer is &ldquo;{COMP_TIERS[bundled.tier]?.label}&rdquo;
          {bundled.idea ? ` — ${bundled.idea}` : "."}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save for this school"}
          </Button>
          {resolved.overridden ? (
            <form action={resetTopicDepth} className="contents">
              <input type="hidden" name="topicId" value={topic.id} />
              <Button type="submit" variant="ghost" size="sm">
                Reset to bundled
              </Button>
            </form>
          ) : null}
        </div>
      </form>
    </details>
  );
}
