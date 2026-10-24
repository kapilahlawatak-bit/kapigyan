import Link from "next/link";
import { Download, FileSpreadsheet, FileText, FileType2, GraduationCap, Printer } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Table, TBody, TD, TH, THead, TR } from "@/components/ui/primitives";
import { formatDate, gradeBand } from "@/lib/utils";
import { SOURCE_LABEL } from "@/lib/paper/labels";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/**
 * The reports index.
 *
 * One row per paper, with every export in one place. In a school the report
 * is the artefact that leaves the building — into a register, into a parent
 * meeting, into an inspection file — so the download buttons are the primary
 * content here, not an afterthought behind a menu.
 */
export default async function ReportsPage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const papers = await prisma.paper.findMany({
    where: { schoolId: session.schoolId, ...(session.mode === "HOME" ? { createdBy: session.userId } : {}) },
    orderBy: { date: "desc" },
    include: {
      class: { select: { name: true, grade: true } },
      submissions: { where: { status: "GRADED" }, select: { score: true, maxScore: true } },
      _count: { select: { questions: true, submissions: true } },
    },
  });

  const marked = papers.filter((p) => p.submissions.length > 0);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reports"
        titleHi="रिपोर्ट"
        description="Every report in PDF, Word, Excel and print. One click each."
        locale={locale}
      />

      <div className="p-5 max-w-6xl w-full space-y-4">
        {papers.length === 0 ? (
          <Card>
            <EmptyState
              icon={<GraduationCap className="size-5" />}
              title="No reports yet"
              description="Mark a test and a full report appears here — class table, topic analysis, and what to teach next."
              action={<Button asChild size="sm"><Link href="/tests/new">Upload a test</Link></Button>}
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Test reports</CardTitle>
                <Badge tone="outline" size="lg">{marked.length} of {papers.length} marked</Badge>
              </CardHeader>
              <CardContent className="pt-0">
                <Table>
                  <THead>
                    <tr>
                      <TH>Test</TH>
                      <TH>Class</TH>
                      <TH>Date</TH>
                      <TH className="text-right">Average</TH>
                      <TH className="text-right">Marked</TH>
                      <TH className="no-print text-right">Download</TH>
                    </tr>
                  </THead>
                  <TBody>
                    {papers.map((p) => {
                      const scored = p.submissions;
                      const avg = scored.length > 0
                        ? scored.reduce((a, s) => a + (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0), 0) / scored.length
                        : null;
                      return (
                        <TR key={p.id}>
                          <TD>
                            <Link href={`/tests/${p.id}`} className="font-medium text-ink hover:text-brand">
                              {p.title}
                            </Link>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              <Badge tone="outline" size="sm">{SOURCE_LABEL[p.source] ?? p.source}</Badge>
                              <Badge tone="outline" size="sm">{p._count.questions} Q</Badge>
                            </div>
                          </TD>
                          <TD className="whitespace-nowrap">{p.class?.name ?? `Class ${p.grade}`}</TD>
                          <TD className="whitespace-nowrap">{formatDate(p.date)}</TD>
                          <TD className="text-right">
                            {avg === null ? (
                              <span className="text-ink-4">—</span>
                            ) : (
                              <span className={avg >= 70 ? "font-semibold tabular-nums text-good" : avg >= 45 ? "font-semibold tabular-nums text-warn" : "font-semibold tabular-nums text-bad"}>
                                {Math.round(avg)}% · {gradeBand(avg).grade}
                              </span>
                            )}
                          </TD>
                          <TD className="text-right tabular-nums">{p._count.submissions}</TD>
                          <TD className="no-print">
                            <div className="flex justify-end gap-1">
                              <IconLink href={`/api/papers/${p.id}/export/xlsx`} title="Excel"><FileSpreadsheet className="size-3.5" /></IconLink>
                              <IconLink href={`/api/papers/${p.id}/export/docx`} title="Word"><FileType2 className="size-3.5" /></IconLink>
                              <IconLink href={`/api/papers/${p.id}/export/pdf`} title="PDF"><FileText className="size-3.5" /></IconLink>
                              <IconLink href={`/tests/${p.id}/print`} title="Printable paper"><Printer className="size-3.5" /></IconLink>
                            </div>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            {/* Per-child reports — these are the ones that go home. */}
            <ChildReports />
          </>
        )}
      </div>
    </div>
  );
}

function IconLink({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      title={title}
      aria-label={title}
      className="flex size-7 items-center justify-center rounded-control border bg-surface text-ink-3 transition-colors hover:border-brand hover:text-brand"
    >
      {children}
    </a>
  );
}

/** One row per child, with the report a parent would receive. */
async function ChildReports() {
  const session = await requireTeacher();

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId, ...(session.role === "TEACHER" ? { teacherId: session.userId } : {}) },
    include: { enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } } },
  });

  const students = classes.flatMap((c) => c.enrollments.map((e) => ({ ...e.student, className: c.name })));
  if (students.length === 0) return null;

  const withSubmissions = await prisma.submission.groupBy({
    by: ["studentId"],
    where: { studentId: { in: students.map((s) => s.id) }, status: "GRADED" },
    _count: { _all: true },
  });
  const active = new Set(withSubmissions.map((w) => w.studentId));

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Individual child reports</CardTitle>
          <p className="mt-0.5 text-[11px] text-ink-3">
            One page per child, written for a parent. {active.size} of {students.length} have results.
          </p>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {students.map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-control border p-2.5">
              <Link href={`/students/${s.id}`} className="flex min-w-0 flex-1 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand-ink">
                  {s.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-medium text-ink">{s.name}</span>
                  <span className="block truncate text-[10px] text-ink-4">{s.className}</span>
                </span>
              </Link>
              {active.has(s.id) ? (
                <a
                  href={`/api/reports/student/${s.id}`}
                  title="Download this child's report"
                  aria-label={`Download ${s.name}'s report`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-control border text-ink-3 hover:border-brand hover:text-brand transition-colors"
                >
                  <Download className="size-3.5" />
                </a>
              ) : (
                <Badge tone="neutral" size="sm">no data</Badge>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
