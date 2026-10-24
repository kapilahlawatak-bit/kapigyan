import { notFound, redirect } from "next/navigation";
import { requireTeacher } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { PrintButton, PrintHeader } from "@/components/print-shell";
import { loadPlanData } from "@/lib/analytics/plan-data";
import { buildTeachingPlan } from "@/lib/intelligence/teaching-plan";
import { topicsForClass, MISCONCEPTION_BY_ID } from "@/lib/curriculum";

export const dynamic = "force-dynamic";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/**
 * The term plan on paper.
 *
 * A planning sheet is used at the desk, with a pen, in a staff meeting — so
 * it prints one week to a block rather than a scrolling page, leaves a tick
 * box against each period for the teacher to mark done, and puts the lesson
 * outline for the current week in a size that is readable on the desk.
 */
export default async function PlanPrintPage(props: PageProps<"/plan/print">) {
  const sp = await props.searchParams;
  const session = await requireTeacher();

  const data = await loadPlanData(session, sp.class ? String(sp.class) : undefined);
  if (!data) notFound();

  const weeks = Math.min(24, Math.max(4, Number(sp.weeks) || 12));
  const perWeek = Math.min(5, Math.max(1, Number(sp.sessions) || 4));
  const consolidate = sp.consolidate === "1";

  const plan = buildTeachingPlan({
    grade: data.grade,
    syllabus: topicsForClass(data.grade),
    mastery: data.mastery,
    recommendations: data.recommendations,
    weeks,
    sessionsPerWeek: perWeek,
    consolidate,
  });

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-black print:p-0">
      <PrintButton />
      <PrintHeader
        school={data.className}
        lines={`Class ${data.grade} · ${data.studentCount} children`}
        title="Mathematics Teaching Plan"
        meta={`${weeks} weeks · ${perWeek} periods a week · ${plan.counts.teach} topics · ${plan.counts.check} revisits${consolidate ? " · no spaced revisits" : ""}`}
      />

      {plan.weeks.map((w) => (
        <section key={w.week} className="mb-5 break-inside-avoid">
          <div className="flex items-baseline gap-2 border-b border-black/30 pb-1">
            <h2 className="text-[13px] font-bold">Week {w.week}</h2>
            <p className="text-[10px] text-black/60">{w.focus}</p>
          </div>
          {w.sessions.length === 0 ? (
            <p className="mt-1.5 text-[10px] italic text-black/50">Free — assessment or catch-up.</p>
          ) : (
            <table className="mt-1.5 w-full text-[10.5px]">
              <tbody>
                {w.sessions.map((s) => (
                  <tr key={`${w.week}-${s.day}-${s.topicId}-${s.kind}`} className="align-top">
                    <td className="w-9 py-1 pr-1 text-black/60">{DAY_NAMES[s.day]}</td>
                    <td className="w-4 py-1">
                      <span className="inline-block size-2.5 rounded-full align-middle" style={{ background: s.strandColor }} />
                    </td>
                    <td className="py-1 pr-2">
                      <span className="font-semibold">{s.topicName}</span>
                      {s.kind !== "teach" ? (
                        <span className="ml-1 text-[9px] text-black/60">
                          ({s.kind === "check" ? `check, after period ${s.revisitOf}` : `consolidate, after period ${s.revisitOf}`})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1 pr-2 text-black/70">{s.why}</td>
                    <td className="w-8 py-1 text-center">
                      <span className="inline-block size-3 rounded-sm border border-black/50" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      {plan.deferred.length > 0 ? (
        <section className="mt-6 break-inside-avoid">
          <h2 className="border-b border-black/30 pb-1 text-[13px] font-bold">
            Not in this term ({plan.deferred.length})
          </h2>
          <p className="text-[10px] text-black/60">{plan.deferred.map((d) => d.topicName).join(" · ")}</p>
        </section>
      ) : null}

      {data.misconceptionTotals && Object.keys(data.misconceptionTotals).length > 0 ? (
        <section className="mt-6 break-inside-avoid">
          <h2 className="border-b border-black/30 pb-1 text-[13px] font-bold">Errors to design against</h2>
          <ol className="mt-1.5 space-y-1.5 text-[10.5px]">
            {Object.entries(data.misconceptionTotals)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([id, n]) => {
                const m = MISCONCEPTION_BY_ID.get(id);
                if (!m) return null;
                return (
                  <li key={id}>
                    <span className="font-semibold">{m.name}</span>{" "}
                    <span className="text-black/60">({n} answers)</span>
                    <div className="text-black/70">Fix: {m.remediation[0]}</div>
                  </li>
                );
              })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
