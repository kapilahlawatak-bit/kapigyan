import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Dumbbell, Sparkles } from "lucide-react";
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
import { retrievalFor } from "@/lib/analytics/retrieval-data";

export const metadata = { title: "Practice" };
export const dynamic = "force-dynamic";

/**
 * A child's own practice set, generated on the spot.
 *
 * Questions are produced by the deterministic generators, so every answer is
 * correct by construction and the whole thing works with no network. If a
 * topic has no generator the card says so and offers the paper generator
 * instead of silently showing nothing.
 */
export default async function MePracticePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "STUDENT") redirect("/no-access");
  const locale = await getLocale();

  const link = await prisma.enrollment.findFirst({
    where: { student: { userId: session.userId } },
    include: { student: true, class: { select: { name: true, grade: true } } },
  });

  if (!link) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Practice" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState icon={<Sparkles className="size-5" />} title="Nothing to practise yet" description="Your teacher will set up your maths page." />
        </Card>
      </div>
    );
  }

  const grade = link.class.grade as 1 | 2 | 3 | 4 | 5;
  const map = await studentMasteryMap(link.student.id, link.classId);
  const topics = asArray(map);
  const plan = planFrom(link.student.name, map, 0.8, 3);
  const aiOn = isAiEnabled();

  // Retrieval schedule: what this child should revisit today, and why. Built
  // from every time they were asked, not just what they got wrong.
  const retrieval = await retrievalFor(link.student.id, 3);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Practice"
        titleHi="अभ्यास"
        description={`Questions picked for ${link.student.name.split(" ")[0]}, on the topics that need work.`}
        locale={locale}
      />

      <div className="p-5 max-w-3xl w-full space-y-4">
        {retrieval.topics.length > 0 ? (
          <Alert tone="info" title={retrieval.headline}>
            Each one is scheduled by when you last practised it, not just by what you got wrong. Things
            fade fastest when you do not use them, so a short revisit today is worth more than a long
            session next week.
          </Alert>
        ) : null}

        {retrieval.topics.map((t) => {
          const meta = TOPIC_BY_ID.get(t.topicId);
          const canGenerate = topicHasGenerator(t.topicId);
          const made = canGenerate
            ? generateForTopic(t.topicId, 3, grade, hash(t.topicId + grade + t.reviewNumber))
            : [];
          return (
            <Card key={t.topicId} className={t.urgent ? "border-warn/40" : undefined}>
              <CardHeader>
                <div>
                  <CardTitle>{t.topicName}</CardTitle>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone="outline" size="sm">{STRAND_BY_ID.get(meta?.strand ?? "")?.name}</Badge>
                    <Badge tone={t.urgent ? "warn" : "good"} size="sm">
                      {Math.round(t.mastery * 100)}% · review {t.reviewNumber}
                    </Badge>
                    {made.length > 0 ? <Badge tone="good" size="sm">{made.length} questions</Badge> : null}
                  </div>
                </div>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`/api/practice/${link.student.id}/${t.topicId}`}>
                    <Dumbbell className="size-3.5" /> Printable
                  </a>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <p className="text-[11px] leading-relaxed text-ink-2">{t.why}</p>
                {made.length === 0 ? (
                  <Alert tone="info" title="No built-in practice for this topic yet">
                    {aiOn
                      ? "The paper generator can write a fresh set for it — try that."
                      : "Set OPENAI_API_KEY and the generator can write one."}
                  </Alert>
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
                            {q.options.map((o, oi) => (
                              <p key={oi} className="text-[11px] text-ink-3">{o}</p>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-2 h-px w-full bg-line" />
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          );
        })}

        {plan.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Sparkles className="size-5" />}
              title="You are on top of everything"
              description="Every topic tested so far is secure. Ask your teacher for harder work."
            />
          </Card>
        ) : (
          plan.items.map((item) => {
            const meta = TOPIC_BY_ID.get(item.topicId);
            const canGenerate = topicHasGenerator(item.topicId);
            const made = canGenerate
              ? generateForTopic(item.topicId, 6, grade, hash(item.topicId + grade))
              : [];

            return (
              <Card key={item.topicId}>
                <CardHeader>
                  <div>
                    <CardTitle>{meta?.name ?? item.topicName}</CardTitle>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge tone="outline" size="sm">{STRAND_BY_ID.get(meta?.strand ?? "")?.name}</Badge>
                      {made.length > 0 ? <Badge tone="good" size="sm">{made.length} questions</Badge> : null}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={undefined} asChild>
                    <a href={`/api/practice/${link.student.id}/${item.topicId}`}>
                      <Dumbbell className="size-3.5" /> Printable
                    </a>
                  </Button>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="text-[11px] leading-relaxed text-ink-2">{item.why}</p>

                  {made.length === 0 ? (
                    <Alert tone="info" title="No built-in practice for this topic yet">
                      {aiOn
                        ? "The paper generator can write a fresh set for it — try that."
                        : "Set OPENAI_API_KEY and the generator can write one. Until then, use the paper generator's built-in fallback."}
                    </Alert>
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
                              {q.options.map((o, oi) => (
                                <p key={oi} className="text-[11px] text-ink-3">{o}</p>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-2 h-px w-full bg-line" />
                          )}
                        </li>
                      ))}
                    </ol>
                  )}

                  <details className="rounded-control border bg-surface-2/40 p-3">
                    <summary className="cursor-pointer text-[11px] font-semibold text-brand">
                      Show the answers
                    </summary>
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

                  <div className="flex flex-wrap gap-2">
                    {item.whatToDo.map((step) => (
                      <span key={step} className="rounded-full border bg-surface px-2.5 py-1 text-[10px] text-ink-2">
                        {step}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}

        <Card>
          <CardContent className="pt-4 flex flex-wrap items-center gap-3">
            <BookOpen className="size-4 shrink-0 text-ink-3" />
            <p className="min-w-0 flex-1 text-[11px] text-ink-3">
              Want more questions than this? Generate a full paper for {link.class.name} from the syllabus.
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link href="/generator">Paper generator</Link>
            </Button>
          </CardContent>
        </Card>
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
