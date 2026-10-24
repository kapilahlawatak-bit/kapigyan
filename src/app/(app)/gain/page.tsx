import Link from "next/link";
import { ArrowRight, CircleCheck, CircleSlash, Clock, HelpCircle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState } from "@/components/ui/primitives";
import { loadLearningGain, classesForGain } from "@/lib/analytics/learning-gain-data";
import type { TopicGain } from "@/lib/intelligence/learning-gain";

export const metadata = { title: "Did it work?" };
export const dynamic = "force-dynamic";

/**
 * "Did it work?"
 *
 * Every other page in this app tells a teacher what to do or what went wrong.
 * This one tells them whether it made a difference — which is the only thing
 * that tells a teacher whether their time was well spent, and the only thing
 * that lets a head teacher justify the system.
 *
 * The honesty rules are on the page, not hidden in a tooltip. A movement
 * between two test dates is not proof of causation, and the page says so where
 * a teacher will read it before quoting the number to a parent.
 */

const VERDICT_META: Record<
  TopicGain["verdict"],
  { label: string; tone: "good" | "bad" | "warn" | "neutral"; icon: typeof TrendingUp }
> = {
  worked: { label: "Improved", tone: "good", icon: TrendingUp },
  regressed: { label: "Went down", tone: "bad", icon: TrendingDown },
  no_change: { label: "No movement", tone: "warn", icon: Minus },
  untested_after: { label: "Not checked yet", tone: "neutral", icon: HelpCircle },
  not_enough_data: { label: "Too few children", tone: "neutral", icon: HelpCircle },
};

