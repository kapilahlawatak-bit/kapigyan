import Link from "next/link";
import { BookOpen, CalendarClock, Home as HomeIcon, Sparkles, Users2 } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { classMasteryMap } from "@/lib/analytics/class";
import { meanMastery, classTopicStats } from "@/lib/analytics/view";
import { recommendTeaching, type TopicStat } from "@/lib/intelligence/recommendations";
import { STRANDS, TOPIC_BY_ID, STRAND_BY_ID, STRAND_GAP_THRESHOLD } from "@/lib/curriculum";
import { topicName } from "@/lib/utils";

export const metadata = { title: "Home schooling" };
export const dynamic = "force-dynamic";

/**
 * Home schooling.
 *
 * A home educator is the teacher, the parent and the timetable all at once,
 * so this view is organised around the two things they actually ask: "what
 * should I teach this week" and "is it working". There is no class roster, no
 * roll number ceremony and no institution — just the children at home and the
 * syllabus in front of them.
 */
export default async function HomePage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId },
    orderBy: { grade: "asc" },
    include: { _count: { select: { enrollments: true } } },
  });

  if (classes.length === 0) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Home schooling" titleHi="होम स्कूलिंग" locale={locale} />
        <Card className="m-5 max-w-xl">
          <EmptyState
            icon={<HomeIcon className="size-5" />}
            title="Set up your home classroom"
            description="Add each child as a class. Everything after that — tests, progress, printable practice — builds itself."
            action={<Button asChild size="sm"><Link href="/classes">Add a child</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  const primary = classes[0];
  const mastery = await classMasteryMap(primary.id);

  const strandRows = STRANDS.map((s) => {
    const rows = mastery.filter((m) => TOPIC_BY_ID.get(m.topicId)?.strand === s.id);
    const avg = meanMastery(rows);
    return { id: s.id, name: s.name, nameHi: s.nameHi, color: s.color, mastery: Math.round(avg * 100) };
  });

  const weakTopics = mastery.filter((m) => m.mastery < 0.7);
  const recs = recommendTeaching(classTopicStats(weakTopics), { maxRecommendations: 3 });

  const papers = await prisma.paper.findMany({
    where: { schoolId: session.schoolId },
    orderBy: { date: "desc" },
    take: 5,
    include: { _count: { select: { submissions: true, questions: true } } },
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Home classroom"
        titleHi="घर का कक्षा"
        description="Your week, your children, your syllabus — in one place."
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm"><Link href="/home/curriculum">Curriculum map</Link></Button>
            <Button asChild size="sm"><Link href="/tests/new">Take a test</Link></Button>
          </>
        }
      />

      <div className="p-5 max-w-5xl w-full space-y-5">
        {/* Children */}
        {classes.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <Users2 className="size-3.5" />
                {c.name}
                <Badge tone="outline" size="sm">Class {c.grade}</Badge>
                <Badge tone="neutral" size="sm">{c._count.enrollments} {c._count.enrollments === 1 ? "child" : "children"}</Badge>
              </CardTitle>
              <Button asChild variant="secondary" size="sm"><Link href={`/students?class=${c.id}`}>View progress</Link></Button>
            </CardHeader>
          </Card>
        ))}

        {/* This week */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="size-4 text-brand" />
            <h2 className="text-base font-semibold text-ink">What to teach this week</h2>
          </div>
          {recs.length === 0 ? (
            <Card><EmptyState icon={<BookOpen className="size-5" />} title="Mark a test to get a plan" description="Once you have a test marked, the next three lessons will be chosen for you." action={<Button asChild size="sm"><Link href="/tests/new">Take a test</Link></Button>} /></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {recs.map((r, i) => (
                <Card key={r.topicId}>
                  <CardHeader>
                    <div>
                      <CardTitle><span className="mr-1.5 text-brand">{i + 1}.</span>{r.topicName}</CardTitle>
                      <Badge tone="neutral" size="sm">{r.strandName}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 pt-0">
                    <p className="text-[11px] leading-relaxed text-ink-3">{r.why}</p>
                    <p className="text-[10px] font-semibold text-ink-2">{r.lesson.minutes}-minute plan</p>
                    <ol className="list-decimal space-y-0.5 pl-4 text-[10px] leading-snug text-ink-2">
                      {r.lesson.steps.map((s) => <li key={s.title}>{s.title} ({s.minutes}m)</li>)}
                    </ol>
                    <Button asChild variant="secondary" size="sm" className="w-full">
                      <Link href={`/generator?topics=${r.topicId}`}>Make practice for this</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Strand coverage */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Where you are across the syllabus</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">Class {primary.grade}. Anything under {STRAND_GAP_THRESHOLD}% is worth another pass.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-2.5 pt-0">
            {strandRows.map((s) => (
              <div key={s.id}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="flex items-center gap-1.5 text-ink-2">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    {s.name} <span className="text-ink-4">{s.nameHi}</span>
                  </span>
                  <span className={`font-semibold tabular-nums ${s.mastery >= 70 ? "text-good" : s.mastery >= STRAND_GAP_THRESHOLD ? "text-warn" : "text-bad"}`}>
                    {s.mastery}%
                  </span>
                </div>
                <Progress value={s.mastery} tone={s.mastery >= 70 ? "good" : s.mastery >= STRAND_GAP_THRESHOLD ? "warn" : "bad"} className="mt-1" />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Recent */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Recent work</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">Tests you have taken at home.</p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {papers.length === 0 ? (
              <EmptyState icon={<CalendarClock className="size-5" />} title="Nothing yet" description="Upload a test you did at the kitchen table." />
            ) : (
              <div className="space-y-1.5">
                {papers.map((p) => (
                  <Link key={p.id} href={`/tests/${p.id}`} className="flex items-center gap-2 rounded-control border p-2.5 hover:border-brand transition-colors">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{p.title}</span>
                    <Badge tone="outline" size="sm">{p._count.questions} Q</Badge>
                    <Badge tone="neutral" size="sm">{p._count.submissions} marked</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
