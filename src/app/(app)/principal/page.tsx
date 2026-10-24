import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, CircleAlert, EyeOff, Target } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, Progress } from "@/components/ui/primitives";
import { schoolView } from "@/lib/analytics/school-view";

export const metadata = { title: "School Overview" };
export const dynamic = "force-dynamic";

/**
 * The principal's view.
 *
 * Coverage and shared gaps, not a league table. The page says why it refuses
 * to rank teachers, because a feature that explains its own omissions is
 * trusted and one that quietly omits them is not.
 */
export default async function PrincipalPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN" && session.role !== "TEACHER") redirect("/no-access");
  if (!session.schoolId) redirect("/no-access");
  const locale = await getLocale();

  const view = await schoolView(session.schoolId);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="School Overview"
        titleHi="विद्यालय अवलोकन"
        description={`${view.classCount} classes · ${view.studentCount} children`}
        locale={locale}
      />

      <div className="p-5 max-w-3xl w-full space-y-4">
        {view.classCount === 0 ? (
          <Card>
            <EmptyState
              icon={<Building2 className="size-5" />}
              title="No classes yet"
              description="Set up a class and this page will show where the school's mathematics is strong, and where it is not."
              action={<Link href="/classes" className="text-[12px] text-brand underline underline-offset-2">Go to classes</Link>}
            />
          </Card>
        ) : (
          <>
            <Alert tone="info" title={view.headline} />

            <Alert tone="info" title="There is no teacher ranking here, deliberately">
              Ranking teachers by their classes&apos; scores makes the teacher of a hard class look like a
              failing teacher, and quietly rewards teaching easier material. What is shown instead is
              coverage — which strands have actually been assessed, and which problems several classes
              share at once. Those are the things only a principal can act on.
            </Alert>

            {view.sharedGaps.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[12px]">
                    <CircleAlert className="size-3.5 text-warn" />
                    Weak across several classes at once
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {view.sharedGaps.map((g) => (
                    <div key={g.topicId} className="rounded-control border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] font-medium text-ink">{g.topicName}</span>
                        <Badge tone="warn" size="sm">{g.weakClasses} of {g.classCount} classes</Badge>
                        <Badge tone="outline" size="sm">average {g.average}%</Badge>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
                        When several classes reach the same difficulty, the likely cause is how the topic
                        is being taught across the school rather than any one teacher&apos;s class. This is a
                        curriculum and staff-meeting conversation.
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-[12px]">Coverage by strand</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2.5">
                {view.strandHealth.length === 0 ? (
                  <p className="text-[11px] text-ink-2">Nothing has been assessed yet, so no strand has coverage.</p>
                ) : (
                  view.strandHealth.map((s) => (
                    <div key={s.strand}>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-ink">{s.strandName}</span>
                        <span className="text-ink-3">
                          {s.weakClasses > 0 ? `${s.weakClasses} class${s.weakClasses === 1 ? "" : "es"} weak · ` : ""}
                          assessed in {s.classCount} of {view.classCount}
                        </span>
                      </div>
                      <div className="mt-1">
                        <Progress value={s.coverage * 100} tone={s.coverage < 0.5 ? "warn" : "good"} />
                      </div>
                    </div>
                  ))
                )}
                <p className="text-[10px] leading-relaxed text-ink-4">
                  Coverage is how many classes have been asked about this strand at all. A strand at 20%
                  has not been shown to be weak — it has not been looked at.
                </p>
              </CardContent>
            </Card>

            {view.neverAssessed.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[12px]">
                    <EyeOff className="size-3.5 text-ink-4" />
                    Never assessed anywhere ({view.neverAssessed.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="mb-2 text-[11px] leading-relaxed text-ink-2">
                    No class has ever been asked these. They are not weak — they are unknown, and an
                    unknown cannot be reported on.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {view.neverAssessed.slice(0, 14).map((t) => (
                      <Badge key={t.topicId} tone="outline" size="sm">Class {t.grade}: {t.topicName}</Badge>
                    ))}
                    {view.neverAssessed.length > 14 ? (
                      <Badge tone="outline" size="sm">and {view.neverAssessed.length - 14} more</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-[12px]">
                  <Target className="size-3.5 text-brand" />
                  By class
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b text-left text-ink-4">
                      <th className="py-1 pr-2 font-medium">Class</th>
                      <th className="py-1 pr-2 font-medium">Children</th>
                      <th className="py-1 pr-2 font-medium">Topics assessed</th>
                      <th className="py-1 font-medium">Weakest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.classes.map((c) => (
                      <tr key={c.id} className="border-b align-top last:border-0">
                        <td className="py-1.5 pr-2">
                          <Link href={`/classes/${c.id}/handover`} className="text-ink hover:text-brand">{c.name}</Link>
                        </td>
                        <td className="py-1.5 pr-2 tabular-nums text-ink-2">{c.students}</td>
                        <td className="py-1.5 pr-2 tabular-nums text-ink-2">{c.topics || <span className="text-ink-4">none</span>}</td>
                        <td className="py-1.5 text-ink-2">{c.weakest ?? <span className="text-ink-4">not enough evidence</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
