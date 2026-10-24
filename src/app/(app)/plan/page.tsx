import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, CircleCheck, Download, ListChecks, NotebookPen, Printer, Sparkles, TriangleAlert } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { loadPlanData, strandSummary } from "@/lib/analytics/plan-data";
import { prisma } from "@/lib/db";
import { buildTeachingPlan } from "@/lib/intelligence/teaching-plan";
import { topicsForClass, MISCONCEPTION_BY_ID } from "@/lib/curriculum";
import { toggleTaught } from "./actions";

export const metadata = { title: "Teaching Plan" };
export const dynamic = "force-dynamic";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * The term plan.
 *
 * A teacher who opens this on the first Monday of term should be able to read
 * down the page and know what to teach on Monday, and then on Tuesday, for
 * twelve weeks. It is generated from the same gap analysis as the insights
 * page, but the unit is the term rather than the next period, which changes
 * three things: the topics are interleaved rather than blocked, every taught
 * topic comes back for retrieval, and topics that have never been assessed
 * are still scheduled — a plan built purely from test data quietly skips
 * half a syllabus.
 */
export default async function PlanPage(props: PageProps<"/plan">) {
  const sp = await props.searchParams;
  const session = await requireTeacher();
  const locale = await getLocale();

  const data = await loadPlanData(session, sp.class ? String(sp.class) : undefined);

  if (!data) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Teaching Plan" titleHi="शिक्षण योजना" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState
            icon={<CalendarDays className="size-5" />}
            title="No classes yet"
            description="Add a class and a term plan will be built for you."
            action={<Button asChild size="sm"><Link href="/classes">Add a class</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  const weeks = Math.min(24, Math.max(4, Number(sp.weeks) || 12));
  const perWeek = Math.min(5, Math.max(1, Number(sp.sessions) || 4));
  const consolidate = sp.consolidate === "1";

  // What has actually been taught, as the teacher has confirmed it.
  const taughtRows = await prisma.taughtSession.findMany({
    where: { classId: data.classId },
    select: { topicId: true },
  });
  const taughtDates = [...new Set(taughtRows.map((t) => t.topicId))];

  const plan = buildTeachingPlan({
    grade: data.grade,
    syllabus: topicsForClass(data.grade),
    mastery: data.mastery,
    recommendations: data.recommendations,
    weeks,
    sessionsPerWeek: perWeek,
    consolidate,
  });

  const strands = strandSummary(data.rows);
  const topStrand = strands[0];
  const topMisconception = Object.entries(data.misconceptionTotals)
    .sort((a, b) => b[1] - a[1])[0];

  const qs = (extra: Record<string, string> = {}) => {
    const base: Record<string, string> = { class: data.classId, weeks: String(weeks), sessions: String(perWeek) };
    if (consolidate) base.consolidate = "1";
    return `/plan?${new URLSearchParams({ ...base, ...extra })}`;
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Teaching Plan"
        titleHi="शिक्षण योजना"
        description={`${data.className} · ${weeks} weeks · ${perWeek} periods a week${data.hasData ? "" : " · no marked tests yet, so this is the syllabus order"}`}
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <a href={`/plan/print?class=${data.classId}&weeks=${weeks}&sessions=${perWeek}${consolidate ? "&consolidate=1" : ""}`}>
                <Printer className="size-3.5" /> Print
              </a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <a href={`/api/plan/${data.classId}?weeks=${weeks}&sessions=${perWeek}`}>
                <Download className="size-3.5" /> PDF
              </a>
            </Button>
            {data.allClasses.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.allClasses.map((c) => (
                  <Button key={c.id} asChild size="sm" variant={c.id === data.classId ? "primary" : "secondary"}>
                    <Link href={qs({ class: c.id })}>{c.name}</Link>
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        }
      />

      <div className="p-5 max-w-6xl w-full space-y-5">
        {/* Shape of the term */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Periods planned</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{plan.counts.sessions}</p>
            <p className="mt-1 text-[10px] text-ink-4">{plan.counts.teach} new · {plan.counts.check} revisit</p>
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Syllabus covered</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {plan.counts.teach}<span className="text-sm font-normal text-ink-4">/{topicsForClass(data.grade).length}</span>
            </p>
            <Progress
              value={(plan.counts.teach / Math.max(1, topicsForClass(data.grade).length)) * 100}
              tone="good"
              className="mt-1.5"
            />
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Weakest strand</p>
            <p className="mt-1 truncate text-sm font-semibold text-ink">{topStrand?.name ?? "—"}</p>
            {topStrand ? (
              <p className="mt-1 text-[10px] tabular-nums text-ink-4">{Math.round(topStrand.mastery * 100)}% across {topStrand.topics} topics</p>
            ) : null}
          </Card>
          <Card className="p-4">
            <p className="text-[11px] text-ink-3">Biggest error</p>
            <p className="mt-1 truncate text-sm font-semibold text-ink">
              {topMisconception ? MISCONCEPTION_BY_ID.get(topMisconception[0])?.name : "—"}
            </p>
            <p className="mt-1 text-[10px] tabular-nums text-ink-4">
              {topMisconception ? `${topMisconception[1]} answers` : "no marked tests yet"}
            </p>
          </Card>
        </div>

        {/* Controls */}
        <Card>
          <CardContent className="pt-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-3">Term length</span>
              <div className="flex gap-1">
                {[8, 12, 16].map((w) => (
                  <Button key={w} asChild size="sm" variant={w === weeks ? "primary" : "secondary"}>
                    <Link href={qs({ weeks: String(w) })}>{w}w</Link>
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-3">Periods / week</span>
              <div className="flex gap-1">
                {[3, 4, 5].map((n) => (
                  <Button key={n} asChild size="sm" variant={n === perWeek ? "primary" : "secondary"}>
                    <Link href={qs({ sessions: String(n) })}>{n}</Link>
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-ink-3">Revisits</span>
              <div className="flex gap-1">
                <Button asChild size="sm" variant={consolidate ? "secondary" : "primary"}>
                  <Link href={qs({ consolidate: "0" })}>Spaced</Link>
                </Button>
                <Button asChild size="sm" variant={consolidate ? "primary" : "secondary"}>
                  <Link href={qs({ consolidate: "1" })}>None</Link>
                </Button>
              </div>
            </div>
            <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-ink-4">
              {consolidate
                ? "Every period teaches something new. Faster coverage, much weaker retention."
                : "Roughly 30% of periods are revisits at +1 and +3 weeks. Forgetting starts within days, so this is where the learning actually sticks."}
            </p>
          </CardContent>
        </Card>

        {/* Week by week */}
        {plan.weeks.map((w) => (
          <Card key={w.week}>
            <CardHeader>
              <div>
                <CardTitle>Week {w.week}</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">{w.focus}</p>
              </div>
              <Badge tone={w.sessions.length === 0 ? "neutral" : "outline"} size="sm">
                {w.sessions.length} {w.sessions.length === 1 ? "period" : "periods"}
              </Badge>
            </CardHeader>
            <CardContent className="pt-0">
              {w.sessions.length === 0 ? (
                <p className="text-[11px] text-ink-4">
                  Nothing scheduled — use it for assessment, or to catch up.
                </p>
              ) : (
                <div className="space-y-2">
                  {w.sessions.map((s) => (
                    <SessionRow
                      key={`${s.week}-${s.day}-${s.topicId}-${s.kind}`}
                      session={s}
                      classId={data.classId}
                      taughtDates={taughtDates}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* What did not fit */}
        {plan.deferred.length > 0 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Not in this term</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {plan.deferred.length} {plan.deferred.length === 1 ? "topic" : "topics"} did not fit. A plan
                  that promises to cover everything in {weeks} weeks is lying; this is the honest remainder.
                </p>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-1.5">
                {plan.deferred.map((d) => (
                  <span key={d.topicId} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] text-ink-3">
                    {d.topicName}
                    <span className="text-ink-4">{d.reason}</span>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function SessionRow({
  session: s, classId, taughtDates,
}: {
  session: import("@/lib/intelligence/teaching-plan").PlanSession;
  classId: string;
  taughtDates: string[];
}) {
  const kindLabel =
    s.kind === "teach" ? "Teach" : s.kind === "check" ? "Check" : "Consolidate";
  const kindTone = s.kind === "teach" ? "brand" : s.kind === "check" ? "warn" : "good";
  const isTaught = taughtDates.includes(s.topicId);

  return (
    <div className={`rounded-control border p-3 ${isTaught ? "border-good/40 bg-good-soft/20" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" size="sm">{DAY_NAMES[s.day]}</Badge>
        <span className="size-2 rounded-full" style={{ background: s.strandColor }} />
        <p className="text-[11px] font-semibold text-ink">{s.topicName}</p>
        <p className="text-[10px] text-ink-4">{s.topicNameHi}</p>
        <Badge tone={kindTone} size="sm">
          {s.kind === "teach" ? <Sparkles className="size-2.5" /> : <ListChecks className="size-2.5" />}
          {kindLabel}
        </Badge>
        {s.unassessed ? <Badge tone="outline" size="sm">not assessed</Badge> : null}
        {s.revisitOf ? <Badge tone="outline" size="sm">after period {s.revisitOf}</Badge> : null}
        <div className="ml-auto flex items-center gap-1.5">
          {s.kind === "teach" ? (
            <>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/plan/materials/${s.topicId}?classId=${classId}`}>
                  <NotebookPen className="size-3" /> Materials
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/generator?topics=${s.topicId}`}>
                  <TriangleAlert className="size-3" /> Diagnose
                </Link>
              </Button>
            </>
          ) : null}
          <form action={toggleTaught}>
            <input type="hidden" name="classId" value={classId} />
            <input type="hidden" name="topicId" value={s.topicId} />
            <input type="hidden" name="taughtAt" value={new Date().toISOString()} />
            <Button type="submit" variant={isTaught ? "primary" : "secondary"} size="sm">
              <CircleCheck className="size-3" /> {isTaught ? "Taught" : "Mark taught"}
            </Button>
          </form>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-2">{s.why}</p>
      {s.recommendation?.dominantMisconception ? (
        <p className="mt-1.5 rounded bg-bad-soft/40 px-2.5 py-1.5 text-[10px] text-ink-2">
          <span className="font-semibold text-bad">{s.recommendation.dominantMisconception.name}:</span>{" "}
          “{s.recommendation.dominantMisconception.belief}”
        </p>
      ) : null}
    </div>
  );
}
