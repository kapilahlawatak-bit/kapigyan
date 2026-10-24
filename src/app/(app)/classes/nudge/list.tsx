"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives";
import type { NudgeRow } from "@/lib/analytics/nudge-data";

/**
 * The nudge list.
 *
 * Copy-to-clipboard rather than sending from here: this app has no SMS or
 * WhatsApp provider, and pretending otherwise would produce a button that
 * either fails or silently does nothing. A teacher pastes into whatever the
 * school already uses, which is usually a diary note or a message the family
 * already receives.
 */
export function NudgeList({ rows }: { rows: NudgeRow[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [onlyWorth, setOnlyWorth] = useState(true);

  const shown = onlyWorth ? rows.filter((r) => r.worthSending) : rows;

  async function copy(row: NudgeRow) {
    try {
      await navigator.clipboard.writeText(row.message);
      setCopied(row.studentId);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline" size="sm">{rows.length} families with consent</Badge>
        <Badge tone="warn" size="sm">{rows.filter((r) => r.worthSending).length} with something to do</Badge>
        <Button size="sm" variant="ghost" onClick={() => setOnlyWorth((v) => !v)}>
          {onlyWorth ? "Show all" : "Only worth sending"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <Alert tone="info" title="No families have active consent on file">
          Under the DPDP Act a message can only be prepared for a parent who has given consent and not
          withdrawn it. Ask families to add consent in Settings, and the list will fill in on its own.
        </Alert>
      ) : shown.length === 0 ? (
        <Alert tone="good" title="Nothing to send this week">
          Every child with consent is working confidently across what we have covered. Sending
          something anyway would train families to ignore the messages.
        </Alert>
      ) : (
        <div className="space-y-2">
          {shown.map((row) => (
            <Card key={row.studentId}>
              <CardHeader>
                <div className="min-w-0">
                  <CardTitle className="text-[12px]">
                    {row.name}
                    {row.rollNo !== null ? <span className="ml-1 text-ink-4">#{row.rollNo}</span> : null}
                  </CardTitle>
                  <p className="text-[10px] text-ink-4">to {row.parentName}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => void copy(row)}>
                  {copied === row.studentId ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copied === row.studentId ? "Copied" : "Copy"}
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                <pre className="whitespace-pre-wrap rounded-control bg-surface-2 p-3 font-sans text-[11px] leading-relaxed text-ink-2">
                  {row.message}
                </pre>
                {row.topicName ? (
                  <p className="mt-1.5 text-[10px] text-ink-4">Focus this week: {row.topicName}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
