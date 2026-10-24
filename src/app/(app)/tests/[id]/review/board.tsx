"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, CircleSlash, Keyboard, X } from "lucide-react";
import { Badge, Button, Card, CardContent, CardHeader } from "@/components/ui/primitives";
import type { ReviewItem } from "@/lib/analytics/review-queue";

/**
 * Fast review.
 *
 * One answer on screen at a time, decided with two keys. The reasoning is
 * simple: a teacher working through a stack of papers has one hand on the pen
 * and no attention to spare for a scrollbar, so anything that costs a click
 * per answer costs the whole session.
 *
 * Keys: `X` accept as correct, `Z` confirm wrong, `J`/`K` to move.
 * The screen-reader announcements are deliberate — a teacher talking through
 * the queue aloud is normal practice, and each decision is confirmed.
 */
export function ReviewBoard({
  paperId, items, coverage,
}: {
  paperId: string;
  items: ReviewItem[];
  coverage: string;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<string, "correct" | "wrong">>({});
  const heading = useRef<HTMLHeadingElement>(null);

  const current = items[index];
  const remaining = items.filter((i) => !done[i.answerId]);

  const decide = useCallback(
    async (item: ReviewItem | undefined, decision: "correct" | "wrong") => {
      if (!item) return;
      const fd = new FormData();
      fd.set("answerId", item.answerId);
      fd.set("decision", decision);
      const { overrideAnswer } = await import("@/app/actions/papers");
      await overrideAnswer(fd);
      setDone((d) => ({ ...d, [item.answerId]: decision }));
      setIndex((i) => Math.min(items.length - 1, i + 1));
      heading.current?.focus();
    },
    [items.length],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
      else if (k === "k" || e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
      else if (k === "x" && !current?.collapsedCount) { e.preventDefault(); void decide(current, "correct"); }
      else if (k === "z" && !current?.collapsedCount) { e.preventDefault(); void decide(current, "wrong"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, decide, items.length]);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p className="text-[12px] text-ink-2">Nothing to review. Every answer on this paper was settled with confidence.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div>
            <p className="text-[12px] font-semibold text-ink">{coverage}</p>
            <p className="mt-0.5 text-[10px] text-ink-4">
              {remaining.length} left · {items.length - remaining.length} decided
            </p>
          </div>
          <Badge tone="outline" size="sm">
            <Keyboard className="size-2.5" /> {items.some((i) => !i.collapsedCount) ? "X correct · Z wrong · J/K move" : "J/K move"}
          </Badge>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-good transition-all"
              style={{ width: `${((items.length - remaining.length) / items.length) * 100}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {current ? (
        <Card>
          <CardHeader>
            <div className="min-w-0">
              <h2
                ref={heading}
                tabIndex={-1}
                className="text-[13px] font-semibold text-ink outline-none"
              >
                Q{current.questionNumber} · {current.studentName}
                {current.rollNo !== null ? <span className="ml-1 text-ink-4">roll {current.rollNo}</span> : null}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone="warn" size="sm">{current.reasonText}</Badge>
                <Badge tone="outline" size="sm">{current.topicName}</Badge>
              </div>
            </div>
            <span className="shrink-0 text-[10px] tabular-nums text-ink-4">{index + 1} / {items.length}</span>
          </CardHeader>

          <CardContent className="pt-0 space-y-3">
            <p className="rounded-control bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink">
              {current.stem}
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-[10px] text-ink-4">Child wrote</p>
                <p className="mt-0.5 font-mono text-[13px] text-ink">
                  {current.response || <span className="text-ink-4">(nothing)</span>}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-ink-4">Key</p>
                <p className="mt-0.5 font-mono text-[13px] text-ink">{current.answerKey}</p>
              </div>
              <div>
                <p className="text-[10px] text-ink-4">Machine said</p>
                <p className="mt-0.5 text-[11px] text-ink-2">{current.machineVerdict}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {current.collapsedCount ? (
                <>
                  <p className="text-[11px] text-ink-2">
                    This is a question to fix, not an answer to mark. Read the stem and the key — if the
                    key is wrong, change it and all {current.collapsedCount} marks follow.
                  </p>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/tests/${paperId}/mark`}>Edit this question</Link>
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={() => void decide(current, "correct")}>
                    <Check className="size-3" /> Correct
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void decide(current, "wrong")}>
                    <CircleSlash className="size-3" /> Wrong
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
                    Previous
                  </Button>
                  <span className="ml-auto text-[10px] text-ink-4">
                    Marks now {current.marksAwarded} of {current.maxMarks}
                  </span>
                </>
              )}
            </div>

            {current.sampleStudents?.length ? (
              <p className="text-[10px] text-ink-4">
                {current.sampleStudents.join(", ")}
                {current.collapsedCount! > current.sampleStudents.length ? ` and ${current.collapsedCount! - current.sampleStudents.length} more` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 text-center">
            <X className="mx-auto size-5 text-ink-4" />
            <p className="mt-2 text-[12px] font-semibold text-ink">Done — every answer reviewed</p>
            <p className="mt-1 text-[11px] text-ink-3">
              The marks have been updated everywhere, including the analysis and any parent reports.
            </p>
            <Button asChild size="sm" className="mt-3">
              <Link href={`/tests/${paperId}/analysis`}>Open the analysis</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
