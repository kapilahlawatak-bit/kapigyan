import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleDashed, Sparkles, Split, Target } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { analyseDistractors, type DistractorAnalysis, type DistractorVerdict } from "@/lib/analytics/distractors";
import { MISCONCEPTION_BY_ID } from "@/lib/curriculum";
import { STRAND_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";

export const metadata = { title: "Question Quality" };
export const dynamic = "force-dynamic";

/**
 * Question quality.
 *
 * This is the page that makes the marks trustworthy, and it is the one a
 * teacher should be suspicious of until they have read it.
 *
 * A wrong answer is ambiguous. It can mean the child does not know the idea,
 * or that the question is badly worded, or that the child misread it. The
 * marks cannot tell those apart, and neither can a success rate. What *can*
 * tell them apart is the shape of the wrong answers: if the class converges
 * on one option, either that option is a real misconception (the question is
 * working) or the wording is broken (the question is not). If the wrong
 * answers scatter, the question is measuring something other than what it
 * claims to and should be rewritten or dropped.
 *
 * So the page sorts questions by whether they are earning their place, and
 * says in plain words what to do about each one.
 */

const VERDICT_META: Record<
  DistractorVerdict,
  { label: string; tone: "bad" | "warn" | "good" | "neutral"; icon: typeof Target; blurb: string }
> = {
  flawed: { label: "Suspect wording", tone: "bad", icon: AlertTriangle, blurb: "The class converges on one wrong answer that no option was written to catch." },
  diagnosing: { label: "Diagnosing", tone: "good", icon: Target, blurb: "The class converges on a distractor built for a real misconception. Keep this." },
  noisy: { label: "Not diagnostic", tone: "warn", icon: Split, blurb: "The wrong answers are scattered. This question is not telling you what it claims to." },
  working: { label: "Mastered", tone: "good", icon: CheckCircle2, blurb: "The class has this one." },
  not_enough_data: { label: "Not enough data", tone: "neutral", icon: CircleDashed, blurb: "Too few answers to judge." },
};

export default async function QualityPage(props: PageProps<"/quality">) {
  const sp = await props.searchParams;
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await prisma.class.findMany({
    where: {
      schoolId: session.schoolId,
      ...(session.role === "TEACHER" && session.mode !== "HOME" ? { teacherId: session.userId } : {}),
    },
    include: { enrollments: { select: { studentId: true } }, _count: { select: { papers: true } } },
    orderBy: { name: "asc" },
  });

  if (classes.length === 0) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Question Quality" titleHi="प्रश्न गुणवत्ता" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState
            icon={<Target className="size-5" />}
            title="No classes yet"
            description="Mark a test and this page will tell you which of your questions are actually working."
            action={<Button asChild size="sm"><Link href="/classes">Add a class</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  const active = classes.find((c) => c.id === (sp.class ? String(sp.class) : undefined)) ?? classes[0]!;
  const marked = await prisma.paper.findMany({
    where: { classId: active.id, submissions: { some: { status: "GRADED" } } },
    select: { id: true, title: true, date: true },
    orderBy: { date: "desc" },
  });

  // Analyse the most recent paper that has enough answers to say anything.
  const analyses: DistractorAnalysis[] = [];
  for (const paper of marked) {
    const questions = await prisma.paperQuestion.findMany({
      where: { paperId: paper.id },
      select: { id: true },
      orderBy: { position: "asc" },
    });
    for (const q of questions) {
      const a = await analyseDistractors(paper.id, q.id);
      if (a) analyses.push(a);
    }
  }

  const judged = analyses.filter((a) => a.verdict !== "not_enough_data");
  const diagnosing = analyses.filter((a) => a.verdict === "diagnosing");
  const suspect = analyses.filter((a) => a.verdict === "flawed");
  const noisy = analyses.filter((a) => a.verdict === "noisy");

  // Ordered by what is worth fixing first.
  const order: DistractorVerdict[] = ["flawed", "noisy", "diagnosing", "working", "not_enough_data"];
  const ordered = [...analyses].sort(
    (a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || a.successRate - b.successRate,
  );

  const filter = sp.verdict ? String(sp.verdict) : "";
  const shown = filter ? ordered.filter((a) => a.verdict === filter) : ordered;

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Question Quality"
        titleHi="प्रश्न गुणवत्ता"
        description={`Which questions on ${active.name}'s marked papers are earning their place, and which are misleading you.`}
        locale={locale}
        actions={
          classes.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {classes.map((c) => (
                <Button key={c.id} asChild size="sm" variant={c.id === active.id ? "primary" : "secondary"}>
                  <Link href={`/quality?class=${c.id}`}>{c.name}</Link>
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="p-5 max-w-5xl w-full space-y-5">
        {analyses.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Target className="size-5" />}
              title="Nothing to judge yet"
              description="Mark a test and this page will check every question against how the class actually answered it."
              action={<Button asChild size="sm"><Link href="/tests">Go to tests</Link></Button>}
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
              <Stat label="Questions judged" value={judged.length} sub={`of ${analyses.length} on marked papers`} />
              <Stat
                label="Working as intended"
                value={diagnosing.length}
                sub="finding a real misconception"
                tone="good"
                pct={judged.length ? (diagnosing.length / judged.length) * 100 : 0}
              />
              <Stat
                label="Suspect wording"
                value={suspect.length}
                sub="same wrong answer, no cause"
                tone="bad"
                pct={judged.length ? (suspect.length / judged.length) * 100 : 0}
              />
              <Stat
                label="Not diagnostic"
                value={noisy.length}
                sub="wrong answers scattered"
                tone="warn"
                pct={judged.length ? (noisy.length / judged.length) * 100 : 0}
              />
            </div>

            <Alert
              tone="info"
              title="What this page is for"
            >
              A wrong answer is ambiguous: it can mean the child has not understood, or that the question is
              badly written, or that they misread it. The marks cannot tell those apart. What can is the
              <em> shape</em> of the wrong answers — if the class converges on one option, there is one thing
              to fix, and this page tells you whether that thing is the child or the question.
            </Alert>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-ink-3">Show</span>
              {(["", ...order] as const).map((v) => (
                <Button
                  key={v || "all"}
                  asChild
                  size="sm"
                  variant={v === filter ? "primary" : "secondary"}
                >
                  <Link href={`/quality?class=${active.id}${v ? `&verdict=${v}` : ""}`}>
                    {v ? VERDICT_META[v].label : "All"}
                  </Link>
                </Button>
              ))}
            </div>

            <div className="space-y-2.5">
              {shown.map((a) => (
                <QuestionCard key={`${a.paperId}-${a.questionId}`} a={a} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, sub, tone, pct,
}: {
  label: string; value: number; sub: string;
  tone?: "good" | "bad" | "warn"; pct?: number;
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] text-ink-3">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</p>
      {pct !== undefined ? <Progress value={pct} tone={tone} className="mt-1.5" /> : <div className="h-[6px]" />}
      <p className="mt-1 text-[10px] text-ink-4">{sub}</p>
    </Card>
  );
}

function QuestionCard({ a }: { a: DistractorAnalysis }) {
  const meta = VERDICT_META[a.verdict];
  const Icon = meta.icon;
  const strand = TOPIC_BY_ID.get(a.topicId ?? "")?.strand;
  const worst = a.options.filter((o) => !o.isKey).sort((p, q) => q.chosen - p.chosen)[0];

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <p className="text-[12px] font-medium leading-snug text-ink">{a.stem}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={meta.tone} size="sm">
              <Icon className="size-2.5" /> {meta.label}
            </Badge>
            <Badge tone="outline" size="sm">{a.topicName}</Badge>
            {strand ? (
              <span className="flex items-center gap-1 text-[10px] text-ink-4">
                <span className="size-1.5 rounded-full" style={{ background: STRAND_BY_ID.get(strand)?.color }} />
                {STRAND_BY_ID.get(strand)?.name}
              </span>
            ) : null}
            <span className="text-[10px] text-ink-4">
              {a.correct}/{a.responses - a.blank} correct
              {a.blank > 0 ? ` · ${a.blank} blank` : ""}
            </span>
          </div>
        </div>
        <Link
          href={`/tests/${a.paperId}/analysis`}
          className="shrink-0 text-[10px] font-medium text-brand hover:underline"
        >
          Paper
        </Link>
      </CardHeader>

      <CardContent className="space-y-2.5 pt-0">
        <p className="text-[11px] leading-relaxed text-ink-2">{a.verdictNote}</p>

        {a.isMcq && a.options.length > 0 ? (
          <div className="space-y-1">
            {a.options.map((o) => {
              const width = Math.round(o.share * 100);
              const isWorst = worst && o.key === worst.key && o.chosen > 0;
              return (
                <div key={o.key} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 truncate text-[10px] text-ink-3">
                    <span className="font-semibold">{o.key}</span> {o.label}
                  </span>
                  <div className="relative h-4 min-w-0 flex-1 overflow-hidden rounded bg-surface-2">
                    <div
                      className={o.isKey ? "absolute inset-y-0 left-0 bg-good/60" : isWorst ? "absolute inset-y-0 left-0 bg-bad/50" : "absolute inset-y-0 left-0 bg-ink-4/25"}
                      style={{ width: `${Math.max(width, o.chosen > 0 ? 3 : 0)}%` }}
                    />
                    <span className="relative flex h-full items-center px-1.5 text-[9px] font-semibold tabular-nums text-ink-2">
                      {o.chosen}
                    </span>
                  </div>
                  {o.isKey ? (
                    <span className="w-14 shrink-0 text-[9px] font-semibold text-good">key</span>
                  ) : o.misconceptionName ? (
                    <span className="w-40 shrink-0 truncate text-[9px] text-ink-4" title={o.misconceptionName}>
                      {o.misconceptionName}
                    </span>
                  ) : (
                    <span className="w-40 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        ) : a.topWrongResponse ? (
          <div className="rounded-control border p-2.5">
            <p className="text-[10px] text-ink-3">Most common wrong answer</p>
            <p className="mt-0.5 font-mono text-[12px] text-ink">{a.topWrongResponse.response}</p>
            <p className="text-[10px] text-ink-4">
              {a.topWrongResponse.count} children ({Math.round(a.topWrongResponse.share * 100)}% of all wrong answers)
            </p>
          </div>
        ) : null}

        {a.verdict === "flawed" && worst?.misconceptionId ? (
          <p className="rounded bg-warn-soft/50 px-2.5 py-1.5 text-[10px] leading-relaxed text-ink-2">
            Option {worst.key} is authored to catch{" "}
            <span className="font-semibold">{MISCONCEPTION_BY_ID.get(worst.misconceptionId)?.name}</span>,
            so the convergence may be a real misconception rather than bad wording. Check a few scripts
            before rewriting the question.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
