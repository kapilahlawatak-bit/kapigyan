import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, EyeOff, Printer, Users } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/primitives";
import { summariseReflections, CONFIDENCE_WORDS } from "@/lib/intelligence/reflection";
import { topicsForClass } from "@/lib/curriculum";

export const metadata = { title: "Self Check Setup" };
export const dynamic = "force-dynamic";

/**
 * Teacher's side of the self check.
 *
 * The page leads with what the results are *not*: not a grade, not a ranking,
 * not anything that goes on a report. A teacher who thinks this page is a
 * judgement will use it as one, and children will learn to lie in it.
 */
export default async function ReflectSetupPage(props: PageProps<"/classes/[id]/reflect/set">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();
  await assertClassAccess(session, id);

  const cls = await prisma.class.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { id: true, name: true, grade: true },
  });
  if (!cls) notFound();

  const rows = await prisma.reflection.findMany({
    where: { classId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, topicName: true, predicted: true, outcome: true, calibration: true, createdAt: true },
    take: 200,
  });

  const summary = summariseReflections(
    rows.map((r) => ({
      topicId: "", topicName: r.topicName,
      predicted: r.predicted as keyof typeof CONFIDENCE_WORDS,
      outcome: r.outcome as "got_it" | "nearly" | "not_yet" | "skipped",
      calibration: r.calibration as "well_calibrated" | "overconfident" | "underconfident" | null,
      note: null,
    })),
  );

  const topics = topicsForClass(cls.grade);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Self Check"
        titleHi="स्वमूल्यांकन"
        description={`${cls.name} — what the children think, before they find out.`}
        locale={locale}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="secondary">
              <Link href={`/classes/${id}/reflect?shared=1`} target="_blank">Open the child view</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={`/classes/${id}/reflect/print`}><Printer className="size-3.5" /> Print</Link>
            </Button>
          </div>
        }
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        <Alert tone="warn" title="This is not a grade, and it does not go on any report">
          What a child says about themselves is weaker evidence than what they do on a test. Nothing
          here changes a child&apos;s mark, mastery or risk score. It is one conversation, and its only
          output is knowing which topics to ask about.
        </Alert>

        <Alert tone="info" title="Children usually say they are better at this than they are">
          That is not dishonesty and it is not low ability — judging your own knowing is a skill that
          develops alongside the maths. The value of asking is that a gap noticed at ten is cheaper
          to close than a gap noticed at sixteen.
        </Alert>

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users className="size-5" />}
              title="No children have done the self check yet"
              description="Open the child view on a projector, or share the link. It runs one small question per topic and takes about two minutes."
              action={
                <Button asChild size="sm">
                  <Link href={`/classes/${id}/reflect?shared=1`} target="_blank">
                    Open the child view <ArrowRight className="size-3" />
                  </Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-[12px]">{summary.line}</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "Answered", value: summary.answered, tone: "neutral" as const },
                    { label: "Overconfident", value: summary.overconfident, tone: "warn" as const },
                    { label: "Well judged", value: summary.wellCalibrated, tone: "good" as const },
                    { label: "Put themselves down", value: summary.underconfident, tone: "brand" as const },
                  ].map((s) => (
                    <div key={s.label} className="rounded-control border p-2.5 text-center">
                      <div className="text-[18px] font-semibold tabular-nums text-ink">{s.value}</div>
                      <div className="text-[10px] leading-tight text-ink-3">{s.label}</div>
                    </div>
                  ))}
                </div>
                {summary.skipped > 0 ? (
                  <p className="mt-2 text-[11px] text-ink-3">
                    {summary.skipped} skipped. A skipped answer tells you nothing, so no judgement is
                    recorded for it.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {summary.hiddenGaps.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-[12px]">Said they could, could not</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-2 text-[11px] leading-relaxed text-ink-2">
                    These are the topics where a child&apos;s confidence and their actual result disagree.
                    Each one is a short conversation, and none of it needs to be a lesson.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.hiddenGaps.map((t, i) => <Badge key={i} tone="warn" size="sm">{t}</Badge>)}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {summary.hiddenStrengths.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-[12px]">Said they could not, then could</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-2 text-[11px] leading-relaxed text-ink-2">
                    Worth naming out loud to these children. A child who believes they cannot do
                    something will avoid it, and then never find out that they can.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {summary.hiddenStrengths.map((t, i) => <Badge key={i} tone="good" size="sm">{t}</Badge>)}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[12px]">
                  <EyeOff className="size-3.5 text-ink-4" />
                  Every answer, newest first
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b text-left text-ink-4">
                      <th className="py-1 pr-2 font-medium">Topic</th>
                      <th className="py-1 pr-2 font-medium">They said</th>
                      <th className="py-1 pr-2 font-medium">Actually</th>
                      <th className="py-1 font-medium">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 30).map((r) => (
                      <tr key={r.id} className="border-b align-top last:border-0">
                        <td className="py-1.5 pr-2 text-ink">{r.topicName}</td>
                        <td className="py-1.5 pr-2 text-ink-2">
                          {CONFIDENCE_WORDS[r.predicted as keyof typeof CONFIDENCE_WORDS]?.en ?? r.predicted}
                        </td>
                        <td className="py-1.5 pr-2 text-ink-2">
                          {r.outcome === "got_it" ? "Could do it" : r.outcome === "not_yet" ? "Could not" : "Skipped"}
                        </td>
                        <td className="py-1.5">
                          {r.calibration === "overconfident" ? <Badge tone="warn" size="sm">said yes, meant maybe</Badge>
                            : r.calibration === "underconfident" ? <Badge tone="brand" size="sm">sold themselves short</Badge>
                            : r.calibration === "well_calibrated" ? <Badge tone="good" size="sm">knew</Badge>
                            : <span className="text-ink-4">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 30 ? (
                  <p className="mt-2 text-[10px] text-ink-4">and {rows.length - 30} more</p>
                ) : null}
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-[12px]">Topics it will ask about</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="mb-2 text-[11px] leading-relaxed text-ink-2">
              {topics.length} topics for Class {cls.grade}. The child picks which to do, so a short
              session is fine — a full set is not the point.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {topics.slice(0, 20).map((t) => <Badge key={t.id} tone="outline" size="sm">{t.name}</Badge>)}
              {topics.length > 20 ? <Badge tone="outline" size="sm">and {topics.length - 20} more</Badge> : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
