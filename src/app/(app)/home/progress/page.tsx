import Link from "next/link";
import { Download, TrendingDown, TrendingUp } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { studentMasteryMap } from "@/lib/analytics/class";
import { asArray, meanMastery, riskFor } from "@/lib/analytics/view";
import { STRAND_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import { topicName } from "@/lib/utils";

export const metadata = { title: "Progress" };
export const dynamic = "force-dynamic";

/**
 * Progress across every child a home educator is responsible for.
 *
 * The home-schooling equivalent of the class roster, except each "class" is
 * one child and the comparison that matters is against the syllabus rather
 * than against classmates — a home educator has no peer group to benchmark
 * against, so the gap line here is the curriculum, not the room.
 */
export default async function HomeProgressPage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId },
    orderBy: { grade: "asc" },
    include: { enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } } },
  });

  if (classes.length === 0) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Progress" titleHi="प्रगति" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState
            icon={<TrendingUp className="size-5" />}
            title="No children yet"
            description="Add a child and their progress will appear here automatically once a test is marked."
            action={<Button asChild size="sm"><Link href="/classes">Add a child</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Progress"
        titleHi="प्रगति"
        description="Where each child is against the syllabus, topic by topic."
        locale={locale}
      />

      <div className="p-5 max-w-5xl w-full space-y-5">
        {classes.map(async (cls) => {
          const rows = await Promise.all(
            cls.enrollments.map(async (e) => {
              const map = await studentMasteryMap(e.studentId, cls.id);
              const topics = asArray(map);
              return {
                student: e.student,
                topics,
                avg: meanMastery(topics),
                risk: riskFor(map),
                assessed: topics.length,
              };
            }),
          );

          return (
            <Card key={cls.id}>
              <CardHeader>
                <div>
                  <CardTitle>{cls.name}</CardTitle>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="outline" size="sm">Class {cls.grade}</Badge>
                    <Badge tone="neutral" size="sm">{rows.length} {rows.length === 1 ? "child" : "children"}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {rows.length === 0 ? (
                  <p className="text-xs text-ink-3">No children in this class yet.</p>
                ) : (
                  rows.map((r) => {
                    const weak = [...r.topics].sort((a, b) => a.mastery - b.mastery).slice(0, 3);
                    const byStrand = new Map<string, number[]>();
                    for (const m of r.topics) {
                      const s = STRAND_BY_ID.get(TOPIC_BY_ID.get(m.topicId)?.strand ?? "");
                      if (s) byStrand.set(s.id, [...(byStrand.get(s.id) ?? []), m.mastery]);
                    }
                    return (
                      <div key={r.student.id} className="rounded-control border p-3.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link href={`/students/${r.student.id}`} className="text-xs font-semibold text-ink hover:text-brand">
                            {r.student.name}
                          </Link>
                          {r.assessed > 0 ? (
                            <Badge tone={r.avg >= 0.7 ? "good" : r.avg >= 0.5 ? "warn" : "bad"} size="sm">
                              {Math.round(r.avg * 100)}% overall
                            </Badge>
                          ) : null}
                          {r.risk.level !== "low" ? (
                            <Badge tone={r.risk.level === "high" ? "bad" : "warn"} size="sm">{r.risk.level}</Badge>
                          ) : null}
                          <a
                            href={`/api/reports/student/${r.student.id}`}
                            title="Download this child's report"
                            aria-label={`Download ${r.student.name}'s report`}
                            className="ml-auto flex size-7 items-center justify-center rounded-control border text-ink-3 hover:border-brand hover:text-brand transition-colors"
                          >
                            <Download className="size-3.5" />
                          </a>
                        </div>

                        {r.assessed === 0 ? (
                          <p className="mt-2 text-[11px] text-ink-4">
                            No marked tests yet. Take one from{" "}
                            <Link href="/tests/new" className="text-brand hover:underline">Create / Upload</Link>.
                          </p>
                        ) : (
                          <>
                            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                              {[...byStrand.entries()].map(([id, vals]) => {
                                const s = STRAND_BY_ID.get(id);
                                const pct = (vals.reduce((a, b) => a + b, 0) / vals.length) * 100;
                                return (
                                  <div key={id}>
                                    <div className="flex items-baseline justify-between text-[10px]">
                                      <span className="flex items-center gap-1 text-ink-3">
                                        <span className="size-1.5 rounded-full" style={{ background: s?.color }} />
                                        {s?.name}
                                      </span>
                                      <span className="tabular-nums text-ink-4">{Math.round(pct)}%</span>
                                    </div>
                                    <Progress value={pct} tone={pct >= 70 ? "good" : pct >= 50 ? "warn" : "bad"} className="mt-0.5" />
                                  </div>
                                );
                              })}
                            </div>
                            {weak.length > 0 ? (
                              <p className="mt-2.5 text-[10px] text-ink-3">
                                <TrendingDown className="mr-1 inline size-3" />
                                Needs work: {weak.map((w) => `${topicName(w.topicId)} (${Math.round(w.mastery * 100)}%)`).join(" · ")}
                              </p>
                            ) : (
                              <p className="mt-2.5 flex items-center text-[10px] text-good">
                                <TrendingUp className="mr-1 inline size-3" /> On track across everything tested.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
