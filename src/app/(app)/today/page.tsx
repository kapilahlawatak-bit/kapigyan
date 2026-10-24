import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarCheck, CheckCheck, CircleAlert, Map, NotebookPen, Sparkles } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Button, Card, EmptyState, More } from "@/components/ui/primitives";
import { todayFor } from "@/lib/analytics/today";

export const metadata = { title: "Today" };
export const dynamic = "force-dynamic";

const ICON: Record<string, React.ReactNode> = {
  att: <CalendarCheck className="size-4" />,
  "teach": <NotebookPen className="size-4" />,
  review: <CheckCheck className="size-4" />,
};

/**
 * Today.
 *
 * One screen, built for a phone held in one hand in a corridor. Everything
 * here is time-bound; nothing on it is browseable exploration. If a teacher's
 * day is empty, it says so and stops.
 */
export default async function TodayPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "TEACHER" && session.role !== "ADMIN") redirect("/no-access");
  const locale = await getLocale();

  const view = await todayFor(session);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col px-4 py-5 sm:px-5">
      <PageHeader
        title="Today"
        titleHi="आज"
        description={view.date}
        locale={locale}
      />

      <p className="mt-1 text-[13px] font-medium text-ink">{view.headline}</p>

      {view.clear ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Nothing is due today"
            description="No register to take, nothing to review, no lesson unticked. If that surprises you, the plan is probably empty for today rather than complete."
            action={
              <div className="flex gap-2">
                <Button asChild size="sm" variant="secondary"><Link href="/plan">Open the plan</Link></Button>
                <Button asChild size="sm" variant="ghost"><Link href="/curriculum">Curriculum map</Link></Button>
              </div>
            }
          />
        </Card>
      ) : (
        <ul className="mt-4 space-y-2">
          {view.tasks.map((t) => (
            <li key={t.id}>
              <Card>
                {/* The detail line sits outside the link: a <details> inside an
                    <a> cannot be toggled without the tap also navigating away,
                    which is the one thing a corridor-phone screen must not do. */}
                <div className="p-4">
                  <Link href={t.href} className="flex items-start gap-3">
                    <span className={t.weight === 1 ? "mt-0.5 text-warn" : "mt-0.5 text-ink-4"}>
                      {ICON[t.id.split("-")[0]!] ?? <CircleAlert className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-snug text-ink">{t.what}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-2">{t.because}</span>
                    </span>
                    {t.weight === 1 ? <Badge tone="warn" size="sm">First bell</Badge> : null}
                  </Link>
                  {t.detail ? (
                    <More summary="More" className="ml-7 mt-1.5">
                      <p className="text-[11px] leading-relaxed text-ink-3">{t.detail}</p>
                    </More>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm"><Link href="/plan"><Map className="size-3" /> Term plan</Link></Button>
        <Button asChild variant="ghost" size="sm"><Link href="/classes">Register</Link></Button>
        <Button asChild variant="ghost" size="sm"><Link href="/gain">Did it work?</Link></Button>
      </div>

      {view.tasks.some((t) => t.weight === 1) ? (
        <More summary="Why the register comes first" className="mt-6">
          <Alert tone="info" title="Why the register comes first">
            Absence patterns and the dropout risk both need the register. A register kept late still gives the
            week; a register never kept gives the app nothing to reason about.
          </Alert>
        </More>
      ) : null}
    </div>
  );
}
