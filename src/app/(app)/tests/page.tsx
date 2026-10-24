import Link from "next/link";
import { FileStack, Plus, Upload } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma, parseJson } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, EmptyState, Progress } from "@/components/ui/primitives";
import { formatDate, gradeBand } from "@/lib/utils";
import { SOURCE_LABEL } from "@/lib/paper/labels";

export const metadata = { title: "Tests & Papers" };
export const dynamic = "force-dynamic";

export default async function TestsPage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const papers = await prisma.paper.findMany({
    where: { schoolId: session.schoolId, ...(session.mode === "HOME" ? { createdBy: session.userId } : {}) },
    orderBy: { date: "desc" },
    include: {
      _count: { select: { submissions: true, questions: true } },
      class: { select: { name: true, grade: true } },
      submissions: { where: { status: "GRADED" }, select: { score: true, maxScore: true } },
    },
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Tests & Papers"
        titleHi="परीक्षाएँ"
        description="Everything you have uploaded, typed or generated."
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href="/tests/new"><Upload className="size-3.5" /> Upload</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/generator"><Plus className="size-3.5" /> Generate</Link>
            </Button>
          </>
        }
      />

      <div className="p-5 max-w-6xl w-full">
        {papers.length === 0 ? (
          <Card>
            <EmptyState
              icon={<FileStack className="size-5" />}
              title="No tests yet"
              description="Upload the test you already have — a Word file, a PDF, or a photo of the paper. Or generate one from the syllabus in a few seconds."
              action={
                <div className="flex gap-2">
                  <Button asChild size="sm"><Link href="/tests/new">Upload a test</Link></Button>
                  <Button asChild size="sm" variant="secondary"><Link href="/generator">Generate a paper</Link></Button>
                </div>
              }
            />
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {papers.map((p) => {
              const scored = p.submissions;
              const avg = scored.length > 0
                ? scored.reduce((a, s) => a + (s.maxScore > 0 ? (s.score / s.maxScore) * 100 : 0), 0) / scored.length
                : null;
              const meta = parseJson<{ sources?: Record<string, number> }>(p.sourceMeta, {});
              const mixedSources = meta.sources && Object.values(meta.sources).filter((n) => n > 0).length > 1;

              return (
                <Link key={p.id} href={`/tests/${p.id}`} className="card p-4 hover:shadow-lift transition-shadow group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink group-hover:text-brand transition-colors truncate">
                        {p.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-4">
                        Class {p.grade}
                        {p.class ? ` · ${p.class.name}` : ""} · {p.term}
                      </p>
                    </div>
                    <Badge tone={p.status === "PUBLISHED" ? "good" : "neutral"} size="sm">{p.status}</Badge>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge tone="outline" size="sm">{SOURCE_LABEL[p.source] ?? p.source}</Badge>
                    <Badge tone="outline" size="sm">{p._count.questions} Q</Badge>
                    <Badge tone="outline" size="sm">{p.maxMarks} marks</Badge>
                    {mixedSources ? <Badge tone="brand" size="sm">mixed sources</Badge> : null}
                  </div>

                  <div className="mt-3 border-t pt-3">
                    {avg === null ? (
                      <p className="text-[11px] text-ink-4">Not marked yet · {formatDate(p.date, true)}</p>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between">
                          <span className="text-[11px] text-ink-3">
                            {scored.length} marked · {gradeBand(avg).grade}
                          </span>
                          <span className="text-base font-bold tabular-nums text-ink">{Math.round(avg)}%</span>
                        </div>
                        <Progress value={avg} tone={avg >= 70 ? "good" : avg >= 45 ? "warn" : "bad"} className="mt-1.5" />
                      </>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
