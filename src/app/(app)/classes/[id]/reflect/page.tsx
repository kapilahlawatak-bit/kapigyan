import Link from "next/link";
import { notFound } from "next/navigation";
import { Brain, ChevronRight, Sparkles } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { topicsForClass } from "@/lib/curriculum";
import { PageHeader } from "@/components/app-shell";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import { ReflectBoard } from "./board";

export const metadata = { title: "Self Check" };
export const dynamic = "force-dynamic";

/**
 * The child-facing self check.
 *
 * The teacher sets the topics, the class does the rest. Nothing here produces
 * a score, a band or a rank — the child gets a sentence back, and the teacher
 * gets the gap between what the child claimed and what the child did.
 */
export default async function ReflectPage(props: PageProps<"/classes/[id]/reflect">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();
  await assertClassAccess(session, id);

  const cls = await prisma.class.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { id: true, name: true, grade: true },
  });
  if (!cls) notFound();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-brand-soft">
          <Brain className="size-5 text-brand" />
        </div>
        <h1 className="text-[19px] font-semibold tracking-tight">Before we start — what do you think?</h1>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-2">
          There are no marks here and nothing goes on your report. Say how you think you are doing,
          then try it. Being honest helps the teacher more than being right.
        </p>
      </div>

      <ReflectBoard
        classId={id}
        className={cls.name}
        grade={cls.grade}
        topicOptions={topicsForClass(cls.grade).map((t) => ({ id: t.id, name: t.name }))}
      />

      <p className="mt-6 text-center text-[11px] text-ink-4">
        <Link href={`/classes/${id}`} className="hover:text-ink-2">Back to {cls.name}</Link>
        {" · "}
        <Link href={`/classes/${id}/reflect/set`} className="hover:text-ink-2">Teacher: set this up</Link>
      </p>
    </div>
  );
}
