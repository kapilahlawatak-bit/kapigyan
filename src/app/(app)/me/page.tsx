import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, Dumbbell, Sparkles, Trophy } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { MasteryBars } from "@/components/charts";
import { studentMasteryMap } from "@/lib/analytics/class";
import { asArray, meanMastery, planFrom } from "@/lib/analytics/view";
import { TOPIC_BY_ID, gradeBand } from "@/lib/curriculum";
import { formatDate, topicName } from "@/lib/utils";

export const metadata = { title: "My progress" };
export const dynamic = "force-dynamic";

/**
 * The student's own view.
 *
 * Deliberately short and deliberately kind. A Class 2 child opening this
 * should see a star for what they have got right, three things to try, and
 * nothing that looks like a failure. Percentages are deliberately absent —
 * a ten-year-old does not benefit from being told they are "at 62%".
 */
export default async function MePage() {
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
        <PageHeader title="My progress" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState icon={<Sparkles className="size-5" />} title="Nothing here yet" description="Your teacher will set up your maths page." />
        </Card>
      </div>
    );
  }

  const student = link.student;
  const mastery = await studentMasteryMap(student.id, link.classId);
  const rows = asArray(mastery);
  const avg = meanMastery(rows);
  const strong = [...rows].sort((a, b) => b.mastery - a.mastery).slice(0, 3);
  const weak = rows.filter((m) => m.mastery < 0.7).sort((a, b) => a.mastery - b.mastery);
  const plan = planFrom(student.name, mastery, 0.7);

  const submissions = await prisma.submission.findMany({
    where: { studentId: student.id },
    include: { paper: { select: { id: true, title: true, date: true, maxMarks: true } } },
    orderBy: { gradedAt: "desc" },
    take: 5,
  });

  const stars = Math.max(1, Math.round(avg * 5));

  return (
    <div className="flex flex-col">
      <PageHeader
        title={`Hello, ${student.name.split(" ")[0]}`}
        titleHi={`नमस्ते, ${student.name.split(" ")[0]}`}
        description={`${link.class.name} · your maths so far`}
        locale={locale}
      />

      <div className="p-5 max-w-3xl w-full space-y-4">
        {/* Stars */}
        <Card className="overflow-hidden">
          <CardContent className="pt-6 text-center">
            <div className="flex justify-center gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <Trophy key={i} className={`size-7 ${i < stars ? "text-warn" : "text-line"}`} />
              ))}
            </div>
            <p className="mt-2 text-base font-semibold text-ink">
              {avg >= 0.85 ? "You are doing brilliantly!" : avg >= 0.7 ? "You are doing well." : avg >= 0.5 ? "You are getting there." : "Every step counts — keep practising."}
            </p>
            <p className="mt-1 text-xs text-ink-3">You have worked out {Math.round(avg * 100)}% of your maths so far.</p>
          </CardContent>
        </Card>

        {/* Strong */}
        {strong.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-good"><Trophy className="size-3.5" /> You are good at</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {strong.map((m) => (
                <div key={m.topicId} className="flex items-center gap-2.5">
                  <span className="text-good">★</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{topicName(m.topicId)}</span>
                  <Badge tone="good" size="sm">{Math.round(m.mastery * 100)}%</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {/* Practice */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5"><Dumbbell className="size-3.5 text-brand" /> Try these next</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">Three short things to get better at.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-0">
            {plan.items.length === 0 ? (
              <p className="text-xs text-ink-2">You have done everything for now. Your teacher will give you more soon.</p>
            ) : (
              plan.items.map((it) => (
                <div key={it.topicId} className="rounded-control border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">{it.topicName}</p>
                    <Badge tone="warn" size="sm">try next</Badge>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {it.whatToDo.slice(0, 2).map((s) => (
                      <li key={s} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-2">
                        <span className="text-brand">•</span>{s}
                      </li>
                    ))}
                  </ul>
                  <Button asChild variant="secondary" size="sm" className="mt-2 w-full">
                    <Link href={`/generator?topics=${it.topicId}`}><BookOpen className="size-3.5" /> Practise this</Link>
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent results */}
        <Card>
          <CardHeader><CardTitle>My tests</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {submissions.length === 0 ? (
              <EmptyState icon={<BookOpen className="size-5" />} title="No tests yet" description="Your teacher will give you one soon." />
            ) : (
              <div className="space-y-1.5">
                {submissions.map((s) => {
                  const p = s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0;
                  return (
                    // Was `/tests/${id}/mine`, which has never existed — a child
                    // clicking their own result got a 404. `/me/tests` is the
                    // page that actually shows a student's marked work.
                    <Link key={s.id} href="/me/tests" className="flex items-center gap-2 rounded-control border p-2.5 hover:border-brand transition-colors">
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{s.paper.title}</span>
                      <span className="text-[10px] text-ink-4">{formatDate(s.paper.date)}</span>
                      <Badge tone={p >= 70 ? "good" : p >= 45 ? "warn" : "bad"} size="sm">{Math.round(p)}%</Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
