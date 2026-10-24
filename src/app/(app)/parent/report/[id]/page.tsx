import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Download, Heart, Printer, Sparkles, Target } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress, Alert } from "@/components/ui/primitives";
import { studentMasteryMap } from "@/lib/analytics/class";
import { asArray, meanMastery, riskFor, planFrom } from "@/lib/analytics/view";
import { MISCONCEPTION_BY_ID, STRAND_BY_ID, TOPIC_BY_ID, gradeBand } from "@/lib/curriculum";
import { formatDate, topicName } from "@/lib/utils";
import { STRINGS } from "@/lib/i18n";

export const metadata = { title: "Progress report" };
export const dynamic = "force-dynamic";

/**
 * Parent report.
 *
 * Written on the assumption that the parent is not a mathematician and will
 * read this on a phone, possibly in a language that is not their first one.
 * No mastery percentages without an explanation, no grade without a meaning,
 * and no jargon — "place value gap" becomes "trouble with 3-digit numbers
 * like 247". Everything here is also printable in one page on A4, because
 * many families in India still find a paper more useful than a link.
 */
export default async function ParentReportPage(props: PageProps<"/parent/report/[id]">) {
  const { id } = await props.params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "PARENT") redirect("/no-access");
  const locale = await getLocale();

  // Consent is checked on every read, not just at link time — a parent who
  // withdraws consent loses access immediately, even to an old bookmark.
  const link = await prisma.parentLink.findFirst({
    where: { parentId: session.userId, studentId: id, revokedAt: null },
    include: { student: { include: { submissions: { include: { paper: { select: { id: true, title: true, date: true, maxMarks: true } } } } } } },
  });
  if (!link) notFound();

  const student = link.student;
  if (!link.consentAt) notFound();

  const enrolment = await prisma.enrollment.findFirst({ where: { studentId: student.id }, select: { classId: true } });
  const mastery = await studentMasteryMap(student.id, enrolment?.classId);
  const rows = asArray(mastery);
  const risk = riskFor(mastery, student.submissions.filter((s) => s.maxScore > 0).map((s) => (s.score / s.maxScore) * 100));

  const avg = meanMastery(rows);
  const strong = [...rows].sort((a, b) => b.mastery - a.mastery).slice(0, 3);
  const weak = rows.filter((m) => m.mastery < 0.65).sort((a, b) => a.mastery - b.mastery);
  const plan = planFrom(student.name, mastery, 0.65, 3);

  const lastTest = student.submissions[student.submissions.length - 1];
  const lastPercent = lastTest && lastTest.maxScore > 0 ? (lastTest.score / lastTest.maxScore) * 100 : null;

  const byStrand = new Map<string, number[]>();
  for (const m of rows) {
    const s = STRAND_BY_ID.get(TOPIC_BY_ID.get(m.topicId)?.strand ?? "");
    if (!s) continue;
    byStrand.set(s.id, [...(byStrand.get(s.id) ?? []), m.mastery]);
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title={`${student.name}'s progress`}
        titleHi={`${student.name} की प्रगति`}
        description="Written to be read by a parent, not by a maths teacher."
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm"><Link href="/parent"><ArrowLeft className="size-3.5" /> All children</Link></Button>
            <Button asChild variant="secondary" size="sm"><a href={`/api/reports/parent/${student.id}`}><Download className="size-3.5" /> PDF</a></Button>
            <Button variant="secondary" size="sm" asChild>
              <a href={`/parent/report/${student.id}/print`}><Printer className="size-3.5" /> Print</a>
            </Button>
          </>
        }
      />

      <div className="p-5 max-w-3xl w-full space-y-4">
        {student.submissions.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title="No test results yet"
              description="Once the teacher marks a test, this page fills in automatically. Nothing to do."
              action={<Button asChild size="sm" variant="secondary"><Link href="/parent">Back</Link></Button>}
            />
          </Card>
        ) : (
          <>
            {/* The headline, in one sentence */}
            <Card className="border-brand/30 bg-brand-soft/20">
              <CardContent className="pt-5">
                <p className="flex items-start gap-2 text-base leading-relaxed text-ink">
                  <Heart className="mt-1 size-4 shrink-0 text-brand" />
                  <span>
                    {student.name} currently understands roughly{" "}
                    <strong className="tabular-nums">{Math.round(avg * 100)}%</strong> of the Class{" "}
                    {enrolment ? "" : ""}
                    mathematics syllabus.
                    {lastPercent !== null ? (
                      <>
                        {" "}In the most recent test, <strong>{lastTest!.paper.title}</strong>, they scored{" "}
                        <strong className="tabular-nums">{Math.round(lastPercent)}%</strong> — that is a{" "}
                        <strong>{gradeBand(lastPercent).label.toLowerCase()}</strong> result.
                      </>
                    ) : null}
                  </span>
                </p>
              </CardContent>
            </Card>

            {/* Strengths */}
            <Card>
              <CardHeader>
                <CardTitle>Going well</CardTitle>
                <p className="text-[11px] text-ink-3">Mention these out loud at home. It costs nothing and it matters.</p>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {strong.map((m) => (
                  <div key={m.topicId} className="flex items-center gap-2.5">
                    <span className="flex size-6 items-center justify-center rounded-full bg-good-soft text-good"><span className="text-[11px]">✓</span></span>
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{topicName(m.topicId)}</span>
                    <span className="text-[11px] font-semibold tabular-nums text-good">{Math.round(m.mastery * 100)}%</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Needs help — in plain words */}
            <Card>
              <CardHeader>
                <CardTitle>Needs more practice</CardTitle>
                <p className="text-[11px] text-ink-3">These are the areas to work on at home — 10 minutes a day is enough.</p>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {weak.length === 0 ? (
                  <p className="text-xs text-ink-2">Nothing flagged right now — every assessed topic is on track.</p>
                ) : (
                  weak.slice(0, 5).map((m) => {
                    const topic = TOPIC_BY_ID.get(m.topicId);
                    return (
                      <div key={m.topicId} className="rounded-control border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-ink">{topic?.name ?? m.topicId}</p>
                          <Badge tone={m.mastery < 0.4 ? "bad" : "warn"} size="sm">{Math.round(m.mastery * 100)}%</Badge>
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
                          {topic?.blurb ?? "This topic needs another pass."}
                        </p>
                        <Progress value={m.mastery * 100} tone={m.mastery < 0.4 ? "bad" : "warn"} className="mt-2" />
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            {/* What to do at home */}
            <Card className="border-good/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><Target className="size-3.5 text-good" /> What to do at home</CardTitle>
                <p className="text-[11px] text-ink-3">Pick one. Ten focused minutes beats an hour of unspecified practice.</p>
              </CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {plan.items.length === 0 ? (
                  <p className="text-xs text-ink-2">No practice set at the moment — everything is on track.</p>
                ) : (
                  plan.items.map((it) => (
                    <div key={it.topicId}>
                      <p className="text-[11px] font-semibold text-ink-2">{it.topicName}</p>
                      <ul className="mt-1 space-y-0.5">
                        {it.whatToDo.map((s) => (
                          <li key={s} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-2">
                            <span className="text-good">•</span>{s}
                          </li>
                        ))}
                      </ul>                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Subject areas */}
            <Card>
              <CardHeader><CardTitle>By subject area</CardTitle></CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {[...byStrand.entries()].map(([id, vals]) => {
                  const s = STRAND_BY_ID.get(id);
                  const pct = (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
                  return (
                    <div key={id}>
                      <div className="flex items-baseline justify-between text-[11px]">
                        <span className="flex items-center gap-1.5 text-ink-2">
                          <span className="size-2 rounded-full" style={{ background: s?.color }} />
                          {s?.name ?? id}
                        </span>
                        <span className="font-semibold tabular-nums text-ink-3">{Math.round(pct)}%</span>
                      </div>
                      <Progress value={pct} tone={pct >= 70 ? "good" : pct >= 50 ? "warn" : "bad"} className="mt-1" />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Test history */}
            <Card>
              <CardHeader><CardTitle>Recent tests</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-1.5">
                  {[...student.submissions].reverse().slice(0, 6).map((s) => {
                    const p = s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0;
                    return (
                      <div key={s.id} className="flex items-center gap-2 rounded-control border p-2.5">
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">{s.paper.title}</span>
                        <span className="text-[10px] text-ink-4">{formatDate(s.paper.date)}</span>
                        <Badge tone={p >= 70 ? "good" : p >= 45 ? "warn" : "bad"} size="sm">{Math.round(p)}%</Badge>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {risk.level !== "low" ? (
              <Alert tone="warn" title="Worth mentioning to the teacher">
                The system has flagged {student.name.split(" ")[0]} as &ldquo;{risk.level}&rdquo; risk mainly
                because {risk.reasons[0]?.toLowerCase()}. This is a prompt for a conversation, not a diagnosis.
              </Alert>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
