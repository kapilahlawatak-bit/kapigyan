import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronLeft, Download, Lightbulb, Printer } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { analysePaper, buildHeatmap, competencySpread } from "@/lib/analytics/class";
import { exportLinks } from "@/lib/paper/exports";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress, Table, TBody, TD, TH, THead, TR, Alert } from "@/components/ui/primitives";
import { BandDistribution, Heatmap, TopicBarChart } from "@/components/charts";
import { MISCONCEPTION_BY_ID, STRAND_BY_ID, TOPIC_GAP_THRESHOLD, gradeBand } from "@/lib/curriculum";
import { recommendTeaching, type TopicStat } from "@/lib/intelligence/recommendations";
import { formatDate, topicName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AnalysisPage(props: PageProps<"/tests/[id]/analysis">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const analysis = await analysePaper(id);
  if (!analysis || analysis.classId === undefined) notFound();
  if (analysis.studentCount === 0) notFound();

  const paper = await prisma.paper.findUnique({
    where: { id },
    select: { schoolId: true, title: true },
  });
  if (!paper || paper.schoolId !== session.schoolId) notFound();

  const heatmap = analysis.classId ? await buildHeatmap({ paperId: id }) : null;

  const topicStats: TopicStat[] = analysis.topics.map((t) => ({
    topicId: t.topicId,
    mastery: t.averagePercent / 100,
    studentsWeak: Math.round((t.averagePercent < TOPIC_GAP_THRESHOLD * 100 ? t.studentsAssessed : t.studentsAssessed * 0.4)),
    studentsAssessed: t.studentsAssessed,
    questionsOnPaper: t.questions,
    misconceptionCounts: Object.fromEntries(t.misconceptions.map((m) => [m.id, m.count])),
  }));
  const recommendations = recommendTeaching(topicStats, { maxRecommendations: 2 });
  const spread = competencySpread(analysis.questions);

  // The misunderstanding behind the wrong answers, in one place, ordered by
  // how many children it cost. A teacher does not need "18 errors on Q7" —
  // they need "18 children do not yet believe that × means equal groups",
  // and then what to do about it on Monday morning.
  const found = new Map<string, { count: number; students: Set<string>; topics: Set<string> }>();
  for (const t of analysis.topics) {
    for (const m of t.misconceptions) {
      const e = found.get(m.id) ?? { count: 0, students: new Set<string>(), topics: new Set<string>() };
      e.count += m.count;
      e.topics.add(t.name);
      found.set(m.id, e);
    }
  }
  const diagnosisCards = [...found.entries()]
    .map(([id, e]) => ({ id, meta: MISCONCEPTION_BY_ID.get(id), ...e }))
    .filter((d) => d.meta)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="flex flex-col">
      <PageHeader
        title={`Analysis: ${analysis.title}`}
        description={`${analysis.gradedCount} students · class average ${analysis.averagePercent}% · ${formatDate(analysis.date, true)}`}
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/tests/${id}`}><ChevronLeft className="size-3.5" /> Test</Link>
            </Button>
            {exportLinks(id).slice(0, 3).map((l) => (
              <Button key={l.kind} asChild variant="secondary" size="sm">
                <a href={l.href}><Download className="size-3.5" /> {l.label}</a>
              </Button>
            ))}
          </>
        }
      />

      <div className="p-5 max-w-[1400px] w-full space-y-5">
        {/* Summary */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Class average</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{analysis.averagePercent}%</p>
            <Badge tone={analysis.averagePercent >= 70 ? "good" : analysis.averagePercent >= 45 ? "warn" : "bad"} size="sm" className="mt-1.5">
              {gradeBand(analysis.averagePercent).label}
            </Badge>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Median</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{analysis.medianPercent}%</p>
            <p className="mt-1.5 text-[10px] text-ink-4">Half the class is above this</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Highest</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {analysis.highest ? `${Math.round(analysis.highest.percent)}%` : "—"}
            </p>
            <p className="mt-1.5 truncate text-[10px] text-ink-4">{analysis.highest?.name}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Lowest</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {analysis.lowest ? `${Math.round(analysis.lowest.percent)}%` : "—"}
            </p>
            <p className="mt-1.5 truncate text-[10px] text-ink-4">{analysis.lowest?.name}</p>
          </Card>
        </div>

        {analysis.needsReviewCount > 0 ? (
          <Alert tone="warn" title={`${analysis.needsReviewCount} answers still need your judgement`} icon={<AlertTriangle className="size-3.5" />}>
            Long answers are never marked automatically. Open the test and review them.
          </Alert>
        ) : null}

        {/* Teach this next */}
        {recommendations.length > 0 ? (
          <Card className="border-brand/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <Lightbulb className="size-3.5 text-warn" />
                What to teach next
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recommendations.map((r, i) => (
                <div key={r.topicId} className="rounded-control border bg-surface-2/40 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">{i + 1}</span>
                    <p className="text-sm font-semibold text-ink">{r.topicName}</p>
                    <Badge tone="neutral" size="sm">{r.strandName}</Badge>
                    {r.dominantMisconception ? (
                      <Badge tone="bad" size="sm">{r.dominantMisconception.name}</Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-2">{r.why}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {r.lesson.steps.map((st) => (
                      <div key={st.title} className="rounded-[0.5rem] border bg-surface p-2.5">
                        <p className="text-[9px] font-bold uppercase tracking-wide text-brand-ink">
                          {st.phase} · {st.minutes} min
                        </p>
                        <p className="mt-1 text-[11px] font-semibold text-ink leading-snug">{st.title}</p>
                        <p className="mt-1 text-[10px] leading-snug text-ink-3">{st.do}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {/* Topic bars + distribution */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Topic by topic</CardTitle>
              <p className="text-[11px] text-ink-3">Weakest first. The dashed line is the gap line.</p>
            </CardHeader>
            <CardContent className="pt-0">
              <TopicBarChart
                data={analysis.topics.map((t) => ({ name: t.name, percent: t.correctRate, strand: t.strand, questions: t.questions }))}
              />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Grade spread</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <BandDistribution
                  data={Object.entries(analysis.bandCounts).map(([band, count]) => ({ band, count }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Competency spread</CardTitle></CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {spread.map((s) => (
                  <div key={s.level}>
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="text-ink-2 capitalize">{s.level}</span>
                      <span className="font-semibold tabular-nums text-ink-3">{s.percent}% got it</span>
                    </div>
                    <Progress value={s.percent} tone={s.percent >= 70 ? "good" : s.percent >= 45 ? "warn" : "bad"} className="mt-1" />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Heatmap */}
        {heatmap && heatmap.students.length > 0 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Class heatmap</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Every child against every topic. Hover a cell for the detail. Prints in black and white.
                </p>
              </div>
              <Button asChild variant="ghost" size="sm">
                <a href={`/api/papers/${id}/export/pdf`}><Printer className="size-3.5" /> Print</a>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              <Heatmap data={heatmap} />
            </CardContent>
          </Card>
        ) : null}

        {/* What is going wrong, and how to fix it */}
        {diagnosisCards.length > 0 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>What the class is getting wrong, and how to fix it</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  Each card is a belief the class walked in with, inferred from what they actually
                  wrote — not a guess from the question topic. Ordered by how many answers it cost.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {diagnosisCards.map(({ id, meta, count, topics }) => (
                <div key={id} className="rounded-control border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink">{meta!.name}</p>
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        Seen on {topics.size} {topics.size === 1 ? "topic" : "topics"}: { [...topics].join(", ")}
                      </p>
                    </div>
                    <Badge tone="bad" size="lg">{count} wrong {count === 1 ? "answer" : "answers"}</Badge>
                  </div>

                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    <div className="rounded bg-danger-soft/60 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-bad">The belief behind it</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{meta!.belief}</p>
                      <p className="mt-2 text-[10px] text-ink-4">Looks like: {meta!.evidence}</p>
                    </div>
                    <div className="rounded bg-good-soft/60 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-good">How to manage it</p>
                      <ol className="mt-1 space-y-1">
                        {meta!.remediation.map((step, i) => (
                          <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-2">
                            <span className="font-semibold text-ink-3">{i + 1}.</span>{step}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-2 text-[10px] italic text-ink-4">Method: {meta!.strategy}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {/* Topic detail table */}
        <Card>
          <CardHeader>
            <CardTitle>Where the class is losing marks</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <THead>
                <tr>
                  <TH>Topic</TH><TH>Strand</TH><TH>Q</TH>
                  <TH className="text-right">Correct</TH>
                  <TH className="text-right">Not attempted</TH>
                  <TH>Most common wrong idea</TH>
                </tr>
              </THead>
              <TBody>
                {analysis.topics.map((t) => (
                  <TR key={t.topicId}>
                    <TD className="font-medium text-ink">{t.name}</TD>
                    <TD>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2 rounded-full" style={{ background: STRAND_BY_ID.get(t.strand)?.color }} />
                        {STRAND_BY_ID.get(t.strand)?.name ?? t.strand}
                      </span>
                    </TD>
                    <TD className="tabular-nums">{t.questions}</TD>
                    <TD className="text-right">
                      <span className={cn2(t.correctRate)}>{t.correctRate}%</span>
                    </TD>
                    <TD className="text-right tabular-nums">{t.blankRate}%</TD>
                    <TD>
                      {t.misconceptions[0] ? (
                        <span>
                          <Badge tone="bad" size="sm">{MISCONCEPTION_BY_ID.get(t.misconceptions[0].id)?.name ?? t.misconceptions[0].id}</Badge>{" "}
                          <span className="text-[10px] text-ink-4">× {t.misconceptions[0].count}</span>
                        </span>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        {/* Question level */}
        <Card>
          <CardHeader>
            <CardTitle>Question by question</CardTitle>
            <p className="text-[11px] text-ink-3">Including what the class actually wrote — the fastest way to spot a badly worded question.</p>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <THead>
                <tr>
                  <TH>#</TH><TH>Question</TH><TH>Topic</TH><TH>Key</TH>
                  <TH className="text-right">Got right</TH><TH>What the class wrote instead</TH>
                </tr>
              </THead>
              <TBody>
                {analysis.questions.map((q) => (
                  <TR key={q.questionId}>
                    <TD className="tabular-nums text-ink-4">{q.position}</TD>
                    <TD className="max-w-[26rem]">
                      <span className="line-clamp-2 text-ink">{q.stem}</span>
                    </TD>
                    <TD className="whitespace-nowrap">{topicName(q.topicId)}</TD>
                    <TD className="font-mono text-[11px] text-ink-2">{q.answerKey}</TD>
                    <TD className="text-right">
                      <span className={cn2(q.successRate)}>{q.successRate}%</span>
                      <span className="ml-1 text-[10px] text-ink-4">({q.blank} blank)</span>
                    </TD>
                    <TD>
                      {q.topWrong.length === 0 ? (
                        <span className="text-ink-4">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {q.topWrong.slice(0, 3).map((w) => (
                            <Badge key={w.response} tone="neutral" size="sm" title={`${w.percentage}% of those who attempted`}>
                              <span className="font-mono">{w.response}</span> × {w.count}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function cn2(pct: number): string {
  if (pct >= 70) return "font-semibold text-good tabular-nums";
  if (pct >= 45) return "font-semibold text-warn tabular-nums";
  return "font-semibold text-bad tabular-nums";
}
