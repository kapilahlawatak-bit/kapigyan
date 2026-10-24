import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Gauge, Save, AlertTriangle } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { markAll } from "@/app/actions/papers";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, Textarea } from "@/components/ui/primitives";
import { topicName } from "@/lib/utils";
import { QUESTION_TYPE_BY_ID } from "@/lib/curriculum";
import { cn } from "@/lib/utils";
import { reviewQueue } from "@/lib/analytics/review-queue";

export const dynamic = "force-dynamic";

/**
 * Marking screen.
 *
 * One text box per question per student on a single page, so a teacher can
 * type a whole class's marks in one sitting instead of opening each answer
 * sheet separately. Blank is meaningful: leave a box empty and the child is
 * recorded as "did not attempt", which is a different problem from a wrong
 * answer and produces a different lesson plan.
 */
export default async function MarkPage(props: PageProps<"/tests/[id]/mark">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { position: "asc" } },
      class: { include: { enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } } } },
      submissions: { include: { student: { select: { id: true } } } },
    },
  });
  if (!paper || paper.schoolId !== session.schoolId) notFound();
  // This is the page that writes marks, so school membership is not enough —
  // only the teacher who owns the class may mark it.
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const students = paper.class?.enrollments ?? [];
  if (students.length === 0) {
    return (
      <div className="flex flex-col">
        <PageHeader title={paper.title} locale={locale} />
        <Card className="m-5">
          <EmptyState
            icon={<AlertTriangle className="size-5" />}
            title="No students in this class yet"
            description="Add your students first, then come back to mark."
            action={<Button asChild size="sm"><Link href="/classes">Add students</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  const alreadyDone = new Set(paper.submissions.map((s) => s.studentId));

  // How much of this paper is genuinely the teacher's job, so the count is
  // known before they scroll rather than after.
  const queue = await reviewQueue(paper.id);
  const needsHuman = queue.items.length;
  const totalAnswers = queue.totalAnswers;

  return (
    <div className="flex flex-col">
      <PageHeader
        title={`Mark: ${paper.title}`}
        description="Type what each child wrote. Leave it empty if they did not attempt the question."
        locale={locale}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href={`/tests/${paper.id}`}><ChevronLeft className="size-3.5" /> Back to test</Link>
          </Button>
        }
      />

      <div className="p-5 max-w-[1500px] w-full space-y-4">
        <Alert tone="info" title="How marking works">
          Answers are compared to the key exactly, but loosely enough to accept{' '}
          <span className="font-mono">1 3</span>, <span className="font-mono">13.0</span>,{' '}
          <span className="font-mono">thirteen</span> and <span className="font-mono">१३</span> for the same
          answer. Each wrong answer is then checked against the misconceptions in the question bank, so
          you find out <em>why</em> it is wrong. Long answers are saved with the machine&apos;s suggestion
          and flagged for your judgement — they are never auto-final.
        </Alert>

        {paper.questions.some((q) => !q.topicId) ? (
          <Alert tone="warn" title="Some questions have no topic">
            Without a topic those answers still get marked, but they will not appear in the topic analysis.
          </Alert>
        ) : null}

        {needsHuman > 0 ? (
          <Card>
            <CardContent className="pt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 text-[11px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">{needsHuman} of {totalAnswers} answers need a person.</span>{" "}
                The rest are settled. Fast Review shows only those, one at a time, decided with two keys.
              </p>
              <Button asChild size="sm">
                <Link href={`/tests/${paper.id}/review`}>
                  <Gauge className="size-3" /> Review {needsHuman} answers
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <form action={markAll} className="space-y-4">
          <input type="hidden" name="paperId" value={paper.id} />

          {/* Question reference strip */}
          <Card>
            <CardHeader>
              <CardTitle>Question key</CardTitle>
              <Badge tone="outline" size="lg">{paper.questions.length} questions · {paper.maxMarks} marks</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="space-y-1.5">
                {paper.questions.map((q) => {
                  const options = parseJson<string[]>(q.options, []);
                  return (
                    <li key={q.id} className="flex gap-2.5 text-xs">
                      <span className="font-semibold text-ink tabular-nums shrink-0 w-5">{q.position}.</span>
                      <span className="min-w-0 flex-1 text-ink-2">
                        {q.stem}
                        {options.length > 0 ? (
                          <span className="text-ink-4"> {options.join("  ")}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-ink-4">{topicName(q.topicId)}</span>
                      <span className="shrink-0 font-semibold text-ink-3 tabular-nums">[{q.answerKey}]</span>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          {/* One block per student */}
          {students.map((enrol) => {
            const s = enrol.student;
            return (
              <Card key={s.id}>
                <CardHeader>
                  <CardTitle>
                    <span className="text-ink-3 tabular-nums mr-2">{s.rollNo ?? "–"}</span>
                    {s.name}
                    {alreadyDone.has(s.id) ? (
                      <Badge tone="good" size="sm" className="ml-2">already marked</Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {paper.questions.map((q) => {
                      const type = QUESTION_TYPE_BY_ID.get(q.type);
                      return (
                        <div key={q.id} className="space-y-1">
                          <Label className="flex items-center justify-between gap-1">
                            <span className="tabular-nums">Q{q.position}</span>
                            <span className="font-normal text-ink-4">{type?.name} · {q.marks}m</span>
                          </Label>
                          <Input
                            name={`q_${s.id}_${q.id}`}
                            placeholder={q.type === "mcq" ? "A/B/C/D" : "answer"}
                            className="h-9 text-xs"
                            autoComplete="off"
                          />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <div className="sticky bottom-4 z-20 flex items-center gap-3 rounded-control border bg-surface px-4 py-3 shadow-pop">
            <p className="text-[11px] text-ink-3">
              Marking {students.length} students. Anything marked &quot;already marked&quot; will be replaced.
            </p>
            <Button type="submit" className="ml-auto">
              <Save className="size-3.5" /> Save and analyse all
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
