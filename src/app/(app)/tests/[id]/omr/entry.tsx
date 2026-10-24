"use client";

import { useState } from "react";
import Link from "next/link";
import { Printer, Save } from "lucide-react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui/primitives";
import { parseOmr } from "@/lib/omr-parse";
import type { OmrSheet } from "@/lib/analytics/omr";
import { saveOmr } from "./action";

/**
 * OMR entry.
 *
 * One child per row, one short string of letters. Typing `ABCDABCD` is far
 * faster than filling thirty fields, which is the entire reason this screen
 * exists.
 *
 * The row shows, live, how many of the letters were understood and how many
 * will score. A row with three letters out of ten is visibly broken before it
 * is saved, rather than becoming three wrong marks on a child's report.
 */
export function OmrEntry({
  paperId, omr, students,
}: {
  paperId: string;
  omr: OmrSheet;
  students: { id: string; name: string; rollNo: number | null }[];
}) {
  const [rows, setRows] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      {omr.note ? (
        <Alert tone="warn" title="Some questions are not on the bubble sheet">
          {omr.note}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-[12px]">Enter answers</CardTitle>
          <Badge tone="outline" size="sm">{omr.questionNumbers.length} questions per sheet</Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Button asChild variant="secondary" size="sm">
              <Link href={`/tests/${paperId}/omr/print`}><Printer className="size-3" /> Print bubble sheets</Link>
            </Button>
            <p className="text-[10px] text-ink-3">
              Type the bubbles in order, e.g. <span className="font-mono">ABCDABCD</span> or{" "}
              <span className="font-mono">A B C D A B C D</span>.
            </p>
          </div>

      {Object.entries(rows)
        .filter(([, raw]) => raw.trim().length > 0)
        .map(([studentId, raw]) => (
          <form key={studentId} action={saveOmr} className="space-y-2 border-b border-line pb-2 last:border-0">
            <input type="hidden" name="paperId" value={paperId} />
            <input type="hidden" name="studentId" value={studentId} />
            <input type="hidden" name="answers" value={raw} />
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-[11px] text-ink">
                  {students.find((c) => c.id === studentId)?.name ?? "Child"}
                </span>
                <Input
                  value={raw}
                  onChange={(e) => setRows((r) => ({ ...r, [studentId]: e.target.value }))}
                  placeholder="ABCDABCD"
                  className="mt-0.5 font-mono text-[13px] uppercase"
                  autoComplete="off"
                />
              </div>
              <span className="text-[10px] text-ink-3">
                {parseOmr(raw, omr.questionNumbers).filter((x) => x !== null).length}/{omr.questionNumbers.length} read
              </span>
              <Button type="submit" size="sm"><Save className="size-3" /> Save</Button>
            </div>
          </form>
        ))}

      {Object.values(rows).filter((r) => r.trim().length > 0).length === 0 ? (
        <p className="text-[11px] text-ink-3">Type a child&apos;s answers above; a save button appears for each one.</p>
      ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
