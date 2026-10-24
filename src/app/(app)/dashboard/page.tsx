import Link from "next/link";
import {
  ArrowRight, Brain, ClipboardCheck, FileStack, Sparkles, TrendingDown, TrendingUp,
  TriangleAlert, Users, Wand2,
} from "lucide-react";
import { requireSession } from "@/lib/auth/guard";
import { canTeach, type Role, type UserMode } from "@/lib/auth/roles";
import { prisma } from "@/lib/db";
import { getLocale, t } from "@/lib/i18n";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, More, Progress } from "@/components/ui/primitives";
import { MISCONCEPTION_BY_ID, STRAND_BY_ID, TOPIC_BY_ID, gradeBand } from "@/lib/curriculum";
import { classMasteryMap, studentMasteryMap } from "@/lib/analytics/class";
import { assessRisk, type RiskLevel } from "@/lib/intelligence/mastery";
import { recommendTeaching, type TopicStat } from "@/lib/intelligence/recommendations";
import { formatDate, relativeTime, cn } from "@/lib/utils";
import { ScoreTrend } from "@/components/charts";

export const metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const locale = await getLocale();

  if (session.role === "STUDENT") {
    const { redirect } = await import("next/navigation");
    redirect("/me");
  }
  if (session.role === "PARENT") {
    const { redirect } = await import("next/navigation");
    redirect("/parent");
  }

  const schoolId = session.schoolId!;
  const isHome = session.mode === "HOME";

  const [classes, recentPapers, studentCount, aiOn] = await Promise.all([
    prisma.class.findMany({
      where: { schoolId, ...(session.role === "TEACHER" ? { teacherId: session.userId } : {}) },
      include: { _count: { select: { enrollments: true } } },
      orderBy: { grade: "asc" },
    }),
    prisma.paper.findMany({
      where: { schoolId, ...(isHome ? { createdBy: session.userId } : {}) },
      orderBy: { date: "desc" },
      take: 6,
      include: { _count: { select: { submissions: true, questions: true } } },
    }),
    prisma.student.count({ where: { enrollments: { some: { class: { schoolId } } } } }),
    Promise.resolve(Boolean(process.env.OPENAI_API_KEY && process.env.AI_ALLOW_UPLOADS !== "0")),
  ]);

  const primaryClass = classes[0];

  // The class-level mastery map, which is what the recommendations are built on.
  const masteryRows = primaryClass ? await classMasteryMap(primaryClass.id) : [];

  const misconceptionTotals = await prisma.answer.groupBy({
    by: ["errorTag"],
    where: {
      errorTag: { not: null },
      submission: { paper: { classId: primaryClass?.id ?? "__none__" } },
    },
    _count: { _all: true },
    orderBy: { _count: { errorTag: "desc" } },
    take: 5,
  });

  const topicStats: TopicStat[] = masteryRows.map((m) => ({
    topicId: m.topicId,
    mastery: m.mastery,
    studentsWeak: Math.round(m.gap * m.assessed),
    studentsAssessed: m.assessed,
    questionsOnPaper: 0,
    misconceptionCounts: {},
  }));

  const recommendations = recommendTeaching(topicStats, { maxRecommendations: 2 });

  // At-risk children, computed per child rather than from a single score.
  const riskList = primaryClass
    ? await buildRiskList(primaryClass.id)
    : [];

  const trendRows = recentPapers
    .filter((p) => p._count.submissions > 0)
    .map((p) => ({ label: p.title.slice(0, 14), percent: 0 }));

  const firstName = session.name.split(" ")[0];

  return (
    <div className="flex flex-col">
      <PageHeader
        title={`Namaste, ${firstName}`}
        titleHi={`नमस्ते, ${firstName}`}
        description={
          isHome
            ? "Your home classroom — what to teach next, and how each child is doing."
            : "Where the class stands, and what to teach in the next period."
        }
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href="/generator"><Wand2 className="size-3.5" /> {t(locale, "generate")}</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/tests/new">{t(locale, "upload")}</Link>
            </Button>
          </>
        }
      />

      <div className="p-5 space-y-5 max-w-[1400px] w-full">
        {/* Stat tiles */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatTile
            icon={<Users className="size-4" />}
            label={t(locale, "classes")}
            value={String(classes.length)}
            sub={`${studentCount} ${t(locale, "students").toLowerCase()}`}
            href="/classes"
          />
          <StatTile
            icon={<FileStack className="size-4" />}
            label="Papers"
            value={String(recentPapers.length)}
            sub={recentPapers[0] ? `Latest ${relativeTime(recentPapers[0].date)}` : "None yet"}
            href="/tests"
          />
          <StatTile
            icon={<ClipboardCheck className="size-4" />}
            label={t(locale, "atRisk")}
            value={String(riskList.filter((r) => r.level !== "low").length)}
            sub="Children below the bar"
            href="/students"
            tone={riskList.filter((r) => r.level !== "low").length > 0 ? "warn" : "good"}
          />
          <StatTile
            icon={<Brain className="size-4" />}
            label="AI assist"
            value={aiOn ? "On" : "Off"}
            sub={aiOn ? "Reading papers, generating questions" : "Built-in generators still work"}
            href="/settings"
            tone={aiOn ? "good" : "neutral"}
          />
        </div>

        {/* Teach this next */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-brand" />
                What to teach in the next period
              </CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Ranked by how weak the class is, how many children it affects, and what later work depends on it.
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/insights">All insights <ArrowRight className="size-3" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recommendations.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title="Not enough graded work yet"
                description="Upload or generate one test and mark it. After that, this panel will tell you which two things are worth a lesson."
                action={
                  <Button asChild size="sm">
                    <Link href="/tests/new">Create the first test</Link>
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {recommendations.map((r, i) => {
                  const strand = STRAND_BY_ID.get(r.strand);
                  return (
                    <div key={r.topicId} className="rounded-control border bg-surface-2/50 p-4">
                      <div className="flex items-start gap-2.5">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-ink">{r.topicName}</p>
                          <p className="text-[11px] text-ink-3 mt-0.5">{r.headline}</p>
                        </div>
                        {strand ? (
                          <Badge tone="neutral" size="sm">
                            <span className="size-1.5 rounded-full" style={{ background: strand.color }} />
                            {strand.name}
                          </Badge>
                        ) : null}
                      </div>

                      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-2">{r.why}</p>

                      {/* The reasoning behind the ranking and the lesson itself
                          are worth having and are not worth reading twice a
                          day, so both sit behind one line. */}
                      <More summary="Lesson plan and why this ranks here" className="mt-2.5">
                        <div className="rounded-[0.5rem] border bg-surface p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-4 mb-1.5">
                            {r.lesson.minutes}-minute plan · {r.lesson.steps[0]?.title}
                          </p>
                          <p className="text-[11px] text-ink-2 leading-relaxed">{r.lesson.steps[0]?.do}</p>
                          <p className="mt-1.5 text-[11px] italic text-ink-3">“{r.lesson.steps[0]?.say}”</p>
                          <p className="mt-2 text-[10px] text-ink-4">
                            <span className="font-medium">Materials:</span> {r.lesson.steps[0]?.materials}
                          </p>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-ink-4">
                          <Factor label="Severity" value={r.factors.severity} />
                          <Factor label="Reach" value={r.factors.reach} />
                          <Factor label="Leverage" value={r.factors.leverage} />
                        </div>
                      </More>

                      <div className="mt-2 flex justify-end">
                        <Button asChild variant="ghost" size="sm" className="h-6 text-[11px]">
                          <Link href={`/insights#${r.topicId}`}>Details</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* At-risk */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <TriangleAlert className="size-3.5 text-warn" />
                Children who need attention
              </CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/students">All students <ArrowRight className="size-3" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {riskList.length === 0 ? (
                <EmptyState title="No children flagged" description="Risk is assessed once a child has at least one graded test." />
              ) : (
                <ul className="divide-y divide-line-2">
                  {riskList.slice(0, 5).map((r) => (
                    <li key={r.studentId} className="flex items-start gap-3 py-2.5">
                      <span
                        className={cn(
                          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                          r.level === "high" ? "bg-bad-soft text-bad" : r.level === "watch" ? "bg-warn-soft text-warn" : "bg-good-soft text-good",
                        )}
                      >
                        {r.score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-ink">{r.name}</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{r.reasons[0]}</p>
                        {r.topics.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.topics.slice(0, 3).map((tp) => (
                              <Badge key={tp.topicId} tone="bad" size="sm">
                                {TOPIC_BY_ID.get(tp.topicId)?.name ?? tp.topicId} {Math.round(tp.mastery * 100)}%
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <RiskTrend trend={r.trend} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Misconceptions */}
          <Card>
            <CardHeader>
              <CardTitle>Most common wrong ideas</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {misconceptionTotals.length === 0 ? (
                <EmptyState title="No patterns found yet" description="Once a test is marked, the ideas behind the wrong answers appear here." />
              ) : (
                <ul className="space-y-2.5">
                  {misconceptionTotals.map((m) => {
                    const meta = MISCONCEPTION_BY_ID.get(m.errorTag!);
                    if (!meta) return null;
                    const count = m._count._all;
                    const max = misconceptionTotals[0]._count._all;
                    return (
                      <li key={m.errorTag}>
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-[11px] font-medium text-ink leading-snug">{meta.name}</p>
                          <span className="shrink-0 text-[10px] tabular-nums text-ink-4">{count}</span>
                        </div>
                        <div className="mt-1 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                          <div className="h-full rounded-full bg-bad" style={{ width: `${(count / max) * 100}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] leading-snug text-ink-4">{meta.belief}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent tests */}
        <Card>
          <CardHeader>
            <CardTitle>Recent tests</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/tests">All tests <ArrowRight className="size-3" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {recentPapers.length === 0 ? (
              <EmptyState
                icon={<FileStack className="size-5" />}
                title="No tests yet"
                description="Upload a paper you already have, or generate one from the syllabus."
                action={
                  <div className="flex gap-2">
                    <Button asChild size="sm"><Link href="/tests/new">Upload</Link></Button>
                    <Button asChild size="sm" variant="secondary"><Link href="/generator">Generate</Link></Button>
                  </div>
                }
              />
            ) : (
              <ul className="divide-y divide-line-2">
                {recentPapers.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/tests/${p.id}`} className="text-xs font-medium text-ink hover:text-brand">
                        {p.title}
                      </Link>
                      <p className="mt-0.5 text-[11px] text-ink-4">
                        Class {p.grade} · {p.term} · {p._count.questions} questions · {p._count.submissions} marked · {formatDate(p.date, true)}
                      </p>
                    </div>
                    <Badge tone="neutral" size="sm">{p.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {trendRows.length > 1 ? (
          <Card>
            <CardHeader><CardTitle>Class average over recent tests</CardTitle></CardHeader>
            <CardContent><ScoreTrend data={trendRows} /></CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function StatTile({
  icon, label, value, sub, href, tone = "neutral",
}: {
  icon: React.ReactNode; label: string; value: string; sub: string; href: string; tone?: "neutral" | "good" | "warn";
}) {
  return (
    <Link href={href} className="card p-3.5 transition-colors hover:border-brand/50">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-[0.5rem]",
            tone === "good" ? "bg-good-soft text-good" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand",
          )}
        >
          {icon}
        </span>
        <span className="text-[11px] font-medium text-ink-3">{label}</span>
      </div>
      <p className="mt-2 text-xl font-bold tracking-tight text-ink tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-ink-4 transition-colors group-hover:text-ink-3">{sub}</p>
    </Link>
  );
}

function Factor({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-1">
      {label}
      <span className="font-semibold text-ink-3">{value.toFixed(2)}</span>
    </span>
  );
}

function RiskTrend({ trend }: { trend: string }) {
  if (trend === "improving") return <TrendingUp className="size-3.5 shrink-0 text-good" aria-label="Improving" />;
  if (trend === "declining") return <TrendingDown className="size-3.5 shrink-0 text-bad" aria-label="Declining" />;
  return null;
}

/* ------------------------------------------------------------------ */
/* Risk list                                                           */
/* ------------------------------------------------------------------ */

async function buildRiskList(classId: string) {
  const students = await prisma.student.findMany({
    where: { enrollments: { some: { classId } } },
    select: { id: true, name: true, rollNo: true },
    orderBy: { rollNo: "asc" },
  });

  const out: {
    studentId: string; name: string; score: number; level: RiskLevel; reasons: string[];
    topics: { topicId: string; mastery: number }[]; trend: string;
  }[] = [];

  for (const s of students) {
    const [mastery, subs] = await Promise.all([
      studentMasteryMap(s.id, classId),
      prisma.submission.findMany({
        where: { studentId: s.id, status: "GRADED", paper: { classId } },
        select: { score: true, maxScore: true },
        orderBy: { gradedAt: "asc" },
      }),
    ]);

    if (Object.keys(mastery).length === 0) continue;

    const topics = Object.entries(mastery)
      .map(([topicId, m]) => ({ topicId, mastery: m.mastery }))
      .sort((a, b) => a.mastery - b.mastery);

    const recentScores = subs.map((x) => (x.maxScore > 0 ? (x.score / x.maxScore) * 100 : 0));
    const trends = Object.values(mastery).map((m) => m.trend);
    const trend = trends.includes("declining") ? "declining" : trends.includes("improving") ? "improving" : "steady";

    const risk = assessRisk({
      topicMastery: Object.fromEntries(Object.entries(mastery).map(([k, v]) => [k, v])),
      recentScores,
    });

    out.push({ studentId: s.id, name: s.name, score: risk.score, level: risk.level, reasons: risk.reasons, topics, trend });
  }

  return out.sort((a, b) => b.score - a.score);
}
