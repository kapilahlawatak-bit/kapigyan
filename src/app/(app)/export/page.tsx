import Link from "next/link";
import { redirect } from "next/navigation";
import { DatabaseBackup } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";

export const metadata = { title: "Data Export" };
export const dynamic = "force-dynamic";

/**
 * Data export.
 *
 * The page states what is in the file, and what is deliberately not, before
 * the download buttons. Every file carries the same manifest, so the thing
 * that leaves the school server says on its own what it contains.
 */
export default async function ExportPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "PARENT") redirect("/no-access");
  if (!session.schoolId) redirect("/no-access");
  const locale = await getLocale();

  const classCount = await prisma.class.count({
    where: session.role === "ADMIN"
      ? { schoolId: session.schoolId }
      : { schoolId: session.schoolId, teacherId: session.userId },
  });

  const isAdmin = session.role === "ADMIN";

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Data Export"
        titleHi="डेटा निर्यात"
        description={isAdmin ? "Everything this school has recorded." : "Everything for the classes you teach."}
        locale={locale}
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        <Alert tone="info" title="Why this exists">
          A parent can ask for a copy of their child&apos;s data, and a school needs an archive it could
          actually restore from. Both need the same thing: the records, not a summary of them. This
          file includes raw answers and the notes you wrote, because none of that can be recovered
          from a score.
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="text-[12px]">What is in the file</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1 text-[11px] leading-relaxed text-ink-2">
              <li>· Every class, student, date of birth and support note you have access to.</li>
              <li>· Every paper, submission, score and grade band.</li>
              <li>· <strong>Every answer</strong> — what the child wrote, the mark awarded, the outcome, and your note.</li>
              <li>· Attendance, imported other-subject marks, and the curriculum map.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-[12px]">What is deliberately not in it</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1 text-[11px] leading-relaxed text-ink-2">
              <li>· No risk label, no inferred trait, no grading-confidence figure.</li>
              <li>· No comparison between children.</li>
            </ul>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
              Those are the app&apos;s working hypotheses. Exporting them as data would turn a guess into a
              fact the moment it left this server, and they would be read as assessment results.
            </p>
          </CardContent>
        </Card>

        <Alert tone="warn" title="A blank answer is not a wrong answer">
          The export writes <code className="font-mono">blank</code> as its own outcome and never
          merges it with <code className="font-mono">wrong</code>. A question a class found hard and
          a question they skipped are different findings, and a file that merged them would quietly
          change what your data says.
        </Alert>

        {classCount === 0 ? (
          <Alert tone="info" title="There is nothing to export yet">
            You have no classes. Set one up, or ask a principal for an export.
          </Alert>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-[12px]">
                <DatabaseBackup className="size-3.5 text-brand" />
                Download
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              <p className="text-[11px] text-ink-3">
                {isAdmin
                  ? "This file covers the whole school."
                  : "This file covers only the classes you teach."}
              </p>
              <div className="flex flex-wrap gap-2">
                {(["xlsx", "csv", "json", "docx"] as const).map((f) => (
                  <Button key={f} asChild size="sm" variant={f === "xlsx" ? "primary" : "secondary"}>
                    <a href={`/api/export/school/${f}`} download>
                      {f.toUpperCase()}
                    </a>
                  </Button>
                ))}
              </div>
              <p className="text-[10px] leading-relaxed text-ink-4">
                Excel for working with the data, CSV for importing into another system, JSON as the
                complete machine-readable record, and Word for a human-readable summary of the same.
                All are generated on this server — no third party sees the data.
              </p>
            </CardContent>
          </Card>
        )}

        <p className="text-[11px] text-ink-3">
          Looking for one test rather than the whole school? Every paper has its own{" "}
          <Link href="/reports" className="text-brand underline underline-offset-2">report export</Link>.
        </p>
      </div>
    </div>
  );
}
