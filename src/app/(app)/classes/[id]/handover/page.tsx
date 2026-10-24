import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { requireTeacher, assertClassAccess } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { buildHandover } from "@/lib/analytics/handover";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/primitives";

export const metadata = { title: "Substitute Teacher Note" };
export const dynamic = "force-dynamic";

/**
 * One sheet, three questions, in priority order.
 *
 * Printed, it is a page a stranger can pick up on a Monday morning and use
 * without asking anyone anything. It contains no scores, no risk labels and no
 * attendance judgement — see the module for why.
 */
export default async function HandoverPage(props: PageProps<"/classes/[id]/handover">) {
  const { id } = await props.params;
  const session = await requireTeacher();
  const locale = await getLocale();
  await assertClassAccess(session, id);

  const sp = await props.searchParams;
  const handover = await buildHandover(id);
  if (!handover) notFound();

  const classes = await prisma.class.findMany({
    where: {
      ...(session.schoolId ? { schoolId: session.schoolId } : {}),
      ...(session.role === "TEACHER" && session.mode !== "HOME" ? { teacherId: session.userId } : {}),
    },
    select: { id: true, name: true },
    orderBy: [{ grade: "asc" }, { name: "asc" }],
  });

  return (
    <div className="mx-auto w-full max-w-[760px] px-6 py-6 print:max-w-none print:p-0">
      <PageHeader
        title="Substitute Teacher Note"
        titleHi="अभ्यासगत शिक्षक के लिए"
        description={`${handover.className} — print this and hand it over.`}
        locale={locale}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            {classes.map((c) => (
              <Button key={c.id} asChild size="sm" variant={c.id === id ? "primary" : "ghost"}>
                <a href={`/classes/${c.id}/handover`}>{c.name}</a>
              </Button>
            ))}
            <Button size="sm"><Printer className="size-3" /> Print</Button>
          </div>
        }
      />

      <div className="mt-4 space-y-5 text-[12px] leading-relaxed text-ink">
        <div className="border-b border-line pb-2">
          <h1 className="text-[15px] font-semibold">{handover.className} — note for the substitute teacher</h1>
          <p className="text-[11px] text-ink-3">
            Class {handover.grade} · {handover.studentCount} children
            {handover.register?.absentToday.length ? ` · absent today: ${handover.register.absentToday.join(", ")}` : ""}
          </p>
        </div>

        {/* 1. The class, and who needs knowing about. */}
        <section>
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">1 · The class</h2>
          {handover.children.length === 0 ? (
            <p className="text-ink-2">No children are enrolled yet.</p>
          ) : (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b text-left text-ink-4">
                  <th className="py-1 pr-2 font-medium">Roll</th>
                  <th className="py-1 pr-2 font-medium">Name</th>
                  <th className="py-1 font-medium">Needs to know</th>
                </tr>
              </thead>
              <tbody>
                {handover.children.map((c) => (
                  <tr key={c.name} className="border-b align-top last:border-0">
                    <td className="py-1 pr-2 tabular-nums text-ink-4">{c.rollNo ?? ""}</td>
                    <td className="py-1 pr-2 text-ink">{c.name}</td>
                    <td className="py-1 text-ink-2">{c.support ?? <span className="text-ink-4">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* 2. Where the learning is. */}
        <section>
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">2 · Where they are</h2>
          {handover.recentlyTaught.length > 0 ? (
            <p className="text-ink-2">
              Last recorded as taught: <span className="font-medium text-ink">{handover.recentlyTaught.join(", ")}</span>.
            </p>
          ) : (
            <p className="text-ink-2">Nothing has been recorded as taught for this class yet.</p>
          )}
          {handover.upNext.length > 0 ? (
            <p className="mt-1 text-ink-2">
              The plan has these next: <span className="font-medium text-ink">{handover.upNext.join(", ")}</span>.
              Pick one and teach it properly rather than skimming all three.
            </p>
          ) : null}
        </section>

        {/* 3. What must not be lost. */}
        <section>
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            3 · What is worth the day
          </h2>
          {handover.liveGaps.length === 0 ? (
            <p className="text-ink-2">
              Nothing is outstanding in what has been assessed. Teach the next topic rather than
              repeating one the class already knows.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {handover.liveGaps.map((g) => (
                <li key={g.topicName} className="text-ink-2">
                  <span className="font-medium text-ink">{g.topicName}</span> — {g.note}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border-t border-line pt-3">
          <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Before you go</h2>
          <ul className="space-y-1">
            {handover.cautions.map((c, i) => (
              <li key={i} className="text-ink-2">· {c}</li>
            ))}
          </ul>
          {handover.register && handover.register.recentlyOftenAbsent.length > 0 ? (
            <p className="mt-1.5 text-ink-2">
              Has been away several times this week: {handover.register.recentlyOftenAbsent.join(", ")}.
              Worth a friendly word at the gate, and nothing more.
            </p>
          ) : null}
        </section>

        <p className="border-t border-line pt-2 text-[10px] text-ink-4">
          This note contains no scores and no judgements about any child. It exists so the day is not
          wasted, not to replace the class teacher.
        </p>
      </div>
    </div>
  );
}
