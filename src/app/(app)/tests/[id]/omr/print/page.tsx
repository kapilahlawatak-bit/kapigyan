import { notFound } from "next/navigation";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { prisma } from "@/lib/db";
import { buildOmr } from "@/lib/analytics/omr";

export const metadata = { title: "OMR Sheet" };
export const dynamic = "force-dynamic";

/**
 * The printable bubble sheet.
 *
 * Print one per child, or thirty on an A4 by turning scaling down in the print
 * dialog. The sheet ID is derived from the paper and the child, so a loose
 * sheet on a desk can always be traced back to its paper — a lost pile of
 * identical sheets is the fastest way to lose a term's marks.
 */
export default async function OmrPrintPage(props: PageProps<"/tests/[id]/omr/print">) {
  const { id } = await props.params;
  const session = await requireTeacher();

  const paper = await prisma.paper.findFirst({
    where: { id, ...(session.schoolId ? { schoolId: session.schoolId } : {}) },
    select: { id: true, classId: true, class: { select: { name: true } } },
  });
  if (!paper) notFound();
  if (paper.classId) await assertClassAccess(session, paper.classId);

  const omr = await buildOmr(paper.id);
  const perPage = 2;

  return (
    <div className="mx-auto w-full max-w-[820px] px-6 py-6 print:max-w-none print:p-0">
      <div className="mb-4 print:hidden">
        <p className="text-[12px] text-ink-2">
          Fill one bubble per question with a 2B pencil. A crossed-out bubble is fine; an empty one is not.
          Print thirty of these and scale to fit the page.
        </p>
      </div>

      {Array.from({ length: perPage }, (_, sheetNo) => (
        <div key={sheetNo} className="mb-6 break-after-page border-2 border-ink p-4 last:break-after-auto print:mb-0 print:border-2">
          <div className="mb-3 flex items-end justify-between border-b-border-b border-line pb-2">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-ink-3">Kapigyan · {paper.class?.name}</p>
              <p className="text-[13px] font-semibold text-ink">{omr.paperTitle}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-ink-3">Sheet</p>
              <p className="font-mono text-[12px] font-semibold text-ink">
                {paper.id.slice(0, 4).toUpperCase()}-{String(sheetNo + 1).padStart(2, "0")}
              </p>
            </div>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-4">
            {["Name", "Class", "Roll No.", "Date"].map((label) => (
              <div key={label}>
                <span className="text-[8px] uppercase text-ink-3">{label}</span>
                <span className="block border-b border-dotted border-ink-4">&nbsp;</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-6">
            {omr.columns.map((col) => (
              <div key={col.numbers[0]}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="w-6 pb-1 text-left text-[8px] font-medium text-ink-3">Q</th>
                      {col.options.map((o) => (
                        <th key={o} className="text-center text-[8px] font-medium text-ink-3">{o}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {col.numbers.map((n) => (
                      <tr key={n}>
                        <td className="py-0.5 pr-1 text-[9px] tabular-nums text-ink-3">{n}</td>
                        {col.options.map((o) => (
                          <td key={o} className="py-0.5 text-center">
                            <span className="inline-block size-4 rounded-full border border-ink-4" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {omr.skipped.length > 0 && sheetNo === 0 ? (
            <div className="mt-3 border-t border-line pt-2 text-[8px] leading-snug text-ink-3">
              <p className="font-semibold">Not on this sheet — mark these separately:</p>
              {omr.skipped.map((s) => (
                <p key={s.position}>Q{s.position}: {s.reason}</p>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
