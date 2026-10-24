import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, CheckCircle2, FileStack, XCircle } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { formatDate, gradeBand } from "@/lib/utils";

export const metadata = { title: "My Tests" };
export const dynamic = "force-dynamic";

/**
 * A child's own test history.
 *
 * Each card shows what they got right and what they got wrong, in words a
 * nine-year-old can act on ("3 out of 5 number questions"), rather than a
 * percentage that means nothing at that age. The teacher has already seen
 * the analytics; this view is for the child.
 */
export default async function MeTestsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "STUDENT") redirect("/no-access");
  const locale = await getLocale();

  const link = await prisma.enrollment.findFirst({
    where: { student: { userId: session.userId } },
    include: { student: true },
  });

  if (!link) {
    return (
      <div className="flex flex-col">
        <PageHeader title="My Tests" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState icon={<FileStack className="size-5" />} title="No tests yet" description="Your teacher will give you one soon." />
        </Card>
      </div>
    );
  }

  const submissions = await prisma.submission.findMany({
    where: { studentId: link.student.id, status: "GRADED" },
    include: {
      paper: { select: { id: true, title: true, date: true, maxMarks: true } },
      answers: { include: { paperQuestion: { select: { stem: true, position: true, topicId: true, explanation: true } } } },
    },
    orderBy: { gradedAt: "desc" },
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="My Tests"
        titleHi="मेरी परीक्षाएँ"
        description={submissions.length > 0 ? `${submissions.length} tests taken.` : undefined}
        locale={locale}
      />

      <div className="p-5 max-w-3xl w-full space-y-4">
        {submissions.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileStack className="size-5" />}
              title="No tests yet"
              description="When you do a test, it will appear here so you can see what you got right."
              action={<Button asChild size="sm"><Link href="/me/practice">Practise instead</Link></Button>}
            />
          </Card>
        ) : (
          submissions.map((s) => {
            const percent = s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0;
            const wrong = s.answers.filter((a) => a.isCorrect === false);
            const blank = s.answers.filter((a) => a.isCorrect === null);
            return (
              <Card key={s.id}>
                <CardHeader>
                  <div>
                    <CardTitle>{s.paper.title}</CardTitle>
                    <p className="mt-0.5 text-[11px] text-ink-3">{formatDate(s.paper.date, true)}</p>
                  </div>
                  <Badge tone={percent >= 70 ? "good" : percent >= 45 ? "warn" : "bad"} size="lg">
                    {s.score} / {s.maxScore} · {gradeBand(percent).label}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <Progress
                    value={percent}
                    tone={percent >= 70 ? "good" : percent >= 45 ? "warn" : "bad"}
                  />

                  <div className="flex flex-wrap gap-2">
                    <span className="flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-[11px] text-good">
                      <CheckCircle2 className="size-3" />
                      {s.answers.length - wrong.length - blank.length} right
                    </span>
                    {wrong.length > 0 ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-bad-soft px-2.5 py-1 text-[11px] text-bad">
                        <XCircle className="size-3" />
                        {wrong.length} to work on
                      </span>
                    ) : null}
                    {blank.length > 0 ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-ink-3">
                        {blank.length} left blank
                      </span>
                    ) : null}
                  </div>

                  {wrong.length > 0 ? (
                    <details className="rounded-control border bg-surface-2/40 p-3">
                      <summary className="cursor-pointer text-[11px] font-semibold text-ink-2">
                        See how to fix them
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {wrong.slice(0, 8).map((a) => (
                          <li key={a.id}>
                            <p className="text-[11px] text-ink-2">
                              <span className="font-semibold text-ink-3">Q{a.paperQuestion.position}.</span>{" "}
                              {a.paperQuestion.stem}
                            </p>
                            {a.paperQuestion.explanation ? (
                              <p className="mt-0.5 text-[10px] leading-snug text-ink-4">
                                {a.paperQuestion.explanation}
                              </p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  <Button asChild variant="secondary" size="sm">
                    <Link href="/me/practice"><BookOpen className="size-3.5" /> Practise more</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
