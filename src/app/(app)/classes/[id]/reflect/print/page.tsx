import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/primitives";
import { summariseReflections, CONFIDENCE_WORDS } from "@/lib/intelligence/reflection";

export const metadata = { title: "Self Check Results" };
export const dynamic = "force-dynamic";

/**
 * A printable sheet for the conversation.
 *
 * Topic-only and completely anonymous: no names, no roll numbers, no scores.
 * A teacher walks the class through "this one surprised me" without any child
 * being identifiable in the handout, which is what makes it safe to project.
 */
export default async function ReflectPrintPage(props: PageProps<"/classes/[id]/reflect/print">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  await assertClassAccess(session, id);

  const cls = await prisma.class.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { name: true, grade: true },
  });
  if (!cls) notFound();

  const rows = await prisma.reflection.findMany({
    where: { classId: id },
    orderBy: { createdAt: "desc" },
    select: { topicName: true, predicted: true, outcome: true, calibration: true },
    take: 300,
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

  const byTopic = new Map<string, { over: number; under: number; ok: number; skipped: number }>();
  for (const r of rows) {
    const e = byTopic.get(r.topicName) ?? { over: 0, under: 0, ok: 0, skipped: 0 };
    if (r.calibration === "overconfident") e.over++;
    else if (r.calibration === "underconfident") e.under++;
    else if (r.calibration === "well_calibrated") e.ok++;
    else e.skipped++;
    byTopic.set(r.topicName, e);
  }
  const topics = [...byTopic.entries()].sort((a, b) => b[1].over - a[1].over || b[1].under - a[1].under);

  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-[15px] font-semibold">Self check — printable</h1>
        <Button size="sm"><Printer className="size-3" /> Print</Button>
      </div>

      <h1 className="text-[15px] font-semibold">{cls.name} — what the children thought</h1>
      <p className="mt-0.5 text-[11px] text-ink-3">
        {summary.answered} answered · {summary.skipped} skipped · no names, no scores
      </p>

      <p className="mt-3 rounded-control bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-2">
        {summary.line}
      </p>

      {rows.length === 0 ? (
        <p className="mt-4 text-[12px] text-ink-2">Nothing recorded yet.</p>
      ) : (
        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b text-left text-ink-4">
              <th className="py-1.5 pr-2 font-medium">Topic</th>
              <th className="py-1.5 pr-2 text-right font-medium">Said yes, wasn&apos;t</th>
              <th className="py-1.5 pr-2 text-right font-medium">Said no, was</th>
              <th className="py-1.5 pr-2 text-right font-medium">Knew</th>
              <th className="py-1.5 text-right font-medium">Skipped</th>
            </tr>
          </thead>
          <tbody>
            {topics.map(([name, e]) => (
              <tr key={name} className="border-b last:border-0">
                <td className="py-1.5 pr-2 text-ink">{name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-warn">{e.over || ""}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-brand">{e.under || ""}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-good">{e.ok || ""}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-4">{e.skipped || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-5 border-t border-line pt-3 text-[10px] leading-relaxed text-ink-4">
        This sheet contains no names and no marks. It records only the gap between what a child said
        they could do and what they then did — a prompt for a conversation, not a judgement.
      </p>
    </div>
  );
}
