import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { generateForTopic, topicHasGenerator } from "@/lib/question-generation/templates";
import { TOPIC_BY_ID } from "@/lib/curriculum";
import { PrintButton, PrintHeader } from "@/components/print-shell";

export const dynamic = "force-dynamic";

/**
 * A single practice sheet, printed for the kitchen table.
 *
 * Answers are on the same page, below a fold line, so a parent can check it
 * without flipping. The instructions are addressed to the parent, not the
 * child, because the parent is the one who needs to know what the sheet is
 * for.
 */
export default async function PracticePrintPage(props: PageProps<"/parent/practice/print">) {
  const sp = await props.searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "PARENT") redirect("/no-access");

  const childId = String(sp.child ?? "");
  const topicId = String(sp.topic ?? "");
  if (!childId || !topicId) notFound();

  // Same consent check the on-screen page uses.
  const link = await prisma.parentLink.findFirst({
    where: { parentId: session.userId, studentId: childId, revokedAt: null },
    include: { student: { select: { name: true } } },
  });
  if (!link) notFound();
  if (!topicHasGenerator(topicId)) notFound();

  const meta = TOPIC_BY_ID.get(topicId);
  if (!meta) notFound();

  const enrolment = await prisma.enrollment.findFirst({
    where: { studentId: childId },
    select: { class: { select: { grade: true } } },
  });
  const grade = (enrolment?.class.grade ?? 3) as 1 | 2 | 3 | 4 | 5;
  const questions = generateForTopic(topicId, 8, grade, hash(topicId + grade + childId));

  if (questions.length === 0) notFound();

  const first = link.student.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-black print:p-0">
      <PrintButton />
      <PrintHeader
        school="Kapigyan"
        lines="Home practice sheet"
        title={`${meta.name}`}
        meta={`For ${link.student.name}  ·  Class ${grade}  ·  8 questions  ·  about 10 minutes`}
      />

      <div className="mb-5 rounded border border-black/20 p-3 text-[12px] leading-relaxed">
        <p className="font-semibold">For the parent</p>
        <p>
          Ask {first} to do these slowly and show any working. If an answer is wrong, do not correct it
          straight away — ask &ldquo;show me how you got that&rdquo; first, because the way of working
          usually shows what needs teaching. Mark it together using the answers at the bottom.
        </p>
      </div>

      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={i} className="break-inside-avoid text-[14px] leading-relaxed">
            <div className="flex gap-2">
              <span className="font-semibold shrink-0">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <p>{q.stem}</p>
                {q.options && q.options.length > 0 ? (
                  <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    {q.options.map((o, oi) => <p key={oi} className="pl-1">{o}</p>)}
                  </div>
                ) : null}
                {q.options && q.options.length === 0 ? (
                  <div className="mt-3 space-y-6">
                    <div className="border-b border-black/15" />
                  </div>
                ) : null}
              </div>
              <span className="shrink-0 text-[12px] tabular-nums">({q.marks})</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 border-t-2 border-black pt-3 break-inside-avoid">
        <h2 className="text-[14px] font-bold">Answers</h2>
        <p className="text-[11px] text-black/60">Cut along the line above, or fold the page, before handing this to {first}.</p>
        <ol className="mt-2 space-y-1 text-[12px]">
          {questions.map((q, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-5 shrink-0 font-semibold tabular-nums">{i + 1}.</span>
              <span className="font-mono">{q.answerKey}</span>
              {q.explanation ? <span className="text-black/60"> — {q.explanation}</span> : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
