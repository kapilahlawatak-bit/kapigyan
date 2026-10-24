import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Gauge } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { reviewQueue } from "@/lib/analytics/review-queue";
import { ReviewBoard } from "./board";

export const metadata = { title: "Fast Review" };
export const dynamic = "force-dynamic";

/**
 * Fast review.
 *
 * The point of the whole app, stated plainly: the machine marks, the teacher
 * checks only what the machine is least sure about, and both are honest about
 * how many answers that is.
 *
 * The count is stated before the list, never truncated. A teacher who is told
 * "12 of 300" can decide whether that is worth an hour; a teacher who is
 * quietly shown 12 of 300 has been lied to and will stop opening the page.
 */
export default async function ReviewPage(props: PageProps<"/tests/[id]/review">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const paper = await prisma.paper.findFirst({
    where: { id, schoolId: session.schoolId },
    select: { id: true, title: true, classId: true },
  });
  if (!paper) notFound();
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const queue = await reviewQueue(paper.id);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Fast Review"
        titleHi="त्वरित समीक्षा"
        description={`${paper.title} — the answers the machine is least sure about.`}
        locale={locale}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/tests/${paper.id}`}><ArrowLeft className="size-3" /> Full marking sheet</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/tests/${paper.id}/analysis`}>Analysis <Gauge className="size-3" /></Link>
            </Button>
          </div>
        }
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        <Alert tone="info" title="Only these answers are yours to check">
          A correct answer with a recognised misconception is settled and needs nobody. What is left is
          what the machine could not explain: wrong answers nothing accounts for, written answers, and
          blanks where the class mostly answered. Confirming or correcting one here updates the marks
          everywhere, including parent reports.
        </Alert>

        {queue.totalAnswers === 0 ? (
          <Card>
            <EmptyState
              icon={<Gauge className="size-5" />}
              title="Nothing marked yet"
              description="Run the marking first, then come back to check only what needs checking."
              action={<Button asChild size="sm"><Link href={`/tests/${paper.id}/mark`}>Go to marking</Link></Button>}
            />
          </Card>
        ) : queue.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Gauge className="size-5" />}
              title="Nothing needs you"
              description={`All ${queue.totalAnswers} answers were settled with confidence. This paper is ready to hand back.`}
              action={<Button asChild size="sm"><Link href={`/tests/${paper.id}/analysis`}>Open the analysis</Link></Button>}
            />
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
              <Badge tone="outline" size="sm">{queue.students} children</Badge>
              <Badge tone="outline" size="sm">{queue.totalAnswers} answers</Badge>
              <Badge tone="good" size="sm">{queue.settled} settled by machine</Badge>
              <Badge tone="warn" size="sm">{queue.items.length} for you</Badge>
            </div>
            <ReviewBoard paperId={paper.id} items={queue.items} coverage={queue.coverage} />
          </>
        )}
      </div>
    </div>
  );
}
