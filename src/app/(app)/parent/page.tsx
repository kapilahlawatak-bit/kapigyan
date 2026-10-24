import Link from "next/link";
import { Users } from "lucide-react";
import { requireRole } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Card, EmptyState, Progress } from "@/components/ui/primitives";
import { studentMasteryMap } from "@/lib/analytics/class";
import { asArray, meanMastery } from "@/lib/analytics/view";
import { gradeBand } from "@/lib/curriculum";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "My children" };
export const dynamic = "force-dynamic";

/** Landing for a parent: one card per linked child, most recent first. */
export default async function ParentHome() {
  const session = await requireRole("PARENT");
  const locale = await getLocale();

  const links = await prisma.parentLink.findMany({
    where: { parentId: session.userId, revokedAt: null },
    include: {
      student: {
        include: {
          submissions: {
            orderBy: { gradedAt: "desc" },
            include: { paper: { select: { title: true, date: true } } },
          },
        },
      },
    },
  });

  // Resolved before rendering. `links.map(async …)` would hand React an array
  // of Promises, which it cannot render — the child cards simply never appear.
  const cards = await Promise.all(
    links.map(async (link) => {
      const s = link.student;
      // Scoped to the caller's own school, so a parent cannot be pointed at a
      // class in another school just by knowing a child's name.
      const enrolment = session.schoolId
        ? await prisma.enrollment.findFirst({
            where: { studentId: s.id, class: { schoolId: session.schoolId } },
            select: { classId: true },
          })
        : null;
      const mastery = await studentMasteryMap(s.id, enrolment?.classId);
      const rows = asArray(mastery);
      const last = s.submissions[0];
      return {
        id: s.id,
        name: s.name,
        submissions: s.submissions,
        last,
        avg: meanMastery(rows),
        lastPct: last && last.maxScore > 0 ? (last.score / last.maxScore) * 100 : null,
        weak: rows.filter((m) => m.mastery < 0.65).length,
      };
    }),
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title="My children"
        titleHi="मेरे बच्चे"
        description={
          links.length > 0
            ? "Open a child to see their full progress report, strengths and what to practise."
            : undefined
        }
        locale={locale}
      />

      <div className="p-5 max-w-4xl w-full space-y-4">
        {links.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users className="size-5" />}
              title="No children linked yet"
              description="Ask your child's teacher to send you a link, or enter the code they gave you. Your child's records stay private — you can only ever see your own child."
            />
          </Card>
        ) : (
          cards.map((c) => (
              <Link key={c.id} href={`/parent/report/${c.id}`} className="card p-5 hover:shadow-lift transition-shadow group">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-ink">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink group-hover:text-brand transition-colors">{c.name}</p>
                    {c.last ? (
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        Last test: {c.last.paper.title} · {formatDate(c.last.paper.date)}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-ink-3">No tests marked yet</p>
                    )}
                  </div>
                  {c.lastPct !== null ? (
                    <Badge tone={c.lastPct >= 70 ? "good" : c.lastPct >= 45 ? "warn" : "bad"} size="lg">
                      {Math.round(c.lastPct)}% · {gradeBand(c.lastPct).label}
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] text-ink-4">Overall understanding</p>
                    <Progress value={c.avg * 100} tone={c.avg >= 0.7 ? "good" : c.avg >= 0.5 ? "warn" : "bad"} className="mt-1" />
                    <p className="mt-1 text-[10px] font-semibold tabular-nums text-ink-3">{Math.round(c.avg * 100)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-ink-4">Topics needing practice</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-ink">{c.weak}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-ink-4">Tests completed</p>
                    <p className="mt-1 text-sm font-bold tabular-nums text-ink">{c.submissions.length}</p>
                  </div>
                </div>
              </Link>
          ))
        )}
      </div>
    </div>
  );
}
