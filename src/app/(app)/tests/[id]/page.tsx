import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ClipboardCheck, Download, Printer, RefreshCcw, ShieldCheck, Users } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { formatDate, gradeBand, topicName } from "@/lib/utils";
import { SOURCE_LABEL, ENTRY_MODE_LABEL } from "@/lib/paper/labels";
import { exportLinks } from "@/lib/paper/exports";

export const dynamic = "force-dynamic";

export default async function TestDetailPage(props: PageProps<"/tests/[id]">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { position: "asc" } },
      class: { include: { enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } } } },
      submissions: {
        include: { student: { select: { id: true, name: true, rollNo: true } } },
        orderBy: { score: "desc" },
      },
    },
  });

  if (!paper || paper.schoolId !== session.schoolId) notFound();
  // School membership is not ownership. Without this line any teacher in the
  // school could open, and then mark, any other teacher's class — the paper
  // detail page was reachable at 200 while its own /omr and /analysis children
  // correctly refused.
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const scored = paper.submissions;
  const avg = scored.length > 0
    ? scored.reduce((a, s) => a + (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0), 0) / scored.length
    : null;
  const needsReview = paper.submissions.reduce((a, s) => a + (s.manualShare > 0 ? 1 : 0), 0);

  const topicTotals = new Map<string, { marks: number; max: number }>();
  for (const q of paper.questions) {
    const key = q.topicId ?? "untagged";
    const row = topicTotals.get(key) ?? { marks: 0, max: 0 };
    row.max += q.marks;
    topicTotals.set(key, row);
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title={paper.title}
        titleHi={paper.title}
        description={`Class ${paper.grade}${paper.class ? ` · ${paper.class.name}` : ""} · ${paper.term} · ${formatDate(paper.date, true)}`}
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm"><Link href={`/tests/${paper.id}/analysis`}><BarChart3 className="size-3.5" /> Analysis</Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href={`/tests/${paper.id}/mark`}><ClipboardCheck className="size-3.5" /> Mark</Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href={`/tests/${paper.id}/preflight`}><ShieldCheck className="size-3.5" /> Check</Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href={`/tests/${paper.id}/recheck`}><RefreshCcw className="size-3.5" /> Re-check</Link></Button>
          </>
        }
      />

      <div className="p-5 max-w-6xl w-full space-y-4">
        <div className="flex flex-wrap gap-2 no-print">
          {exportLinks(paper.id).map((l) => (
            <Button key={l.kind} asChild variant="secondary" size="sm">
              <a href={l.href}><Download className="size-3.5" /> {l.label}</a>
            </Button>
          ))}
          <Button variant="secondary" size="sm" onClick={undefined} asChild>
            <a href={`/tests/${paper.id}/print`}><Printer className="size-3.5" /> Printable paper</a>
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Printable paper */}
          <Card className="lg:col-span-2 print-block">
            <CardHeader className="print-avoid-break">
              <CardTitle>{paper.title}</CardTitle>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="outline" size="sm">{SOURCE_LABEL[paper.source] ?? paper.source}</Badge>
                <Badge tone="outline" size="sm">{paper.questions.length} questions</Badge>
                <Badge tone="outline" size="sm">{paper.maxMarks} marks</Badge>
                {paper.timeMinutes ? <Badge tone="outline" size="sm">{paper.timeMinutes} minutes</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4 print-avoid-break">
              <div className="flex flex-wrap gap-8 border-b pb-3 text-xs text-ink-3">
                <span>Name: ______________________</span>
                <span>Class: {paper.grade}-{paper.class?.section ?? ""}</span>
                <span>Date: {formatDate(paper.date)}</span>
                <span>Marks obtained: ______ / {paper.maxMarks}</span>
              </div>

              <ol className="space-y-4">
                {paper.questions.map((q) => {
                  const options = parseJson<string[]>(q.options, []);
                  return (
                    <li key={q.id} className="break-inside-avoid">
                      <div className="flex gap-2.5">
                        <span className="font-semibold text-ink tabular-nums shrink-0">{q.position}.</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-relaxed text-ink">{q.stem}</p>
                          {q.stemHi ? <p className="mt-0.5 text-xs text-ink-3">{q.stemHi}</p> : null}
                          {options.length > 0 ? (
                            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                              {options.map((o, i) => (
                                <p key={i} className="text-xs text-ink-2">{o}</p>
                              ))}
                            </div>
                          ) : null}
                          {q.type === "long" || q.type === "medium" ? (
                            <div className="mt-3 space-y-4">
                              {[0, 1, 2].map((i) => (
                                <div key={i} className="h-px w-full bg-line" />
                              ))}
                            </div>
                          ) : null}
                          <p className="mt-1.5 text-[10px] text-ink-4">
                            {topicName(q.topicId)} · {q.marks} mark{q.marks === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] text-ink-4 tabular-nums">({q.marks})</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Class result</CardTitle></CardHeader>
              <CardContent>
                {avg === null ? (
                  <EmptyState
                    icon={<Users className="size-5" />}
                    title="Not marked yet"
                    description={
                      paper.class && paper.class.enrollments.length > 0
                        ? `${paper.class.enrollments.length} students are ready to mark.`
                        : "Add students to the class first, then mark the paper."
                    }
                    action={
                      paper.class && paper.class.enrollments.length > 0 ? (
                        <Button asChild size="sm"><Link href={`/tests/${paper.id}/mark`}>Start marking</Link></Button>
                      ) : (
                        <Button asChild size="sm" variant="secondary"><Link href="/classes">Add students</Link></Button>
                      )
                    }
                  />
                ) : (
                  <>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold tabular-nums text-ink">{Math.round(avg)}%</span>
                      <Badge tone={avg >= 70 ? "good" : avg >= 45 ? "warn" : "bad"} size="lg">{gradeBand(avg).label}</Badge>
                    </div>
                    <Progress value={avg} tone={avg >= 70 ? "good" : avg >= 45 ? "warn" : "bad"} className="mt-3" />
                    <p className="mt-2 text-[11px] text-ink-3">{scored.length} students marked</p>
                    {needsReview > 0 ? (
                      <p className="mt-2 text-[11px] text-warn">
                        {needsReview} submission{needsReview === 1 ? " has" : "s have"} long answers waiting for your judgement.
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

            {scored.length > 0 ? (
              <Card>
                <CardHeader><CardTitle>Answers</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  <Table>
                    <THead>
                      <tr><TH>#</TH><TH>Student</TH><TH className="text-right">Marks</TH><TH className="text-right">%</TH></tr>
                    </THead>
                    <TBody>
                      {scored.map((s, i) => {
                        const p = s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0;
                        return (
                          <TR key={s.id}>
                            <TD className="text-ink-4 tabular-nums">{i + 1}</TD>
                            <TD>
                              <Link href={`/students/${s.studentId}`} className="text-ink hover:text-brand font-medium">
                                {s.student.name}
                              </Link>
                            </TD>
                            <TD className="text-right tabular-nums">{s.score}/{s.maxScore}</TD>
                            <TD className="text-right tabular-nums font-semibold">{Math.round(p)}%</TD>
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
