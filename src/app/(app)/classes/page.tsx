import Link from "next/link";
import { CalendarDays, School, TriangleAlert, Users } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { ClassForm, AddStudentsForm } from "@/components/class-forms";
import { Register, type RosterChild } from "@/components/register";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label } from "@/components/ui/primitives";
import { summariseAttendance, type AttendanceStatus, type AttendanceSummary } from "@/lib/intelligence/attendance";
import { cn } from "@/lib/utils";

export const metadata = { title: "Register" };
export const dynamic = "force-dynamic";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { ...opts, timeZone: "UTC" });
}

type DayTally = { date: string; present: number; total: number };

export default async function RegisterPage(props: PageProps<"/classes">) {
  const session = await requireTeacher();
  const locale = await getLocale();
  const isHome = session.mode === "HOME";
  const sp = await props.searchParams;

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId, ...(session.role === "TEACHER" ? { teacherId: session.userId } : {}) },
    orderBy: [{ grade: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { enrollments: true, papers: true } },
      enrollments: { include: { student: true }, orderBy: { rollNo: "asc" } },
    },
  });

  if (classes.length === 0) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Register" titleHi="रजिस्टर" locale={locale} />
        <div className="p-5 max-w-lg w-full space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{isHome ? "Add a child" : "Create a class"}</CardTitle>
            </CardHeader>
            <CardContent>
              <ClassForm isHome={isHome} />
            </CardContent>
          </Card>
          <Card>
            <EmptyState
              icon={isHome ? <Users className="size-5" /> : <School className="size-5" />}
              title={isHome ? "No children yet" : "No classes yet"}
              description={
                isHome
                  ? "Add each child you educate. The daily register and every past day appear here once you do."
                  : "Create your first class above, and the daily register appears here for it."
              }
            />
          </Card>
        </div>
      </div>
    );
  }

  const requestedClass = sp.class ? String(sp.class) : "";
  const chosen = classes.find((c) => c.id === requestedClass) ?? classes[0];

  const requestedDate = sp.date ? String(sp.date) : todayISO();
  const date = requestedDate <= todayISO() ? requestedDate : todayISO();
  const when = new Date(`${date}T00:00:00.000Z`);

  const [dayRecords, allRecords] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where: { classId: chosen.id, date: when },
      select: { studentId: true, status: true },
    }),
    prisma.attendanceRecord.findMany({
      where: { classId: chosen.id },
      select: { studentId: true, date: true, status: true },
      orderBy: { date: "desc" },
    }),
  ]);

  const byStudent = new Map(dayRecords.map((r) => [r.studentId, r.status as AttendanceStatus]));
  const roster: RosterChild[] = chosen.enrollments
    .filter((e) => e.student.active)
    .map((e) => ({
      id: e.studentId,
      name: e.student.name,
      rollNo: e.student.rollNo,
      status: byStudent.get(e.studentId) ?? "present",
    }));
  const rosterIds = new Set(roster.map((s) => s.id));

  // Absence patterns across the whole record, per child.
  const byChild = new Map<string, { date: string; status: AttendanceStatus }[]>();
  for (const r of allRecords) {
    if (!rosterIds.has(r.studentId)) continue;
    const list = byChild.get(r.studentId) ?? [];
    list.push({ date: r.date.toISOString().slice(0, 10), status: r.status as AttendanceStatus });
    byChild.set(r.studentId, list);
  }
  const summaries = roster
    .map((s) => ({ student: s, summary: summariseAttendance({ days: byChild.get(s.id) ?? [], today: todayISO() }) }))
    .filter((x) => x.summary.findings.some((f) => f.severity !== "low"))
    .sort((a, b) => (b.summary.concern ?? 0) - (a.summary.concern ?? 0));

  // Recent days actually recorded, so an old register can be pulled back up.
  const tally = new Map<string, DayTally>();
  for (const r of allRecords) {
    const key = r.date.toISOString().slice(0, 10);
    const row = tally.get(key) ?? { date: key, present: 0, total: 0 };
    row.total += 1;
    if (r.status === "present" || r.status === "late") row.present += 1;
    tally.set(key, row);
  }
  const recentDays = [...tally.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Register"
        titleHi="रजिस्टर"
        description="Take today's register, open any past day, and manage your classes and children — all on one page."
        locale={locale}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c) => (
              <Button key={c.id} asChild size="sm" variant={c.id === chosen.id ? "primary" : "secondary"}>
                <Link href={`/classes?class=${c.id}`}>{c.name}</Link>
              </Button>
            ))}
          </div>
        }
      />

      <div className="p-5 max-w-5xl w-full space-y-5">
        <Card>
          <CardHeader>
            <div>
              <p className="text-[13px] font-semibold text-ink">
                {fmt(date, { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <p className="text-[11px] text-ink-3">
                {chosen.name} · {roster.length} on the roll
              </p>
            </div>
            {dayRecords.length > 0 ? (
              <Badge tone="good" size="sm">saved</Badge>
            ) : (
              <Badge tone="outline" size="sm">not taken yet</Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <form method="get" action="/classes" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="class" value={chosen.id} />
              <div className="space-y-1.5">
                <Label htmlFor="date">Day</Label>
                <Input id="date" type="date" name="date" defaultValue={date} max={todayISO()} className="h-9 w-40" />
              </div>
              <Button type="submit" size="sm" variant="secondary">
                <CalendarDays className="size-3.5" /> Show day
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href={`/classes?class=${chosen.id}`}>Today</Link>
              </Button>
            </form>
            <Register classId={chosen.id} date={date} roster={roster} canSave={roster.length > 0} />
          </CardContent>
        </Card>

        {recentDays.length > 0 ? (
          <Card>
            <CardHeader>
              <p className="text-[13px] font-semibold text-ink">Past registers</p>
              <Badge tone="neutral" size="sm">{recentDays.length} recent days</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="mb-2 text-[11px] text-ink-3">
                Open any day to read or correct it. {chosen.name}.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {recentDays.map((d) => (
                  <Link
                    key={d.date}
                    href={`/classes?class=${chosen.id}&date=${d.date}`}
                    className={cn(
                      "rounded-control border px-2.5 py-1 text-[11px] tabular-nums transition-colors",
                      d.date === date
                        ? "border-brand text-brand"
                        : "border-line text-ink-2 hover:border-brand hover:text-brand",
                    )}
                  >
                    {fmt(d.date, { day: "numeric", month: "short" })}
                    <span className="ml-1 text-ink-4">{d.present}/{d.total}</span>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {summaries.length > 0 ? (
          <Card>
            <CardHeader>
              <p className="text-[13px] font-semibold text-ink">Worth a conversation</p>
              <Badge tone="warn" size="sm">{summaries.length} children</Badge>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {summaries.map(({ student, summary }) => (
                <ChildFinding key={student.id} student={student} summary={summary} />
              ))}
            </CardContent>
          </Card>
        ) : null}

        <div className="pt-2">
          <h2 className="text-[13px] font-semibold text-ink">{isHome ? "My children" : "Classes & students"}</h2>
          <p className="mb-3 text-[11px] text-ink-3">
            {isHome
              ? "One class per child, named after them. Everything else follows from that."
              : "Create a class and add the children; every test and report lines up automatically."}
          </p>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{isHome ? "Add a child" : "Create a class"}</CardTitle>
              </CardHeader>
              <CardContent>
                <ClassForm isHome={isHome} />
              </CardContent>
            </Card>

            {classes.map((c) => {
              const enrolled = c.enrollments.filter((e) => e.student.active);
              return (
                <Card key={c.id}>
                  <CardHeader>
                    <div>
                      <CardTitle>{c.name}</CardTitle>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Badge tone="outline" size="sm">Class {c.grade}</Badge>
                        {c.section ? <Badge tone="outline" size="sm">{c.section}</Badge> : null}
                        <Badge tone="neutral" size="sm">{c._count.enrollments} students</Badge>
                        <Badge tone="neutral" size="sm">{c._count.papers} tests</Badge>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Button asChild size="sm" variant={c.id === chosen.id ? "primary" : "secondary"}>
                        <Link href={`/classes?class=${c.id}`}>Take register</Link>
                      </Button>
                      <Buttonish href={`/classes/${c.id}/handover`}>Handover note</Buttonish>
                      <Buttonish href={`/classes/${c.id}/reflect/set`}>Self check</Buttonish>
                      <Buttonish href={`/classes/${c.id}/import`}>Import marks</Buttonish>
                      <Buttonish href={`/students?class=${c.id}`}>View progress</Buttonish>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {enrolled.length === 0 ? (
                      <p className="text-xs text-ink-3">No students yet — add them below.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {enrolled.map((e) => (
                          <Link
                            key={e.studentId}
                            href={`/students/${e.studentId}`}
                            className="rounded-full border bg-surface px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-brand hover:text-brand"
                          >
                            <span className="tabular-nums text-ink-4">{e.student.rollNo ?? "–"}</span> {e.student.name}
                          </Link>
                        ))}
                      </div>
                    )}
                    <div className="rounded-control border bg-surface-2/40 p-3">
                      <p className="mb-2 text-[11px] font-semibold text-ink-2">Add students</p>
                      <AddStudentsForm classId={c.id} />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChildFinding({ student, summary }: { student: RosterChild; summary: AttendanceSummary }) {
  return (
    <div className="rounded-control border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/students/${student.id}`} className="text-[11px] font-medium text-ink hover:text-brand">
          {student.name}
        </Link>
        <span className="text-[11px] text-ink-3">
          {summary.presentRate === null ? "no record yet" : `${Math.round(summary.presentRate * 100)}% present`}
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {summary.findings
          .filter((f) => f.severity !== "low")
          .map((f) => (
            <li key={f.id} className="flex gap-2">
              <TriangleAlert
                className={cn("mt-0.5 size-3.5 shrink-0", f.severity === "high" ? "text-bad" : "text-warn")}
              />
              <span className="min-w-0">
                <span className="block text-[11px] leading-relaxed text-ink-2">{f.note}</span>
                <span className="block text-[10px] leading-relaxed text-ink-4">{f.check}</span>
              </span>
            </li>
          ))}
      </ul>
      <p className="mt-2 text-[10px] text-ink-4">
        Absent on {summary.daysAbsent} of {summary.daysRecorded} recorded days
        {summary.currentStreak > 1 ? ` · ${summary.currentStreak} in a row right now` : ""}.
      </p>
    </div>
  );
}

function Buttonish({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-8 items-center rounded-control border bg-surface px-3 text-[11px] font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand"
    >
      {children}
    </a>
  );
}
