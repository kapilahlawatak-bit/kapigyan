"use client";

import { useState } from "react";
import { Check, Lightbulb } from "lucide-react";
import { Alert, Badge, Button, Card, CardContent } from "@/components/ui/primitives";
import { CONFIDENCE_WORDS, gradeReflection, reflectBack, type Confidence, type Reflection } from "@/lib/intelligence/reflection";
import { recordReflection } from "@/app/actions/reflection";
import { cn } from "@/lib/utils";

/**
 * One topic at a time: choose, try, then see what you said.
 *
 * The order is deliberate and it is the whole design. The child commits to a
 * prediction *before* seeing whether they can do it, because a child who tries
 * first and is asked afterwards will simply describe what happened and the
 * comparison becomes meaningless.
 */
export function ReflectBoard({
  classId, className, grade, topicOptions,
}: {
  classId: string;
  className: string;
  grade: number;
  topicOptions: { id: string; name: string }[];
}) {
  const [stage, setStage] = useState<"choose" | "try" | "done">("choose");
  const [i, setI] = useState(0);
  const [topic, setTopic] = useState<{ id: string; name: string } | null>(null);
  const [predicted, setPredicted] = useState<Confidence | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<{ outcome: Reflection["outcome"]; calibration: Reflection["calibration"] | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const [log, setLog] = useState<Reflection[]>([]);

  const done = i >= topicOptions.length;
  const topicName = topic?.name ?? "";

  async function save() {
    if (!topic || !predicted || !result) return;
    await recordReflection({ classId, topicId: topic.id, topicName: topic.name, predicted, ...result });
    setSaved(true);
  }

  function nextTopic() {
    setI((n) => n + 1);
    setTopic(null);
    setPredicted(null);
    setAnswer("");
    setResult(null);
    setSaved(false);
    setStage("choose");
  }

  // ---- choose -----------------------------------------------------------
  if (done && log.length > 0) {
    return (
      <Card>
        <CardContent className="pt-5">
          <div className="text-center">
            <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-good-soft">
              <Check className="mx-auto size-5 text-good" />
            </div>
            <h2 className="text-[15px] font-semibold">That&apos;s all {log.length}. Thank you.</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-[12px] leading-relaxed text-ink-2">
              Your teacher can see which topics you found harder than you expected. That is the useful
              part — it is not about getting everything right.
            </p>
            <Button className="mt-4" variant="secondary" onClick={() => { setLog([]); nextTopic(); setI(0); }}>
              Start again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stage === "choose") {
    return (
      <div className="space-y-4">
        {i > 0 ? (
          <p className="text-center text-[11px] text-ink-4">Topic {i + 1} of {topicOptions.length}</p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {topicOptions.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTopic(t); setStage("try"); }}
              className="rounded-control border bg-surface px-4 py-3 text-left text-[13px] font-medium text-ink transition-colors hover:border-brand hover:bg-brand-soft"
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---- try --------------------------------------------------------------
  return (
    <div className="space-y-4">
      <div className="text-center">
        <Badge tone="neutral" size="sm">{topicName}</Badge>
      </div>

      {!predicted ? (
        <>
          <h2 className="text-center text-[15px] font-medium">How does {topicName} feel right now?</h2>
          <div className="space-y-2">
            {(Object.keys(CONFIDENCE_WORDS) as Confidence[]).map((c) => (
              <button
                key={c}
                onClick={() => setPredicted(c)}
                className="flex w-full items-start gap-3 rounded-control border bg-surface px-4 py-3 text-left transition-colors hover:border-brand hover:bg-brand-soft"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-current opacity-40" />
                <span>
                  <span className="block text-[13px] font-medium text-ink">{CONFIDENCE_WORDS[c].en}</span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">
                    {CONFIDENCE_WORDS[c].blurb}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="text-center text-[11px] text-ink-4">Pick one, then try it. You can be wrong either way.</p>
        </>
      ) : result ? (
        // ---- done, one topic -------------------------------------------
        <Card>
          <CardContent className="pt-5 text-center">
            <p className="text-[11px] text-ink-4">You said</p>
            <p className="text-[13px] font-medium text-ink">{CONFIDENCE_WORDS[predicted].en}</p>
            <p className="mt-3 text-[11px] text-ink-4">
              {result.outcome === "got_it" ? "And it was right." : result.outcome === "not_yet" ? "And it wasn't." : "Skipped — nothing to say about this one."}
            </p>
            <p className="mx-auto mt-3 max-w-sm rounded-control bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-2">
              {reflectBack(result.calibration)}
            </p>
            <Button className="mt-4" onClick={() => {
              if (!topic || !predicted) return;
              setLog((l) => [
                ...l,
                {
                  topicId: topic.id, topicName: topic.name, predicted,
                  outcome: result.outcome,
                  // A skipped item has no verdict, and the log must not invent one.
                  calibration: result.calibration,
                  note: null,
                },
              ]);
              nextTopic();
            }}>
              {i + 1 >= topicOptions.length ? "Finish" : "Next topic"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <h2 className="text-center text-[15px] font-medium">Now try one.</h2>
          <p className="text-center text-[11px] text-ink-3">
            This is not a test. It is one small question, so your answer means something.
          </p>
          <div className="rounded-control border bg-surface p-4 text-center">
            <p className="text-[14px] leading-relaxed text-ink">{PROBES[topic?.id ?? ""]?.stem ?? `Write one thing you know about ${topicName}.`}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-ink-3">
              <Lightbulb className="size-3" /> {PROBES[topic?.id ?? ""]?.hint ?? "Anything reasonable counts."}
            </p>
          </div>
          <div className="flex gap-2">
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer…"
              className="min-w-0 flex-1 rounded-control border bg-surface px-3 py-2 text-[13px] outline-none focus:border-brand"
            />
            <Button
              onClick={() => {
                const probe = PROBES[topic?.id ?? ""];
                if (!probe) { setResult({ outcome: "skipped", calibration: null }); return; }
                const ok = probe.accepts.some((a) => a === answer.trim().toLowerCase());
                setResult(gradeReflection(predicted, ok));
              }}
            >
              Check
            </Button>
          </div>
          <div className="text-center">
            <button
              onClick={() => setResult(gradeReflection(predicted, null))}
              className="text-[11px] text-ink-4 underline underline-offset-2 hover:text-ink-2"
            >
              I would rather skip this one
            </button>
          </div>
        </>
      )}

      {saved ? <Alert tone="good" title="Saved">Noted for the teacher. No marks, no report.</Alert> : null}
    </div>
  );
}

/**
 * A handful of real probes.
 *
 * Absent a probe the child is asked to write one thing they know, which is a
 * legitimate answer and honestly labelled as un-checkable. Inventing a probe
 * for 40 topics to avoid that sentence would be worse than admitting it.
 */
const PROBES: Record<string, { stem: string; hint: string; answer: string; accepts: string[] }> = {
  ns_counting: { stem: "How many?", hint: "Count the dots: ● ● ● ●", answer: "4", accepts: ["4", "four"] },
  ns_ordering: { stem: "Which number is bigger: 7 or 9?", hint: "Count on from 7.", answer: "9", accepts: ["9", "nine"] },
  ns_comparing: { stem: "Which sign goes in the box: 34 ? 47", hint: "Bigger than, smaller than, or the same?", answer: "<", accepts: ["<", "smaller", "less than"] },
  as_within_20: { stem: "What is 8 + 5?", hint: "Count on from 8.", answer: "13", accepts: ["13", "thirteen"] },
  as_2digit: { stem: "What is 24 + 13?", hint: "Ones first, then tens.", answer: "37", accepts: ["37", "thirty seven"] },
  as_mental_strategies: { stem: "What is 7 + 9?", hint: "Make ten: 7 + 3, then 6 more.", answer: "16", accepts: ["16", "sixteen"] },
  md_tables: { stem: "What is 3 × 4?", hint: "Three groups of four.", answer: "12", accepts: ["12", "twelve"] },
  md_repeated_addition: { stem: "What is 5 + 5 + 5?", hint: "Five, added three times.", answer: "15", accepts: ["15", "fifteen"] },
  fr_concept: { stem: "If a pizza is cut into 4 equal pieces and you eat 1, what fraction is left?", hint: "One out of four.", answer: "3/4", accepts: ["3/4", "three quarters", "three fourths", ".75"] },
  ge_2d_shapes: { stem: "How many sides does a triangle have?", hint: "Go round it.", answer: "3", accepts: ["3", "three"] },
  me_length: { stem: "How many centimetres are in one metre?", hint: "A metre is this many centimetres.", answer: "100", accepts: ["100", "one hundred"] },
  me_money: { stem: "If you have ₹10 and spend ₹6, how much is left?", hint: "Take away.", answer: "4", accepts: ["4", "₹4", "4 rupees", "four"] },
};
