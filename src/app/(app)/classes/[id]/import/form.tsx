"use client";

import { useActionState, useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea } from "@/components/ui/primitives";
import { parseMarksCsv } from "@/lib/analytics/csv-marks";
import { importMarks, type ImportResult } from "@/app/actions/import-marks";

type State = ImportResult | null;

/**
 * CSV import.
 *
 * The parse runs live in the browser as the teacher pastes, so a problem row
 * is visible *before* anything is saved. A teacher who discovers on saving
 * that half their roll did not match has to start again; one who sees it
 * while typing just fixes the spreadsheet.
 */
export function ImportForm({ classId, className }: { classId: string; className: string }) {
  const [state, action, pending] = useActionState(async (_prev: State, fd: FormData) => importMarks(fd), null);
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseMarksCsv(text) : null;
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="classId" value={classId} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="subject" className="text-[11px]">Which subject is this?</Label>
          <Input id="subject" name="subject" placeholder="English" className="mt-0.5" required />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
          <FileSpreadsheet className="size-3" /> Choose a .csv
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
      </div>

      <div>
        <Label htmlFor="csv" className="text-[11px]">
          Paste the mark sheet, with a header row: <span className="font-mono text-ink-3">Name, Subject, Marks, Max</span>
        </Label>
        <Textarea
          id="csv"
          name="csv"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={"Name,Subject,Marks,Max\nAarav Sharma,English,42,50\nDiya Patel,Hindi,38,40"}
          className="mt-0.5 font-mono text-[11px]"
        />
      </div>

      {parsed && parsed.rows.length > 0 ? (
        <div className="space-y-2">
          <Alert tone={parsed.problems.length === 0 ? "good" : "warn"} title={`${parsed.good.length} of ${parsed.rows.length} rows can be read`}>
            {parsed.subjects.length > 0 ? `Subjects found: ${parsed.subjects.join(", ")}.` : "No subject column was recognised."}
            {parsed.noHeader ? " There was no header row, so the columns are being assumed to be Name, Subject, Marks, Max." : ""}
          </Alert>

          {parsed.problems.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-[11px]">Rows that will be skipped</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ul className="space-y-1 text-[11px] text-ink-2">
                  {parsed.problems.slice(0, 8).map((r) => (
                    <li key={r.line}>
                      <span className="tabular-nums text-ink-4">line {r.line}</span> — {r.problem}
                    </li>
                  ))}
                  {parsed.problems.length > 8 ? (
                    <li className="text-ink-4">and {parsed.problems.length - 8} more</li>
                  ) : null}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Alert tone="info" title="These marks are stored as context only">
        They will appear on the student&apos;s page and in exports, and nowhere else. They are not mixed into
        mathematics mastery, the misconception engine or the risk score — a Hindi mark is no evidence at
        all about how a child reasons in a sum.
      </Alert>

      {state?.error ? <Alert tone="bad" title="Nothing was imported">{state.error}</Alert> : null}
      {state?.imported !== undefined ? (
        <Alert tone="good" title={`${state.imported} marks stored for ${className}`}>
          {state.unmatched?.length
            ? `${state.unmatched.length} name${state.unmatched.length === 1 ? "" : "s"} did not match a child in this class and were not imported: ${state.unmatched.slice(0, 5).join(", ")}${state.unmatched.length > 5 ? "…" : ""}`
            : "Every name matched."}
        </Alert>
      ) : null}

      <Button type="submit" size="sm" disabled={pending || !text.trim()}>
        <Upload className="size-3" /> {pending ? "Importing…" : `Import ${parsed?.good.length ?? 0} marks`}
      </Button>
    </form>
  );
}