export default async function GainPage(props: PageProps<"/gain">) {
  const sp = await props.searchParams;
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await classesForGain(session);
  if (classes.length === 0) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Did it work?" titleHi="क्या फलदायी रहा?" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState
            icon={<TrendingUp className="size-5" />}
            title="No classes yet"
            description="Add a class and run a test to start measuring what your teaching changes."
            action={<Button asChild size="sm"><Link href="/classes">Add a class</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  const active = classes.find((c) => c.id === (sp.class ? String(sp.class) : undefined)) ?? classes[0]!;
  const loaded = await loadLearningGain(session, active.id, {
    weeks: sp.weeks ? Number(sp.weeks) : 12,
    sessionsPerWeek: sp.sessions ? Number(sp.sessions) : 4,
  });
  const feedback = loaded?.feedback;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Did it work?"
        titleHi="क्या फलदायी रहा?"
        description={`What changed on ${active.name}'s topics after they were taught, and which children did not move.`}
        locale={locale}
        actions={
          classes.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => (
                <Button key={c.id} asChild size="sm" variant={c.id === active.id ? "primary" : "secondary"}>
                  <Link href={`/gain?class=${c.id}`}>{c.name}</Link>
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="p-5 max-w-5xl w-full space-y-5">
        {!feedback || (loaded?.recorded ?? 0) === 0 ? (
          <Card>
            <EmptyState
              icon={<Clock className="size-5" />}
              title="Nothing recorded as taught yet"
              description="This page compares a topic's mastery before and after a lesson. Open the plan and tick off the sessions you have actually taught — from then on, each reassessment shows you what the teaching changed. It will not guess at dates it was not told."
              action={<Button asChild size="sm"><Link href="/plan">Open the plan</Link></Button>}
            />
          </Card>
        ) : !feedback || feedback.topics.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Clock className="size-5" />}
              title="Nothing to measure yet"
              description="This page compares a topic's mastery before and after it was taught. Once you have run a test, taught from the plan, and run a second one, it will show you what changed."
              action={<Button asChild size="sm"><Link href="/plan">Open the plan</Link></Button>}
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Stat label="Improved after teaching" value={feedback.counts.worked} tone="good" sub="moved up 10 points or more" />
              <Stat label="No movement" value={feedback.counts.noChange} tone="warn" sub="needs a different approach" />
              <Stat label="Not checked yet" value={feedback.counts.untested} sub="taught, never reassessed" />
              <Stat
                label="Children still stuck"
                value={new Set(feedback.stillStuck.map((s) => s.studentId)).size}
                sub="across all improved topics"
              />
            </div>

            <Alert tone="info" title="What this does and does not say">
              A change between two test dates is <em>not</em> proof that your teaching caused it. Between the two
              points the next paper may be easier, some children may be missing, the topic may have been
              covered again elsewhere. What this page can honestly claim is smaller and more useful: after
              this topic was taught, the class moved from {feedback.topics[0]?.before ?? 0}% to{" "}
              {feedback.topics[0]?.after ?? 0}% — and here is who moved and who did not.
            </Alert>

            {/* The actionable list comes first. */}
            {feedback.stillStuck.length > 0 ? (
              <Card>
                <CardHeader>
                  <p className="text-[13px] font-semibold text-ink">Children who are still weak after the teaching</p>
                  <Badge tone="warn" size="sm">{feedback.stillStuck.length} pairs</Badge>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-3 text-[11px] leading-relaxed text-ink-2">
                    A class average can improve while these children stand still. They are the ones who need
                    something other than the whole-class lesson — which is what{" "}
                    <Link href="/plan" className="font-medium text-brand hover:underline">the plan</Link>{" "}
                    builds its differentiation for.
                  </p>
                  <div className="space-y-1">
                    {feedback.stillStuck.map((s) => (
                      <Link
                        key={`${s.studentId}-${s.topicId}`}
                        href={`/students/${s.studentId}`}
                        className="flex items-center justify-between gap-3 rounded-control border px-3 py-2 hover:bg-surface-2"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-ink">{s.studentName}</span>
                          <span className="block truncate text-[10px] text-ink-4">{s.topicName}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-[11px] tabular-nums text-ink-3">{s.after}%</span>
                          <ArrowRight className="size-3 text-ink-4" />
                        </span>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <div className="space-y-2.5">
              {feedback.topics.map((t) => (
                <TopicCard key={t.topicId} t={t} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: "good" | "bad" | "warn" }) {
  const colour = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <Card className="p-4">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${colour}`}>{value}</p>
      <p className="mt-1 text-[10px] text-ink-4">{sub}</p>
    </Card>
  );
}

function TopicCard({ t }: { t: TopicGain }) {
  const meta = VERDICT_META[t.verdict];
  const Icon = meta.icon;
  const width = Math.min(100, Math.abs(t.gain));
  const showBar = t.verdict === "worked" || t.verdict === "regressed" || t.verdict === "no_change";

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ink">{t.topicName}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={meta.tone} size="sm"><Icon className="size-2.5" /> {meta.label}</Badge>
            <span className="text-[10px] text-ink-4">
              taught {new Date(t.taughtAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              {" · "}checked {t.daysSinceTaught} days later
            </span>
          </div>
        </div>
        {showBar ? (
          <div className="shrink-0 text-right">
            <p className={`text-lg font-bold tabular-nums ${t.gain >= 0 ? "text-good" : "text-bad"}`}>
              {t.gain > 0 ? "+" : ""}{t.gain}
            </p>
            <p className="text-[9px] text-ink-4">points</p>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="pt-0 space-y-2.5">
        {showBar ? (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="w-14 shrink-0 text-right tabular-nums text-ink-3">before {t.before}%</span>
            <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div
                className={`absolute inset-y-0 ${t.gain >= 0 ? "left-1/2 bg-good/60" : "right-1/2 bg-bad/60"}`}
                style={{ width: `${width / 2}%` }}
              />
              <div className="absolute inset-y-0 left-1/2 w-px bg-ink-4/50" />
            </div>
            <span className="w-14 shrink-0 tabular-nums text-ink-3">after {t.after}%</span>
          </div>
        ) : null}

        <p className="text-[11px] leading-relaxed text-ink-2">{t.note}</p>

        {t.childrenLost > 0 && t.verdict === "worked" ? (
          <p className="flex items-start gap-1.5 rounded bg-warn-soft/50 px-2.5 py-1.5 text-[10px] leading-relaxed text-ink-2">
            <CircleSlash className="mt-0.5 size-3 shrink-0 text-warn" />
            {t.childrenLost} {t.childrenLost === 1 ? "child was" : "children were"} assessed before but not after.
            A weaker average can rise simply by testing fewer of them.
          </p>
        ) : null}

        <p className="text-[10px] text-ink-4">
          {t.childrenAfter} of {t.childrenBefore} children assessed on both sides
        </p>
      </CardContent>
    </Card>
  );
}
