import Link from "next/link";
import { Users } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Card, EmptyState, Progress } from "@/components/ui/primitives";
import { studentMasteryMap, classMasteryMap } from "@/lib/analytics/class";
import { asArray, meanMastery, riskFor } from "@/lib/analytics/view";
import { topicName } from "@/lib/utils";

export const metadata = { title: "Students" };
export const dynamic = "force-dynamic";

export default async function StudentsPage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId, ...(session.role === "TEACHER" ? { teacherId: session.userId } : {}) },
    orderBy: { grade: "asc" },
    include: {
      enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } },
    },
  });

  const total = classes.reduce((a, c) => a + c.enrollments.length, 0);

  // Resolved before rendering. `classes.map(async …)` would hand React an array
  // of Promises, which it cannot render — the roster never appears at all.
  const sections = await Promise.all(
    classes.map(async (cls) => {
      const classAvg = await classMasteryMap(cls.id);
      const rows = await Promise.all(
        cls.enrollments.map(async (e) => {
          const m = await studentMasteryMap(e.studentId, cls.id);
          const topics = asArray(m);
          const gaps = topics.filter((x) => x.mastery < 0.65);
          return { student: e.student, mastery: meanMastery(topics), risk: riskFor(m), gaps };
        }),
      );
      return { cls, mean: meanMastery(classAvg), rows };
    }),
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Students"
        titleHi="विद्यार्थी"
        description={`${total} student${total === 1 ? "" : "s"} across ${classes.length} class${classes.length === 1 ? "" : "es"}.`}
        locale={locale}
      />

      <div className="p-5 max-w-6xl w-full space-y-6">
        {classes.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users className="size-5" />}
              title="No classes yet"
              description="Create a class to start tracking individual progress."
              action={<ButtonLike href="/classes">Create a class</ButtonLike>}
            />
          </Card>
        ) : (
          sections.map(({ cls, mean, rows }) => (
              <div key={cls.id}>
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink">{cls.name}</h2>
                  <Badge tone="outline" size="sm">Class {cls.grade}</Badge>
                  <Badge tone="neutral" size="sm">{cls.enrollments.length} students</Badge>
                  <Badge tone={mean >= 0.7 ? "good" : mean >= 0.5 ? "warn" : "bad"} size="sm">
                    class mastery {Math.round(mean * 100)}%
                  </Badge>
                </div>

                {rows.length === 0 ? (
                  <Card><EmptyState icon={<Users className="size-5" />} title="No students in this class" description="Add them from the Classes page." /></Card>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {rows.map((r) => (
                      <Link key={r.student.id} href={`/students/${r.student.id}`} className="card p-4 hover:shadow-lift transition-shadow group">
                        <div className="flex items-start gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-ink">
                            {r.student.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-ink group-hover:text-brand transition-colors">{r.student.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Badge tone={r.risk.level === "high" ? "bad" : r.risk.level === "watch" ? "warn" : "good"} size="sm">
                                {r.risk.level}
                              </Badge>
                              {r.gaps.length > 0 ? <Badge tone="neutral" size="sm">{r.gaps.length} weak topics</Badge> : null}
                            </div>
                          </div>
                        </div>
                        <Progress
                          value={r.mastery * 100}
                          tone={r.mastery >= 0.7 ? "good" : r.mastery >= 0.5 ? "warn" : "bad"}
                          className="mt-3"
                        />
                        <p className="mt-1.5 truncate text-[10px] text-ink-4">
                          {r.gaps.length > 0
                            ? `Weakest: ${topicName(r.gaps[0].topicId)}`
                            : "On track across the syllabus"}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
          ))
        )}
      </div>
    </div>
  );
}

function ButtonLike({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="inline-flex h-9 items-center rounded-control bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-ink transition-colors">
      {children}
    </a>
  );
}
