import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/app-shell";
import { Badge, Button, Card, EmptyState } from "@/components/ui/primitives";
import { CurriculumMap } from "@/components/curriculum-map";
import { loadPlanData } from "@/lib/analytics/plan-data";
import { prisma } from "@/lib/db";
import { indexOverrides } from "@/lib/competition";

export const metadata = { title: "Curriculum Map" };
export const dynamic = "force-dynamic";

/**
 * The syllabus as a map, for a school teacher.
 *
 * Same component the home educator sees, but with a class switcher — a
 * teacher normally has more than one, and a map that silently shows only the
 * first is worse than no map.
 */
export default async function CurriculumPage(props: PageProps<"/curriculum">) {
  const sp = await props.searchParams;
  const session = await requireTeacher();
  const locale = await getLocale();

  const data = await loadPlanData(session, sp.class ? String(sp.class) : undefined);

  // Which competitive level the teacher is looking at. Defaults to 1 (zone),
  // because that is the level a school is most likely to be preparing for —
  // a national paper is not a Class 3 target, and defaulting to it would put a
  // demoralising number on the page by default.
  const compTarget = sp.comp === undefined ? 1 : Math.max(0, Math.min(3, Number(sp.comp) || 0));
  const classParam = sp.class ? `&class=${encodeURIComponent(String(sp.class))}` : "";

  // This school's corrections to the bundled tier map, if any. Empty for almost
  // every school, which is the expected state — the bundled answer stands until
  // somebody disagrees with it.
  const overrideRows = await prisma.topicDepthOverride.findMany({
    where: { schoolId: session.schoolId },
    select: { topicId: true, tier: true, idea: true, note: true },
  });
  const compOverrides = indexOverrides(overrideRows);

  if (!data) {
    return (
      <div className="flex flex-col">
        <PageHeader title="Curriculum Map" titleHi="पाठ्यक्रम" locale={locale} />
        <Card className="m-5 max-w-lg">
          <EmptyState
            icon={<BookOpen className="size-5" />}
            title="No classes yet"
            description="Add a class and its syllabus map appears here automatically."
            action={<Button asChild size="sm"><Link href="/classes">Add a class</Link></Button>}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Curriculum Map"
        titleHi="पाठ्यक्रम"
        description={`What ${data.className} has covered, and what still needs teaching. ${data.hasData ? "" : "No marked tests yet."}`}
        locale={locale}
        actions={
          <>
            <Button asChild variant="secondary" size="sm">
              <Link href={`/plan${sp.class ? `?class=${sp.class}` : ""}`}>Teaching plan</Link>
            </Button>
            {data.allClasses.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.allClasses.map((c) => (
                  <Button
                    key={c.id}
                    asChild
                    size="sm"
                    variant={c.id === data.classId ? "primary" : "secondary"}
                  >
                    <Link href={`/curriculum?class=${c.id}`}>{c.name}</Link>
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        }
      />

      <div className="p-5 max-w-6xl w-full">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Badge tone="outline" size="sm">Class {data.grade}</Badge>
          <Badge tone="neutral" size="sm">{data.studentCount} children</Badge>
          {data.hasData ? (
            <Badge tone="good" size="sm">{data.rows.length} topics assessed</Badge>
          ) : (
            <Badge tone="warn" size="sm">nothing assessed yet</Badge>
          )}
        </div>

        <CurriculumMap
          grade={data.grade}
          rows={data.rows}
          topicHrefTemplate="/generator?topics={topic}"
          compTarget={compTarget}
          compHrefTemplate={`/curriculum?comp={tier}${classParam}`}
          compOverrides={compOverrides}
          canEditDepth={session.role === "ADMIN"}
        />
      </div>
    </div>
  );
}
