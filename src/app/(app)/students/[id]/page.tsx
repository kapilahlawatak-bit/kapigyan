import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Brain, Download, Target, TrendingDown, TrendingUp } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { MasteryBars, ScoreTrend } from "@/components/charts";
import { studentMasteryMap, errorHistory } from "@/lib/analytics/class";
import { asArray, meanMastery, riskFor, planFrom } from "@/lib/analytics/view";
import { attendanceFor } from "@/lib/analytics/attendance-data";
import { MISCONCEPTION_BY_ID, STRAND_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import { formatDate, topicName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function StudentPage(props: PageProps<"/students/[id]">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const student = await prisma.student.findUnique({
    where: { id },
    include: {
      enrollments: { include: { class: { select: { id: true, name: true, grade: true } } } },
      submissions: {
        include: { paper: { select: { id: true, title: true, date: true, maxMarks: true, grade: true } } },
        orderBy: { paper: { date: "asc" } },
      },
    },
  });
  if (!student) notFound();

  const enrolment = student.enrollments[0];
  if (!enrolment) notFound();

  const classId = enrolment.class.id;
  const cls = await prisma.class.findUnique({ where: { id: classId }, select: { schoolId: true } });
  if (!cls || cls.schoolId !== session.schoolId) notFound();

  const [mastery, history] = await Promise.all([
    studentMasteryMap(student.id, classId),
    errorHistory(student.id),
  ]);

  const rows = asArray(mastery);

  const attendance = await attendanceFor(student.id);
  const risk = riskFor(
    mastery,
    student.submissions.filter((s) => s.maxScore > 0).map((s) => (s.score / s.maxScore) * 100),
    attendance
      ? { concern: attendance.concern, notes: attendance.findings.filter((f) => f.severity === "high").map((f) => f.note) }
      : undefined,
  );

  const avgMastery = meanMastery(rows);
  const plan = planFrom(student.name, mastery);

  const mcCounts = new Map<string, number>();
  for (const h of history) {
    if (h.errorTag) mcCounts.set(h.errorTag, (mcCounts.get(h.errorTag) ?? 0) + 1);
  }

  const byStrand = new Map<string, { total: number; n: number }>();
  for (const m of rows) {
    const s = STRAND_BY_ID.get(TOPIC_BY_ID.get(m.topicId)?.strand ?? "")?.id ?? "number";
    const row = byStrand.get(s) ?? { total: 0, n: 0 };
    row.total += m.mastery;
    row.n += 1;
    byStrand.set(s, row);
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title={student.name}
        titleHi={student.name}
        description={`${enrolment.class.name} · Roll ${student.rollNo ?? "–"} · ${student.submissions.length} tests taken`}
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href="/students"><ArrowLeft className="size-3.5" /> All students</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/reports/student/${student.id}`}><Download className="size-3.5" /> PDF</a>
            </Button>
          </>
        }
      />

      <div className="p-5 max-w-[1300px] w-full space-y-5">
        {/* Summary */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Overall mastery</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{Math.round(avgMastery * 100)}%</p>
            <Progress value={avgMastery * 100} tone={avgMastery >= 0.7 ? "good" : avgMastery >= 0.5 ? "warn" : "bad"} className="mt-1.5" />
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Risk level</p>
            <p className={`mt-1 text-2xl font-bold capitalize ${risk.level === "high" ? "text-bad" : risk.level === "watch" ? "text-warn" : "text-good"}`}>
              {risk.level}
            </p>
            <p className="mt-1.5 text-[10px] text-ink-4">{risk.reasons[0]}</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Strongest topic</p>
            <p className="mt-1 truncate text-sm font-semibold text-ink">
              {topicName([...rows].sort((a, b) => b.mastery - a.mastery)[0]?.topicId ?? "")}
            </p>
            <p className="mt-1.5 text-[10px] text-ink-4">
              {[...rows].sort((a, b) => b.mastery - a.mastery)[0]
                ? `${Math.round([...rows].sort((a, b) => b.mastery - a.mastery)[0].mastery * 100)}%`
                : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Topics below 60%</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{rows.filter((m) => m.mastery < 0.6).length}</p>
            <p className="mt-1.5 text-[10px] text-ink-4">of {rows.length} assessed</p>
          </Card>
        </div>

        {risk.level !== "low" ? (
          <Card className={risk.level === "high" ? "border-bad/40" : "border-warn/40"}>
            <CardContent className="pt-4 flex flex-wrap items-start gap-3">
              <Target className="mt-0.5 size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-ink">What to do about this</p>
                <ul className="mt-1.5 space-y-1">
                  {risk.actions.slice(0, 4).map((a) => (
                    <li key={a} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-2">
                      <span className="text-brand">→</span>{a}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {attendance ? (
          <Card>
            <CardHeader>
              <p className="text-[13px] font-semibold text-ink">Attendance</p>
              <span className="text-[11px] tabular-nums text-ink-3">
                present {Math.round(attendance.presentRate! * 100)}% of {attendance.daysRecorded} days
              </span>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              {attendance.findings.map((f) => (
                <p
                  key={f.id}
                  className={`rounded px-2.5 py-1.5 text-[10px] leading-relaxed ${
                    f.severity === "high" ? "bg-bad-soft/40 text-ink-2"
                    : f.severity === "medium" ? "bg-warn-soft/40 text-ink-2"
                    : "text-ink-3"
                  }`}
                >
                  <span className="font-semibold">{f.note}</span>{" "}
                  <span className="text-ink-4">{f.check}</span>
                </p>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Mastery by strand</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">Blended with the class average so one lucky answer is not mastery.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-0">
              {[...byStrand.entries()].map(([strandId, row]) => {
                const pct = (row.total / row.n) * 100;
                const s = STRAND_BY_ID.get(strandId);
                return (
                  <div key={strandId}>
                    <div className="flex items-baseline justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-ink-2">
                        <span className="size-2 rounded-full" style={{ background: s?.color }} />
                        {s?.name ?? strandId}
                      </span>
                      <span className="font-semibold tabular-nums text-ink-3">{Math.round(pct)}%</span>
                    </div>
                    <Progress value={pct} tone={pct >= 70 ? "good" : pct >= 50 ? "warn" : "bad"} className="mt-1" />
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Score over time</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {student.submissions.length < 2 ? (
                <EmptyState icon={<TrendingUp className="size-5" />} title="Not enough data" description="Two or more marked tests show a trend." />
              ) : (
                <ScoreTrend
                  data={student.submissions.map((s) => ({
                    label: s.paper.title.length > 18 ? `${s.paper.title.slice(0, 18)}…` : s.paper.title,
                    percent: s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Topic detail */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Every topic</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">Weakest first — this is the student&apos;s own study list.</p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <Table>
              <THead>
                <tr><TH>Topic</TH><TH>Strand</TH><TH className="text-right">Mastery</TH><TH className="text-right">Confidence</TH><TH>Trend</TH></tr>
              </THead>
              <TBody>
                {[...rows].sort((a, b) => a.mastery - b.mastery).map((m) => {
                  const s = STRAND_BY_ID.get(TOPIC_BY_ID.get(m.topicId)?.strand ?? "");
                  return (
                    <TR key={m.topicId}>
                      <TD className="font-medium text-ink">{topicName(m.topicId)}</TD>
                      <TD>
                        <span className="flex items-center gap-1.5">
                          <span className="size-2 rounded-full" style={{ background: s?.color }} />
                          {s?.name}
                        </span>
                      </TD>
                      <TD className="text-right">
                        <span className={`font-semibold tabular-nums ${m.mastery >= 0.7 ? "text-good" : m.mastery >= 0.5 ? "text-warn" : "text-bad"}`}>
                          {Math.round(m.mastery * 100)}%
                        </span>
                      </TD>
                      <TD className="text-right tabular-nums text-ink-3">{m.attempts} {m.attempts === 1 ? "try" : "tries"}</TD>
                      <TD>
                        {m.trend === "improving" ? (
                          <span className="flex items-center gap-1 text-[11px] text-good"><TrendingUp className="size-3" /> improving</span>
                        ) : m.trend === "declining" ? (
                          <span className="flex items-center gap-1 text-[11px] text-bad"><TrendingDown className="size-3" /> slipping</span>
                        ) : (
                          <span className="text-[11px] text-ink-4">steady</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        {/* Errors + practice */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><Brain className="size-3.5" /> Their recurring errors</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {mcCounts.size === 0 ? (
                <EmptyState icon={<Brain className="size-5" />} title="No errors recorded" description="Errors appear once tests with topic tags are marked." />
              ) : (
                <div className="space-y-2">
                  {[...mcCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, count]) => {
                    const m = MISCONCEPTION_BY_ID.get(id);
                    if (!m) return null;
                    return (
                      <div key={id} className="rounded-control border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold text-ink">{m.name}</p>
                          <Badge tone="bad" size="sm">× {count}</Badge>
                        </div>
                        <p className="mt-1 text-[10px] text-ink-3">{m.remediation[0]}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Practice plan</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">Generated from the three weakest topics. Hand it to the child or the parent.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {plan.items.length === 0 ? (
                <EmptyState icon={<Target className="size-5" />} title="Nothing to practise" description="Every assessed topic is above the target." />
              ) : (
                plan.items.map((it) => {
                  const m = rows.find((r) => r.topicId === it.topicId);
                  return (
                  <div key={it.topicId} className="rounded-control border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-ink">{it.topicName}</p>
                      {m ? <Badge tone={m.mastery < 0.4 ? "bad" : "warn"} size="sm">{Math.round(m.mastery * 100)}%</Badge> : null}
                    </div>
                    <p className="mt-1 text-[10px] text-ink-3">{it.why}</p>
                    <ol className="mt-1.5 list-decimal space-y-0.5 pl-4 text-[10px] leading-snug text-ink-2">
                      {it.whatToDo.map((st) => <li key={st}>{st}</li>)}
                    </ol>
                  </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        {/* Test history */}
        <Card>
          <CardHeader><CardTitle>Tests taken</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {student.submissions.length === 0 ? (
              <EmptyState icon={<Target className="size-5" />} title="No marked tests yet" />
            ) : (
              <Table>
                <THead>
                  <tr><TH>Test</TH><TH>Date</TH><TH className="text-right">Marks</TH><TH className="text-right">%</TH><TH>Grade</TH></tr>
                </THead>
                <TBody>
                  {[...student.submissions].reverse().map((s) => {
                    const p = s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0;
                    return (
                      <TR key={s.id}>
                        <TD>
                          <Link href={`/tests/${s.paper.id}`} className="font-medium text-ink hover:text-brand">{s.paper.title}</Link>
                        </TD>
                        <TD className="whitespace-nowrap">{formatDate(s.paper.date)}</TD>
                        <TD className="text-right tabular-nums">{s.score}/{s.maxScore}</TD>
                        <TD className="text-right font-semibold tabular-nums">{Math.round(p)}%</TD>
                        <TD><Badge tone={p >= 70 ? "good" : p >= 45 ? "warn" : "bad"} size="sm">{s.gradeBand}</Badge></TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
