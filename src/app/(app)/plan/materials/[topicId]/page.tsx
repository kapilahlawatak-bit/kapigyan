import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { buildMaterials } from "@/lib/intelligence/materials";
import { MISCONCEPTION_BY_ID, TOPIC_BY_ID } from "@/lib/curriculum";
import { loadPlanData } from "@/lib/analytics/plan-data";

export const metadata = { title: "Lesson Materials" };
export const dynamic = "force-dynamic";

/**
 * One sheet a teacher can teach from.
 *
 * The blackboard plan comes first because it is what the teacher looks at
 * while standing in front of the class. Everything after it is reference: the
 * materials to have ready, the examples to work through, and the worksheet to
 * hand out.
 *
 * Print styling is deliberate — black on white, no colour needed, and page
 * breaks that do not split a section. A teacher photocopying this in black and
 * white must still get a usable worksheet.
 */
export default async function MaterialsPage(props: PageProps<"/plan/materials/[topicId]">) {
  const { topicId } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();

  const topic = TOPIC_BY_ID.get(topicId);
  if (!topic) notFound();

  // The plan loader decides which classes this teacher owns, so materials can
  // never be built for a class they cannot otherwise reach.
  const sp = await props.searchParams;
  const asked = (Array.isArray(sp.classId) ? sp.classId[0] : sp.classId) ?? undefined;
  const plan = await loadPlanData(session, asked);
  if (!plan) notFound();
  const target = { id: plan.classId, name: plan.className, grade: plan.grade };
  await assertClassAccess(session, plan.classId);

  const topWrong = await prisma.answer.findMany({
    where: { paperQuestion: { paper: { classId: target.id } }, isCorrect: false },
    select: { errorTag: true, paperQuestion: { select: { topicId: true } } },
    take: 500,
  });
  const allAnswers = topWrong;
  const counts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const a of allAnswers) {
    if (a.paperQuestion.topicId) {
      const t = a.paperQuestion.topicId;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    if (a.errorTag) tagCounts.set(a.errorTag, (tagCounts.get(a.errorTag) ?? 0) + 1);
  }
  const weakest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  // The misconception this class most often demonstrates, which is the one a
  // lesson here should be built against. Only meaningful for this topic.
  const misconceptionId = strongestTagFor(weakest, tagCounts);

  const m = buildMaterials({
    topicId,
    grade: target.grade,
    minutes: target.grade <= 2 ? 35 : 40,
    why: weakest === topicId
      ? `${counts.get(topicId) ?? 0} answers in ${target.name} on this topic are wrong with no explanation attached — the biggest unexplained group in the class.`
      : "Scheduled in the teaching plan.",
    misconceptionId,
  });
  if (!m) notFound();

  return (
    <div className="flex flex-col print:gap-0">
      <PageHeader
        title={m.topicName}
        titleHi={m.topicNameHi}
        description={`Ready-to-teach sheet for ${target.name} · ${m.minutes} minutes`}
        locale={locale}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href="/plan"><ArrowLeft className="size-3" /> Plan</Link>
            </Button>
            <Button size="sm" onClick={undefined} data-print className="print:hidden">
              <Printer className="size-3" /> Print this sheet
            </Button>
          </div>
        }
      />

      <div className="p-5 max-w-3xl w-full space-y-4 print:max-w-none print:p-0 print:space-y-0">
        {m.why ? (
          <Alert tone="info" title="Why this lesson today" className="print:hidden">
            {m.why}
          </Alert>
        ) : null}

        {m.misconceptionName ? (
          <Alert tone="warn" title={`Designed against: ${m.misconceptionName}`} className="print:hidden">
            {m.misconceptionFix}
          </Alert>
        ) : null}

        {/* The sheet itself — no colour, no chrome, prints on one side. */}
        <div className="space-y-5 print:space-y-4">
          <div className="border-b pb-2">
            <h2 className="text-[15px] font-semibold text-ink">{m.topicName} — {m.strandName}</h2>
            <p className="text-[11px] text-ink-3">
              {m.grade === 1 ? "Class 1" : `Class ${m.grade}`} · {m.minutes} minutes
              {m.misconceptionName ? ` · against "${m.misconceptionName}"` : ""}
            </p>
          </div>

          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">What you need</h3>
            <ul className="space-y-1.5">
              {m.materials.map((mat) => (
                <li key={mat.ideal} className="text-[12px] leading-relaxed text-ink">
                  <span className="font-medium">{mat.ideal}</span>
                  <span className="block text-ink-3">
                    <span className="font-medium text-ink-2">If you do not have it:</span> {mat.substitute}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="break-inside-avoid">
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Blackboard plan</h3>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b text-left text-ink-4">
                  <th className="py-1 pr-2 font-medium">Min</th>
                  <th className="py-1 pr-2 font-medium">Write</th>
                  <th className="py-1 pr-2 font-medium">Ask</th>
                  <th className="py-1 pr-2 font-medium">Children do</th>
                  <th className="py-1 font-medium">Watch for</th>
                </tr>
              </thead>
              <tbody>
                {m.blackboard.map((b, i) => (
                  <tr key={i} className="border-b align-top last:border-0">
                    <td className="py-1.5 pr-2 tabular-nums text-ink-4">{b.minutes}</td>
                    <td className="py-1.5 pr-2 font-medium whitespace-pre-line text-ink">{b.write}</td>
                    <td className="py-1.5 pr-2 text-ink-2">{b.say}</td>
                    <td className="py-1.5 pr-2 text-ink-2">{b.do}</td>
                    <td className="py-1.5 text-ink-2">{b.look}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {m.worked.length > 0 ? (
            <section className="break-inside-avoid">
              <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Worked examples</h3>
              <ol className="space-y-2">
                {m.worked.map((w, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-ink">
                    <span className="font-medium">{i + 1}. {w.question}</span>
                    <ol className="ml-4 mt-0.5 list-decimal text-ink-2">
                      {w.steps.map((s, si) => <li key={si}>{s}</li>)}
                    </ol>
                    <p className="mt-0.5">Answer: <span className="font-medium">{w.answer}</span></p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
              Worksheet — {m.topicName} ({m.worksheet.length || m.guided.length} questions)
            </h3>
            {m.worksheetNote ? (
              <p className="text-[12px] text-ink-2">{m.worksheetNote}</p>
            ) : (
              <ol className="space-y-2">
                {m.worksheet.map((q, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-ink">
                    <span className="w-4 shrink-0 tabular-nums text-ink-4">{i + 1}.</span>
                    <span className="flex-1">
                      {q}
                      <span className="mt-1 block h-4 border-b border-dotted border-line" />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="break-inside-avoid">
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-3">The three groups</h3>
            <ul className="space-y-1 text-[12px] leading-relaxed text-ink-2">
              <li><span className="font-medium text-ink">Struggling:</span> {m.differentiation.struggling}</li>
              <li><span className="font-medium text-ink">On track:</span> {m.differentiation.onTrack}</li>
              <li><span className="font-medium text-ink">Advanced:</span> {m.differentiation.advanced}</li>
            </ul>
          </section>

          <section className="break-inside-avoid border-t pt-2">
            <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">How you will know it worked</h3>
            <p className="text-[12px] leading-relaxed text-ink-2">{m.successCheck}</p>
          </section>
        </div>

        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-[12px]">After you teach it</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-[11px] text-ink-2">
              Tick it off on the plan so the app knows this topic was actually taught. Without that,{" "}
              <Link href="/gain" className="text-brand underline underline-offset-2">the gain page cannot tell whether your teaching worked</Link>.
            </p>
            <Badge tone="outline" size="sm" className="mt-2">Prints on one side, black and white</Badge>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * The misconception the class most often demonstrates, when it belongs to the
 * topic being taught and appears often enough to be a pattern rather than one
 * child's slip.
 */
function strongestTagFor(weakestTopic: string | null, tagCounts: Map<string, number>): string | null {
  if (!weakestTopic) return null;
  const ranked = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0 || ranked[0]![1] < 3) return null;
  const top = MISCONCEPTION_BY_ID.get(ranked[0]![0]);
  return top?.topicIds.includes(weakestTopic) ? top.id : null;
}
