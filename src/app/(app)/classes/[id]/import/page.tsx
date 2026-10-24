import { notFound } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { ImportForm } from "./form";

export const metadata = { title: "Import Other Marks" };
export const dynamic = "force-dynamic";

/**
 * Import another subject's mark sheet.
 *
 * The page leads with what will *not* happen, because the reasonable fear here
 * is that importing Hindi marks will quietly change what the app says about a
 * child's mathematics. It will not, and the page says so before the upload
 * box rather than after it.
 */
export default async function ImportPage(props: PageProps<"/classes/[id]/import">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();
  await assertClassAccess(session, id);

  const cls = await prisma.class.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { name: true },
  });
  if (!cls) notFound();

  const existing = await prisma.otherSubjectMark.findMany({
    where: { classId: id },
    select: { subject: true, marks: true, maxMarks: true },
  });
  const bySubject = new Map<string, { n: number; total: number; max: number }>();
  for (const m of existing) {
    const e = bySubject.get(m.subject) ?? { n: 0, total: 0, max: 0 };
    e.n++; e.total += m.marks; e.max = m.maxMarks;
    bySubject.set(m.subject, e);
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Import Other Marks"
        titleHi="अन्य विषयों के अंक"
        description={`${cls.name} — bring in the mark sheet this app does not teach.`}
        locale={locale}
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        <Alert tone="info" title="What these marks will and will not do">
          They will be shown on each child&apos;s page and included in exports, so the school has one record
          instead of three. They will <strong>not</strong> affect mathematics mastery, the misconception
          analysis or the dropout risk score. An English mark is no evidence about how a child reasons
          in a sum, and treating it as if it were would make every one of those less trustworthy.
        </Alert>

        {bySubject.size > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-[12px]">Already imported</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-2">
                {[...bySubject.entries()].map(([subject, e]) => (
                  <Badge key={subject} tone="outline" size="sm">
                    {subject}: {e.n} {e.n === 1 ? "child" : "children"}, average{" "}
                    {Math.round((e.total / Math.max(1, e.n)) / Math.max(1, e.max) * 100)}%
                  </Badge>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-ink-3">
                Importing a subject again replaces the previous sheet for it, so a corrected upload does
                not sit beside the version it corrects.
              </p>
            </CardContent>
          </Card>
        ) : null}

        {existing.length === 0 && bySubject.size === 0 ? (
          <Card>
            <EmptyState
              icon={<FileSpreadsheet className="size-5" />}
              title="Nothing imported yet"
              description="Paste a mark sheet below. A header row of Name, Subject, Marks, Max is all it needs."
            />
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-[12px]">Paste or choose a file</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ImportForm classId={id} className={cls.name} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
