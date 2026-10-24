import Link from "next/link";
import { BookOpen } from "lucide-react";
import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { PageHeader } from "@/components/app-shell";
import { Button, Card, EmptyState } from "@/components/ui/primitives";
import { CurriculumMap } from "@/components/curriculum-map";
import { loadPlanData } from "@/lib/analytics/plan-data";
import { prisma } from "@/lib/db";
import { indexOverrides } from "@/lib/competition";

export const metadata = { title: "Curriculum Map" };
export const dynamic = "force-dynamic";

/**
 * The home educator's curriculum map.
 *
 * Shares its component with the school teacher's page, because the two are
 * the same job: this replaces the textbook index, the annual planner and the
 * progress register for a family teaching at the kitchen table.
 */
export default async function HomeCurriculumPage(props: PageProps<"/home/curriculum">) {
  const sp = await props.searchParams;
  const session = await requireTeacher();
  const locale = await getLocale();

  const data = await loadPlanData(session);

  // Zone level by default, for the same reason as the school page: a family
  // teaching one child is most often thinking about a school or district talent
  // test, not a national paper.
  const compTarget = sp.comp === undefined ? 1 : Math.max(0, Math.min(3, Number(sp.comp) || 0));

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
            title="No child added yet"
            description="Add your child and the full Class 1–5 syllabus appears here, marked off as you go."
            action={<Button asChild size="sm"><Link href="/classes">Add a child</Link></Button>}
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
        description={`Class ${data.grade} mathematics, topic by topic. ${data.hasData ? "" : "Nothing assessed yet."}`}
        locale={locale}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/plan">Teaching plan</Link>
          </Button>
        }
      />

      <div className="p-5 max-w-6xl w-full">
        <CurriculumMap
          grade={data.grade}
          rows={data.rows}
          topicHrefTemplate="/generator?topics={topic}"
          compTarget={compTarget}
          compHrefTemplate="/home/curriculum?comp={tier}"
          compOverrides={compOverrides}
          canEditDepth={session.role === "ADMIN"}
        />
      </div>
    </div>
  );
}
