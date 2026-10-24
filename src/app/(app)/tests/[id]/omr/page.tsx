import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Grid2x2 } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Button, EmptyState } from "@/components/ui/primitives";
import { buildOmr } from "@/lib/analytics/omr";
import { OmrEntry } from "./entry";

export const metadata = { title: "Bubble Sheet Marking" };
export const dynamic = "force-dynamic";

/**
 * Marking from bubble sheets.
 *
 * The boundary is stated on the page as well as in the code: this accepts
 * answers a human has read off a sheet, it does not read photographs. A
 * misread bubble would put a wrong mark on a child's report that nobody would
 * notice, so the automatic path is not faked.
 */
export default async function OmrPage(props: PageProps<"/tests/[id]/omr">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const paper = await prisma.paper.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: {
      id: true, title: true, classId: true,
      class: { select: { name: true, enrollments: { select: { student: { select: { id: true, name: true, rollNo: true } } } } } },
    },
  });
  if (!paper) notFound();
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const omr = await buildOmr(paper.id);
  const children = (paper.class?.enrollments ?? [])
    .map((e) => e.student)
    .sort((a, b) => (a.rollNo ?? 999) - (b.rollNo ?? 999));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Bubble Sheet Marking"
        titleHi="बबल शीट"
        description={`${paper.title} — ${paper.class?.name ?? ""}`}
        locale={locale}
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href={`/tests/${paper.id}`}><ArrowLeft className="size-3" /> Back to paper</Link>
          </Button>
        }
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        <Alert tone="info" title="This reads answers, it does not photograph them">
          Print the bubble sheets, fill them in, and type what is filled in. Reading a photograph
          automatically needs image processing this app does not have, and a misread bubble would put a
          wrong mark on a child&apos;s report with nobody noticing. That is not a shortcut worth taking.
        </Alert>

        {omr.questionNumbers.length === 0 ? (
          <EmptyState
            icon={<Grid2x2 className="size-5" />}
            title="No questions suit a bubble sheet"
            description="A bubble sheet can only carry multiple-choice questions whose answer key is one of the options. This paper has none."
            action={<Button asChild size="sm"><Link href={`/tests/${paper.id}/mark`}>Mark it the usual way</Link></Button>}
          />
        ) : children.length === 0 ? (
          <EmptyState
            icon={<Grid2x2 className="size-5" />}
            title="No children in this class"
            description="Add the class roll before marking bubble sheets."
          />
        ) : (
          <OmrEntry paperId={paper.id} omr={omr} students={children} />
        )}
      </div>
    </div>
  );
}
