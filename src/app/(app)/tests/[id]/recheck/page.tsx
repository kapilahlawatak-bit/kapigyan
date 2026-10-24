import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { recheckPaper } from "@/app/actions/recheck";

export const metadata = { title: "Re-check Paper" };
export const dynamic = "force-dynamic";

/**
 * One-click re-check.
 *
 * Everything the teacher needs to change their mind before committing is on
 * this page: how many children are affected, how many manual marks will be
 * discarded, and a plain statement that the responses themselves survive. A
 * destructive action that only explains itself *after* it runs is a trap.
 */
export default async function RecheckPage(props: PageProps<"/tests/[id]/recheck">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const paper = await prisma.paper.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: {
      id: true, title: true, classId: true,
      submissions: {
        select: {
          id: true,
          answers: { select: { needsReview: true, note: true } },
        },
      },
    },
  });
  if (!paper) notFound();
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const children = paper.submissions.length;
  // A mark a human set deliberately is recognised by its note, because the
  // grader writes machine reasons into the same field.
  const manual = paper.submissions.reduce(
    (a, s) => a + s.answers.filter((x) => /marked (correct|wrong) by the teacher/i.test(x.note ?? "")).length,
    0,
  );
  const openQuestions = paper.submissions.reduce(
    (a, s) => a + s.answers.filter((x) => x.needsReview).length,
    0,
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Re-check Paper"
        titleHi="पुनः जाँच"
        description={`${paper.title} — mark every script again from the answers already on file.`}
        locale={locale}
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href={`/tests/${paper.id}`}><ArrowLeft className="size-3" /> Back to paper</Link>
          </Button>
        }
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        {children === 0 ? (
          <Card>
            <EmptyState
              icon={<RefreshCcw className="size-5" />}
              title="Nothing to re-check"
              description="No child has submitted this paper yet, so there are no marks to rebuild."
              action={<Button asChild size="sm"><Link href={`/tests/${paper.id}/mark`}>Enter answers first</Link></Button>}
            />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
              <Badge tone="outline" size="sm">{children} children affected</Badge>
              <Badge tone={manual > 0 ? "warn" : "good"} size="sm">
                {manual > 0 ? `${manual} manual marks will be discarded` : "No manual marks to lose"}
              </Badge>
              {openQuestions > 0 ? <Badge tone="warn" size="sm">{openQuestions} answers still awaiting you</Badge> : null}
            </div>

            <Alert tone="warn" title="This rebuilds every mark on the paper">
              Use it after fixing a question — a wrong key, a changed answer, an option that was
              misprinted. It re-runs the same marking the app used the first time, from what each
              child actually wrote.
              {manual > 0 ? (
                <>
                  {" "}It will discard <strong>{manual} mark{manual === 1 ? "" : "s"} you set by hand</strong>.
                  Those were deliberate judgements and cannot be re-derived automatically — you would
                  need to set them again afterwards.
                </>
              ) : (
                <> Nothing you have marked by hand will be lost.</>
              )}
            </Alert>

            <Alert tone="info" title="What is never touched">
              Every answer the children gave is kept exactly as written. Only the marks derived from
              them are rebuilt, along with the analysis, the review queue and every report.
            </Alert>

            <Card>
              <CardContent className="pt-4">
                <form action={recheckPaper} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="paperId" value={paper.id} />
                  <Button type="submit" size="sm">
                    <RefreshCcw className="size-3" /> Re-mark {children} scripts
                  </Button>
                  <p className="text-[11px] text-ink-3">
                    Nothing is sent anywhere and nothing is lost that cannot be typed again.
                  </p>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
