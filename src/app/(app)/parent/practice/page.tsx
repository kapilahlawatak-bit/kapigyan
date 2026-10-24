import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, Heart, Printer } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { studentMasteryMap } from "@/lib/analytics/class";
import { asArray, planFrom } from "@/lib/analytics/view";
import { generateForTopic, topicHasGenerator } from "@/lib/question-generation/templates";
import { TOPIC_BY_ID, STRAND_BY_ID } from "@/lib/curriculum";
import { isAiEnabled } from "@/lib/ai/client";
import { PrintButton, PrintHeader } from "@/components/print-shell";

export const metadata = { title: "Practice at Home" };
export const dynamic = "force-dynamic";

/**
 * Home practice, for a parent to print.
 *
 * The brief for this screen is narrow and worth stating: a parent is not
 * going to log in every evening, and they are not going to read a diagnostic.
 * So the screen has to work at a glance, on a phone, and produce something
 * they can put on the table. That is why it is a short list of three things
 * with a printable sheet attached, and not a dashboard.
 */
export default async function ParentPracticePage(props: PageProps<"/parent/practice">) {
  const sp = await props.searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "PARENT") redirect("/no-access");
  const locale = await getLocale();

  const links = await prisma.parentLink.findMany({
    where: { parentId: session.userId, revokedAt: null },
    include: { student: { select: { id: true, name: true } } },
  });

  const childId = String(sp.child ?? "") || links[0]?.student.id;
  const link = links.find((l) => l.student.id === childId) ?? links[0];

  if (!link) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Practice at Home" titleHi="घर पर अभ्यास" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState icon={<Heart className="size-5" />} title="No children linked" description="Ask the school to link your child, and this page will fill itself in." />
        </Card>
      </div>
    );
  }

  const enrolment = await prisma.enrollment.findFirst({
    where: { studentId: link.student.id },
    select: { classId: true, class: { select: { grade: true } } },
  });
  const grade = (enrolment?.class.grade ?? 3) as 1 | 2 | 3 | 4 | 5;

  const map = await studentMasteryMap(link.student.id, enrolment?.classId);
  const plan = planFrom(link.student.name, map, 0.7, 3);
  const aiOn = isAiEnabled();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Practice at Home"
        titleHi="घर पर अभ्यास"
        description={`Short, printable practice for ${link.student.name.split(" ")[0]}. Ten minutes a day is enough.`}
        locale={locale}
        actions={
          links.length > 1 ? (
            <div className="flex flex-wrap gap-1.5">
              {links.map((l) => (
                <Button
                  key={l.student.id}
                  asChild
                  size="sm"
                  variant={l.student.id === link.student.id ? "primary" : "secondary"}
                >
                  <Link href={`/parent/practice?child=${l.student.id}`}>{l.student.name.split(" ")[0]}</Link>
                </Button>
              ))}
            </div>
          ) : undefined
        }
      />

      <div className="p-5 max-w-3xl w-full space-y-4">
        {plan.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Heart className="size-5" />}
              title="Nothing to practise right now"
              description={`${link.student.name.split(" ")[0]} is secure on everything tested so far. The teacher will set more work when it is needed.`}
            />
          </Card>
        ) : (
          <>
            <Alert tone="info" title="How to use this">
              Do one topic at a time, not all three. Ten focused minutes, five days a week, beats an hour
              of everything at once. Read the question out loud, let your child answer, then check the
              answers at the bottom together.
            </Alert>

            {plan.items.map((item, idx) => {
              const meta = TOPIC_BY_ID.get(item.topicId);
              const canGen = topicHasGenerator(item.topicId);
              const made = canGen ? generateForTopic(item.topicId, 6, grade, hash(item.topicId + grade)) : [];

              return (
                <Card key={item.topicId}>
                  <CardHeader>
                    <div>
                      <CardTitle>{idx + 1}. {meta?.name ?? item.topicName}</CardTitle>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone="outline" size="sm">{STRAND_BY_ID.get(meta?.strand ?? "")?.name}</Badge>
                        {made.length > 0 ? <Badge tone="good" size="sm">{made.length} questions</Badge> : null}
                      </div>
                    </div>
                    {made.length > 0 ? (
                      <div className="flex gap-1.5 no-print">
                        <Button asChild size="sm" variant="secondary">
                          <a href={`/api/practice/${link.student.id}/${item.topicId}`}>
                            <Download className="size-3.5" /> PDF
                          </a>
                        </Button>
                        <Button asChild size="sm" variant="secondary">
                          <a href={`/parent/practice/print?child=${link.student.id}&topic=${item.topicId}`}>
                            <Printer className="size-3.5" /> Print
                          </a>
                        </Button>
                      </div>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <p className="text-[11px] leading-relaxed text-ink-2">{item.why}</p>

                    {made.length === 0 ? (
                      <p className="text-[11px] text-ink-3">
                        No prepared set for this topic yet.{" "}
                        {aiOn
                          ? "The teacher can generate one from the paper generator."
                          : "Ask the teacher to make a practice set from the generator."}
                      </p>
                    ) : (
                      <ol className="space-y-2">
                        {made.map((q, i) => (
                          <li key={i} className="rounded-control border p-3">
                            <p className="text-xs leading-relaxed text-ink">
                              <span className="mr-1.5 font-semibold text-ink-3">{i + 1}.</span>
                              {q.stem}
                            </p>
                            {q.options && q.options.length > 0 ? (
                              <div className="mt-1.5 grid gap-0.5 sm:grid-cols-2">
                                {q.options.map((o, oi) => <p key={oi} className="text-[11px] text-ink-3">{o}</p>)}
                              </div>
                            ) : (
                              <div className="mt-2 h-px w-full bg-line" />
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    <div className="rounded-control border bg-surface-2/40 p-3">
                      <p className="text-[10px] font-semibold text-ink-2">How to help with this</p>
                      <ul className="mt-1 space-y-0.5">
                        {item.whatToDo.map((step) => (
                          <li key={step} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-2">
                            <span className="text-brand">•</span>{step}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {made.length > 0 ? (
                      <details className="rounded-control border p-3">
                        <summary className="cursor-pointer text-[11px] font-semibold text-brand">Show the answers</summary>
                        <ol className="mt-2 space-y-1">
                          {made.map((q, i) => (
                            <li key={i} className="text-[11px] text-ink-2">
                              <span className="mr-1.5 font-semibold text-ink-3">{i + 1}.</span>
                              <span className="font-mono">{q.answerKey}</span>
                              {q.explanation ? <span className="text-ink-4"> — {q.explanation}</span> : null}
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
