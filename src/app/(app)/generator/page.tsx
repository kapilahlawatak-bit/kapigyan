import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { GeneratorForm } from "@/components/generator-form";
import { classMasteryMap } from "@/lib/analytics/class";
import { TOPIC_BY_ID, STRANDS, topicsForClass, topicDepth, TOPICS } from "@/lib/curriculum";
import { generateForTopic, topicHasGenerator } from "@/lib/question-generation/templates";
import { topicsThatCanCompete } from "@/lib/question-generation/competition";
import { isAiEnabled, aiDisabledReason } from "@/lib/ai/client";
import type { CompAvailability } from "@/components/generator-form";

export const metadata = { title: "Paper Generator" };
export const dynamic = "force-dynamic";

export default async function GeneratorPage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId, ...(session.role === "TEACHER" ? { teacherId: session.userId } : {}) },
    orderBy: { grade: "asc" },
    include: { _count: { select: { enrollments: true } } },
  });

  const primary = classes[0];
  const mastery = primary ? await classMasteryMap(primary.id) : [];
  const weakTopics = mastery.filter((m) => m.mastery < 0.7).slice(0, 8).map((m) => m.topicId);

  // Which topics can be produced with no AI at all. Teachers should be able
  // to see this before they rely on it.
  const coverage = primary
    ? topicsForClass(primary.grade).map((t) => ({ topicId: t.id, name: t.name, hasGenerator: topicHasGenerator(t.id) }))
    : [];

  const aiOn = isAiEnabled();

  // What a competition paper can actually be built from, per class and tier.
  //
  // Measured by asking the generators, not derived from the tier map. A topic
  // can be *supposed* to reach national level and still produce no derivable
  // question, and telling a teacher otherwise would produce a short paper with
  // no explanation. Measured here on the server so the form gets facts rather
  // than optimism, and cached per (grade, tier) so the five classes a school has
  // do not mean the same probe five times.
  const grades = [...new Set(classes.map((c) => c.grade))];
  const compAvailability: Record<number, Record<number, CompAvailability>> = {};
  for (const g of grades) {
    compAvailability[g] = {};
    for (const tier of [1, 2, 3]) {
      const eligible = topicsForClass(g).filter((t) => topicDepth(t.id).tier >= tier);
      const canBuild = topicsThatCanCompete(g, TOPICS, tier);
      compAvailability[g][tier] = {
        canBuild,
        eligibleButUnsupported: Math.max(0, eligible.length - canBuild.length),
      };
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Paper Generator"
        titleHi="पेपर जनरेटर"
        description="Build a syllabus-matched paper, a gap-filling practice set, or a printable worksheet with an answer key."
        locale={locale}
      />

      <div className="p-5 max-w-4xl w-full">
        <GeneratorForm
          locale={locale}
          classes={classes.map((c) => ({ id: c.id, name: c.name, grade: c.grade, studentCount: c._count.enrollments }))}
          weakTopics={weakTopics}
          aiOn={aiOn}
          aiReason={aiDisabledReason()}
          coverage={coverage}
          compAvailability={compAvailability}
        />
      </div>
    </div>
  );
}
