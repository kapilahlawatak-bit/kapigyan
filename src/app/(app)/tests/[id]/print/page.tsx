import { notFound } from "next/navigation";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { prisma, parseJson } from "@/lib/db";
import { formatDate, topicName } from "@/lib/utils";
import { COMPETENCY_LABEL } from "@/lib/paper/labels";
import { PrintHeader, PrintButton } from "@/components/print-shell";

export const dynamic = "force-dynamic";

/**
 * The printable paper.
 *
 * A dedicated route rather than a print stylesheet on the detail page,
 * because teachers print this on a school laser printer and photocopy it.
 * The layout is fixed-width, ink-efficient, black-on-white, and leaves room
 * for the child to actually write — answer lines rather than a computer
 * interface, and Hindi stems printed alongside English when they exist.
 */
export default async function PrintPaperPage(props: PageProps<"/tests/[id]/print">) {
  const { id } = await props.params;
  const session = await requireTeacher();

  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      school: { select: { name: true, city: true, state: true } },
      class: { select: { name: true, grade: true, section: true } },
      questions: { orderBy: { position: "asc" } },
    },
  });
  if (!paper || paper.schoolId !== session.schoolId) notFound();
  // A printable paper is the child's name and answers on a page that gets
  // handed out. Same reasoning as the mark page: ownership, not membership.
  if (paper.classId) await assertClassAccess(session, paper.classId);

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-black print:p-0">
      <PrintButton />
      <PrintHeader
        school={paper.school.name}
        lines={[paper.school.city, paper.school.state].filter(Boolean).join(", ")}
        title={paper.title}
        meta={`Class ${paper.class?.grade ?? paper.grade}${paper.class?.section ? ` - ${paper.class.section}` : ""}  ·  ${paper.term}  ·  ${paper.maxMarks} marks${paper.timeMinutes ? `  ·  ${paper.timeMinutes} minutes` : ""}  ·  ${formatDate(paper.date, true)}`}
      />

      <div className="mb-6 flex flex-wrap gap-8 border-b border-black/20 pb-3 text-[13px]">
        <span>Name: ________________________________________</span>
        <span>Date: ______________</span>
        <span>Marks obtained: ________ / {paper.maxMarks}</span>
      </div>

      <ol className="space-y-6">
        {paper.questions.map((q) => {
          const options = parseJson<string[]>(q.options, []);
          return (
            <li key={q.id} className="break-inside-avoid text-[14px] leading-relaxed">
              <div className="flex gap-2">
                <span className="font-semibold shrink-0">{q.position}.</span>
                <div className="min-w-0 flex-1">
                  <p>{q.stem}</p>
                  {q.stemHi ? <p className="mt-0.5 text-[13px] text-black/70">{q.stemHi}</p> : null}

                  {options.length > 0 ? (
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {options.map((o, i) => (
                        <p key={i} className="pl-1">{o}</p>
                      ))}
                    </div>
                  ) : null}

                  {q.type === "long" || q.type === "medium" ? (
                    <div className="mt-4 space-y-7">
                      {[0, 1, 2].map((i) => <div key={i} className="border-b border-black/15" />)}
                    </div>
                  ) : null}

                  <p className="mt-1.5 text-[11px] text-black/45">
                    {topicName(q.topicId)} · {COMPETENCY_LABEL[q.competency] ?? q.competency} · {q.marks} mark{q.marks === 1 ? "" : "s"}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] tabular-nums">({q.marks})</span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-10 border-t border-black/20 pt-3 text-[10px] text-black/50">
        Generated with Kapigyan · {paper.school.name}
      </div>
    </div>
  );
}
