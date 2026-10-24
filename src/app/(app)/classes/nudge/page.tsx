import { notFound } from "next/navigation";
import { MessageCircleHeart } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { Alert, Button, Card, CardContent, EmptyState } from "@/components/ui/primitives";
import { nudgeRows } from "@/lib/analytics/nudge-data";
import { NudgeList } from "./list";

export const metadata = { title: "Messages Home" };
export const dynamic = "force-dynamic";

/**
 * Messages home.
 *
 * The whole feature exists because "please see that homework is done" is a
 * sentence nobody acts on. Each message gives one thing a family can do
 * tonight, in about five minutes, with something already in the house.
 */
export default async function NudgePage(props: PageProps<"/classes/nudge">) {
  const session = await requireTeacher();
  const locale = await getLocale();

  const sp = await props.searchParams;
  const requested = (Array.isArray(sp.classId) ? sp.classId[0] : sp.classId) ?? undefined;

  const classes = await prisma.class.findMany({
    where: {
      ...(session.schoolId ? { schoolId: session.schoolId } : {}),
      ...(session.role === "TEACHER" && session.mode !== "HOME" ? { teacherId: session.userId } : {}),
    },
    select: { id: true, name: true, grade: true, _count: { select: { enrollments: true } } },
    orderBy: { grade: "asc" },
  });
  if (classes.length === 0) notFound();

  const target = classes.find((c) => c.id === requested) ?? classes[0]!;
  const rows = await nudgeRows(session, target.id);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Messages Home"
        titleHi="घर पर संदेश"
        description="One thing to try tonight, for each family who has given consent."
        locale={locale}
      />

      <div className="p-5 max-w-2xl w-full space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {classes.map((c) => (
            <Button key={c.id} asChild size="sm" variant={c.id === target.id ? "primary" : "ghost"}>
              <a href={`/classes/nudge?classId=${c.id}`}>{c.name}</a>
            </Button>
          ))}
        </div>

        <Alert tone="info" title="No scores, no rankings, no comparisons">
          These messages say what to do and why, never how the child compares to others. A parent who
          reads a rank learns nothing they can act on and feels worse about the school. Copy them into
          whatever the school already uses — a diary note, or a message the family already gets.
        </Alert>

        {target._count.enrollments === 0 ? (
          <Card>
            <EmptyState
              icon={<MessageCircleHeart className="size-5" />}
              title="No children in this class"
              description="Add the class roll first."
            />
          </Card>
        ) : (
          <NudgeList rows={rows} />
        )}
      </div>
    </div>
  );
}
