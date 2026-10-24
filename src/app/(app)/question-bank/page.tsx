import Link from "next/link";
import { BookOpen, Filter, Target, Wand2 } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale, t } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { STRANDS, MISCONCEPTION_BY_ID } from "@/lib/curriculum";
import { generatableTopicIds } from "@/lib/question-generation/templates";
import { COMPETENCY_LABEL } from "@/lib/paper/labels";
import { topicName } from "@/lib/utils";

export const metadata = { title: "Question Bank" };
export const dynamic = "force-dynamic";

/**
 * The bank is the raw material of everything else: the generator draws from it,
 * the recommender cites it when it suggests a diagnostic question, and a
 * teacher can see here exactly what their reports are being built out of.
 */
export default async function QuestionBankPage(props: PageProps<"/question-bank">) {
  const session = await requireTeacher();
  const locale = await getLocale();

  const sp = await props.searchParams;
  const grade = Number(sp.grade ?? 0) || null;
  const strand = String(sp.strand ?? "") || null;
  const topic = String(sp.topic ?? "") || null;

  const generated = new Set(generatableTopicIds());

  const questions = await prisma.question.findMany({
    where: {
      ...(grade ? { grade } : {}),
      ...(strand ? { strand } : {}),
      ...(topic ? { topicId: topic } : {}),
      OR: [{ schoolId: null }, { schoolId: session.schoolId }],
    },
    orderBy: [{ strand: "asc" }, { topicId: "asc" }, { difficulty: "asc" }],
    take: 300,
  });

  const byStrand = new Map<string, typeof questions>();
  for (const q of questions) {
    byStrand.set(q.strand, [...(byStrand.get(q.strand) ?? []), q]);
  }

  const query = new URLSearchParams();
  if (grade) query.set("grade", String(grade));
  if (strand) query.set("strand", strand);
  const qs = query.toString();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Question Bank"
        titleHi={t(locale, "questionBank")}
        description={`${questions.length}${questions.length === 300 ? "+" : ""} questions available to generate papers and diagnostics from.`}
        locale={locale}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/quality"><Target className="size-3.5" /> Check quality</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/generator"><Wand2 className="size-3.5" /> Generate a paper</Link>
            </Button>
          </div>
        }
      />

      <div className="p-5 max-w-6xl w-full space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
                <Filter className="size-3.5" /> Filter
              </span>
              <a href={qs ? `?${qs}` : "/question-bank"} className={chip(!grade)}>All classes</a>
              {[1, 2, 3, 4, 5].map((g) => {
                const p = new URLSearchParams(query); p.set("grade", String(g));
                return <a key={g} href={`?${p}`} className={chip(grade === g)}>Class {g}</a>;
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a href={`${qs ? `?${qs}` : "/question-bank"}`} className={chip(!strand)}>All strands</a>
              {STRANDS.map((s) => {
                const p = new URLSearchParams(query); p.set("strand", s.id);
                const count = byStrand.get(s.id)?.length ?? 0;
                if (count === 0 && strand !== s.id) return null;
                return <a key={s.id} href={`?${p}`} className={chip(strand === s.id)}>{s.name}</a>;
              })}
            </div>
          </CardContent>
        </Card>

        {questions.length === 0 ? (
          <Card>
            <EmptyState
              icon={<BookOpen className="size-5" />}
              title="Nothing in the bank for this filter"
              description="Try another class or strand, or run the seed to load the built-in bank."
              action={<Button asChild size="sm"><Link href="/generator">Generate from the syllabus</Link></Button>}
            />
          </Card>
        ) : (
          [...byStrand.entries()].map(([strandId, rows]) => {
            const s = STRANDS.find((x) => x.id === strandId);
            const topics = [...new Set(rows.map((r) => r.topicId).filter(Boolean))] as string[];
            return (
              <Card key={strandId}>
                <CardContent className="pt-4">
                  <div className="mb-2.5 flex flex-wrap items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: s?.color }} />
                    <h2 className="text-sm font-semibold text-ink">{s?.name ?? strandId}</h2>
                    <Badge tone="outline" size="sm">{rows.length} questions</Badge>
                    <span className="text-[11px] text-ink-4">{s?.nameHi}</span>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {topics.map((tid) => {
                      const p = new URLSearchParams(query); p.set("topic", tid);
                      return (
                        <a key={tid} href={`?${p}`} className={chip(topic === tid)}>
                          {topicName(tid)} <span className="opacity-60">{rows.filter((r) => r.topicId === tid).length}</span>
                        </a>
                      );
                    })}
                  </div>

                  <div className="divide-y">
                    {rows.slice(0, topic ? 100 : 12).map((q) => {
                      const diagnoses = parseJson<string[]>(q.diagnoses, []);
                      return (
                        <div key={q.id} className="flex flex-wrap items-start gap-2 py-2">
                          <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink">{q.stem}</span>
                          <div className="flex shrink-0 flex-wrap items-center gap-1">
                            <Badge tone="outline" size="sm">C{q.grade}</Badge>
                            <Badge tone="neutral" size="sm">{q.marks}m</Badge>
                            <Badge tone="neutral" size="sm">d{q.difficulty}</Badge>
                            <Badge tone="outline" size="sm">{COMPETENCY_LABEL[q.competency] ?? q.competency}</Badge>
                            {diagnoses.slice(0, 1).map((d) => (
                              <Badge key={d} tone="bad" size="sm" title={MISCONCEPTION_BY_ID.get(d)?.belief}>
                                {MISCONCEPTION_BY_ID.get(d)?.name ?? d}
                              </Badge>
                            ))}
                            {generated.has(q.topicId ?? "") ? null : (
                              <Badge tone="warn" size="sm" title="No built-in generator for this topic">needs AI</Badge>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {rows.length > (topic ? 100 : 12) ? (
                      <p className="pt-2 text-[10px] text-ink-4">
                        Showing {topic ? 100 : 12} of {rows.length}. Filter by topic to see the rest.
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

/** Filter chips: plain anchors, highlighted when they match the current filter. */
function chip(on: boolean): string {
  return on
    ? "rounded-full border border-brand bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand-ink"
    : "rounded-full border bg-surface px-2.5 py-1 text-[11px] text-ink-2 hover:border-ink-4";
}
