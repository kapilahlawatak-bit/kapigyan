import Link from "next/link";
import { AlertTriangle, ArrowRight, Brain, Lightbulb, Users, Wrench } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import {
  MISCONCEPTION_BY_ID, STRANDS, STRAND_GAP_THRESHOLD, TOPIC_GAP_THRESHOLD, STRAND_BY_ID, TOPIC_BY_ID,
} from "@/lib/curriculum";
import { recommendTeaching, type TopicStat } from "@/lib/intelligence/recommendations";
import { assessRisk } from "@/lib/intelligence/mastery";
import { classMasteryMap, studentMasteryMap, errorHistory } from "@/lib/analytics/class";
import { asArray, meanMastery, riskFor, classTopicStats } from "@/lib/analytics/view";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { StrandRadar, MasteryBars, ScoreTrend } from "@/components/charts";
import { cn, topicName, strandColor } from "@/lib/utils";

export const metadata = { title: "Insights" };
export const dynamic = "force-dynamic";

/**
 * Insights.
 *
 * This is the page that answers the question the user actually asked — "where
 * is each student lacking, what mistakes do they keep making, and how do I
 * manage that". Everything here is derived from marked papers, not from what a
 * teacher remembered typing in.
 */
export default async function InsightsPage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId, ...(session.role === "TEACHER" ? { teacherId: session.userId } : {}) },
    orderBy: { grade: "asc" },
    include: { _count: { select: { enrollments: true } } },
  });

  const cls = classes[0];

  if (!cls) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Insights" titleHi="विश्लेषण" locale={locale} />
        <Card className="m-5 max-w-2xl">
          <EmptyState
            icon={<Brain className="size-5" />}
            title="Nothing to analyse yet"
            description="Create a class, add your students, upload a test and mark it. The insights build themselves from the answers."
            action={<Button asChild size="sm"><Link href="/tests/new">Upload a test</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  const [classMastery, students] = await Promise.all([
    classMasteryMap(cls.id),
    prisma.student.findMany({
      where: { enrollments: { some: { classId: cls.id } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, rollNo: true },
    }),
  ]);

  const evidence = await prisma.answer.findMany({
    where: { submission: { paper: { classId: cls.id } } },
    select: { isCorrect: true, marksAwarded: true, maxMarks: true, response: true },
  });

  // Aggregate misconception counts across the whole class history.
  // Misconceptions and question counts, keyed by topic. Both feed the
  // recommendation ranker, which will not act on a topic it has no evidence
  // for and will not attach an unrelated topic's dominant error to a lesson.
  const [errorRows, questionRows] = await Promise.all([
    prisma.answer.groupBy({
      by: ["errorTag", "paperQuestionId"],
      where: { submission: { paper: { classId: cls.id } }, errorTag: { not: null } },
      _count: { _all: true },
    }),
    prisma.paperQuestion.groupBy({
      by: ["topicId"],
      where: { topicId: { not: null }, paper: { classId: cls.id } },
      _count: { _all: true },
    }),
  ]);

  const topicQuestions = await prisma.paperQuestion.findMany({
    where: { topicId: { not: null }, paper: { classId: cls.id } },
    select: { id: true, topicId: true },
  });
  const topicByQuestion = new Map(topicQuestions.map((q) => [q.id, q.topicId as string]));

  const mcByTopic = new Map<string, Record<string, number>>();
  for (const row of errorRows) {
    if (!row.errorTag) continue;
    const topicId = topicByQuestion.get(row.paperQuestionId);
    if (!topicId) continue;
    const bag = mcByTopic.get(topicId) ?? {};
    bag[row.errorTag] = (bag[row.errorTag] ?? 0) + row._count._all;
    mcByTopic.set(topicId, bag);
  }

  const questionsPerTopic: Record<string, number> = {};
  for (const row of questionRows) {
    if (row.topicId) questionsPerTopic[row.topicId] = row._count._all;
  }

  // Class-wide roll-up, for the "what we keep getting wrong" panel.
  const mcTotals = new Map<string, number>();
  for (const bag of mcByTopic.values()) {
    for (const [id, n] of Object.entries(bag)) {
      mcTotals.set(id, (mcTotals.get(id) ?? 0) + n);
    }
  }

  const topicStats: TopicStat[] = classTopicStats(
    classMastery,
    Object.fromEntries(mcByTopic),
    questionsPerTopic,
  );

  const recommendations = recommendTeaching(topicStats, { maxRecommendations: 3 });

  // Strand roll-up
  const strandRows = STRANDS.map((s) => {
    const rows = classMastery.filter((m) => TOPIC_BY_ID.get(m.topicId)?.strand === s.id);
    const avg = meanMastery(rows);
    return {
      id: s.id,
      name: s.name,
      nameHi: s.nameHi,
      color: s.color,
      mastery: Math.round(avg * 100),
      topics: rows.length,
      gapped: avg < STRAND_GAP_THRESHOLD / 100,
    };
  });

  // Per-student risk
  const riskRows = await Promise.all(
    students.map(async (s) => {
      const m = await studentMasteryMap(s.id, cls.id);
      const rows = asArray(m);
      return {
        ...s,
        risk: riskFor(m),
        weak: rows.filter((x) => x.mastery < 0.6).slice(0, 3),
      };
    }),
  );
  const atRisk = riskRows.filter((r) => r.risk.level !== "low").sort((a, b) => b.risk.score - a.risk.score);

  const trend = await prisma.submission.findMany({
    where: { paper: { classId: cls.id }, status: "GRADED" },
    include: { paper: { select: { title: true, date: true } } },
    orderBy: { paper: { date: "asc" } },
  });
  const trendByTest = new Map<string, number[]>();
  for (const t of trend) {
    if (t.maxScore > 0) {
      const arr = trendByTest.get(t.paper.title) ?? [];
      arr.push((t.score / t.maxScore) * 100);
      trendByTest.set(t.paper.title, arr);
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Insights"
        titleHi="विश्लेषण"
        description={`Everything below is built from ${evidence.length} marked answers in ${cls.name}.`}
        locale={locale}
      />

      <div className="p-5 max-w-[1400px] w-full space-y-5">
        {/* Class overview */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div>
                <CardTitle>How the class is doing, strand by strand</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Mastery blends this child&apos;s own answers with the class average, so one lucky answer never
                  reads as mastery.
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <StrandRadar data={strandRows.map((s) => ({ strand: s.name, percent: s.mastery }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Strands needing attention</CardTitle></CardHeader>
            <CardContent className="space-y-2.5 pt-0">
              {strandRows.map((s) => (
                <div key={s.id}>
                  <div className="flex items-baseline justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-ink-2">
                      <span className="size-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </span>
                    <span className={cn("font-semibold tabular-nums", s.gapped ? "text-bad" : s.mastery >= 70 ? "text-good" : "text-warn")}>
                      {s.mastery}%
                    </span>
                  </div>
                  <Progress value={s.mastery} tone={s.gapped ? "bad" : s.mastery >= 70 ? "good" : "warn"} className="mt-1" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Recommendations */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Lightbulb className="size-4 text-warn" />
            <h2 className="text-base font-semibold text-ink">What to teach, in order</h2>
            <Badge tone="neutral" size="sm">ranked by severity × how many children × how much teaching helps</Badge>
          </div>

          {recommendations.length === 0 ? (
            <Card><EmptyState icon={<Lightbulb className="size-5" />} title="No gaps to close" description="Mark a test and recommendations will appear here automatically." /></Card>
          ) : (
            <div className="space-y-3">
              {recommendations.map((r, i) => (
                <Card key={r.topicId} className={i === 0 ? "border-brand/40" : ""}>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">{i + 1}</span>
                      <CardTitle>{r.topicName}</CardTitle>
                      <Badge tone="neutral" size="sm">{r.strandName}</Badge>
                      {r.dominantMisconception ? <Badge tone="bad" size="sm">{r.dominantMisconception.name}</Badge> : null}
                      <Badge tone={r.priority >= 60 ? "bad" : r.priority >= 30 ? "warn" : "neutral"} size="sm">
                        priority {Math.round(r.priority)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs leading-relaxed text-ink-2">{r.why}</p>

                    {r.dominantMisconception ? (
                      <div className="rounded-control border border-bad/25 bg-bad-soft/30 p-3.5">
                        <p className="text-[11px] font-semibold text-bad">{r.dominantMisconception.name}</p>
                        <p className="mt-1 text-[11px] italic text-ink-2">“{r.dominantMisconception.belief}”</p>
                        <ol className="mt-2 list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-ink-2">
                          {r.dominantMisconception.remediation.map((step) => <li key={step}>{step}</li>)}
                        </ol>
                        <p className="mt-2 text-[10px] text-ink-3">
                          <Wrench className="mr-1 inline size-3" />
                          Strategy: {r.dominantMisconception.strategy}
                        </p>
                      </div>
                    ) : null}

                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold text-ink-2">Lesson plan ({r.lesson.minutes} minutes)</p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        {r.lesson.steps.map((st) => (
                          <div key={st.title} className="rounded-[0.5rem] border bg-surface p-2.5">
                            <p className="text-[9px] font-bold uppercase tracking-wide text-brand-ink">{st.phase} · {st.minutes}m</p>
                            <p className="mt-1 text-[11px] font-semibold text-ink leading-snug">{st.title}</p>
                            <p className="mt-1 text-[10px] leading-snug text-ink-3">{st.do}</p>
                            <p className="mt-1.5 text-[9px] text-ink-4">Say: “{st.say}”</p>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-ink-3">
                        <strong className="text-ink-2">Check for understanding:</strong> {r.lesson.successCheck}
                      </p>
                      <p className="mt-1 text-[10px] text-ink-3">
                        <strong className="text-ink-2">Materials:</strong>{" "}
                        {[...new Set(r.lesson.steps.map((s) => s.materials))].join(", ")}
                      </p>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3 border-t pt-3">
                      {([
                        ["For children who struggle", r.lesson.differentiation.struggling],
                        ["For children on track", r.lesson.differentiation.onTrack],
                        ["For children who need more", r.lesson.differentiation.advanced],
                      ] as [string, string][]).map(([label, text]) => (
                        <div key={label}>
                          <p className="text-[10px] font-semibold text-ink-2">{label}</p>
                          <p className="mt-0.5 text-[10px] leading-snug text-ink-3">{text}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* At risk */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5">
                <Users className="size-3.5" /> Children who need a conversation
              </CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Ranked by risk, not by last mark. A child can score 70% and still be slipping.
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {atRisk.length === 0 ? (
              <EmptyState
                icon={<Users className="size-5" />}
                title="No child is flagged"
                description={evidence.length === 0 ? "Mark a test to start seeing this." : "Every child is currently on track."}
              />
            ) : (
              <div className="space-y-2">
                {atRisk.slice(0, 8).map((r) => (
                  <Link key={r.id} href={`/students/${r.id}`} className="flex items-start gap-3 rounded-control border p-3 hover:border-brand transition-colors">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-bold text-ink-3">
                      {r.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-xs font-semibold text-ink">{r.name}</p>
                        <Badge tone={r.risk.level === "high" ? "bad" : "warn"} size="sm">{r.risk.level}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-3">{r.risk.reasons[0]}</p>
                      {r.weak.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {r.weak.map((w) => (
                            <Badge key={w.topicId} tone="neutral" size="sm">{topicName(w.topicId)} {Math.round(w.mastery * 100)}%</Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <ArrowRight className="mt-1 size-3.5 shrink-0 text-ink-4" />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recurring misconceptions */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>What the class keeps getting wrong</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Named errors, not just wrong answers — each one with the fix.
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {mcTotals.size === 0 ? (
              <EmptyState icon={<AlertTriangle className="size-5" />} title="No errors detected yet" description="Once a test is marked with topic tags, recurring errors show up here." />
            ) : (
              <div className="grid gap-2.5 md:grid-cols-2">
                {[...mcTotals.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([id, count]) => {
                    const m = MISCONCEPTION_BY_ID.get(id);
                    if (!m) return null;
                    return (
                      <div key={id} className="rounded-control border p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-ink">{m.name}</p>
                          <Badge tone="bad" size="sm">× {count}</Badge>
                        </div>
                        <p className="mt-1 text-[10px] italic text-ink-3">“{m.belief}”</p>
                        <ul className="mt-2 space-y-1">
                          {m.remediation.slice(0, 2).map((r) => (
                            <li key={r} className="flex gap-1.5 text-[10px] leading-snug text-ink-2">
                              <span className="text-brand">→</span>{r}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trend */}
        {trendByTest.size > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>Class trend across tests</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ScoreTrend
                data={[...trendByTest.entries()].map(([name, arr]) => ({
                  label: name.length > 18 ? `${name.slice(0, 18)}…` : name,
                  percent: arr.reduce((a, b) => a + b, 0) / arr.length,
                }))}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
