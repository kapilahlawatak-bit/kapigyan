import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, ShieldAlert, Printer } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { preflight, type PreflightLevel } from "@/lib/analytics/preflight";

export const metadata = { title: "Pre-flight Check" };
export const dynamic = "force-dynamic";

const TONE: Record<PreflightLevel, "bad" | "warn" | "outline"> = {
  fatal: "bad",
  serious: "warn",
  worth_a_look: "outline",
};
const LABEL: Record<PreflightLevel, string> = {
  fatal: "Would spoil the paper",
  serious: "Look at this first",
  worth_a_look: "Worth a look",
};

/**
 * Pre-flight.
 *
 * Shown before printing, because afterwards it is too late: the paper is
 * photocopied, handed out, and thirty children have already answered. Every
 * finding names a position so the teacher can go straight to it.
 *
 * It advises, it does not block. A deliberately open paper is legitimate.
 */
export default async function PreflightPage(props: PageProps<"/tests/[id]/preflight">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const paper = await prisma.paper.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { id: true, title: true, classId: true },
  });
  if (!paper) notFound();
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const report = await preflight(paper.id);
  const order: PreflightLevel[] = ["fatal", "serious", "worth_a_look"];

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Pre-flight Check"
        titleHi="पूर्व-जाँच"
        description={`${paper.title} — checked before it is printed, not after.`}
        locale={locale}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/tests/${paper.id}`}><ArrowLeft className="size-3" /> Back to paper</Link>
            </Button>
            {report.canRun ? (
              <Button asChild size="sm">
                <Link href={`/tests/${paper.id}/print`}><Printer className="size-3" /> Print</Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        <Alert
          tone={report.canRun ? (report.findings.length === 0 ? "good" : "info") : "bad"}
          title={report.canRun ? "This paper can be printed" : "Do not print this yet"}
        >
          {report.summary} {report.questionCount} questions, {report.totalMarks} marks.
        </Alert>

        {report.findings.length === 0 ? (
          <Card>
            <CardContent className="pt-4 flex items-center gap-3">
              <ShieldCheck className="size-5 text-good" />
              <p className="text-[12px] text-ink-2">
                Answer keys are present, every multiple-choice key matches an option, no question appears
                twice, and the length is reasonable for the class. Printed as it stands, this paper works.
              </p>
            </CardContent>
          </Card>
        ) : (
          order.map((level) => {
            const rows = report.findings.filter((f) => f.level === level);
            if (rows.length === 0) return null;
            return (
              <Card key={level}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[12px]">
                    {level === "fatal" ? <ShieldAlert className="size-3.5 text-bad" /> : null}
                    {LABEL[level]}
                    <Badge tone={TONE[level]} size="sm">{rows.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {rows.map((f, i) => (
                    <div key={i} className="rounded-control border p-3">
                      <p className="text-[12px] font-medium text-ink">
                        {f.position !== undefined ? (
                          <span className="mr-1.5 tabular-nums text-ink-4">Q{f.position}</span>
                        ) : null}
                        {f.title}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{f.detail}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
