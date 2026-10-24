"use client";

/**
 * The upload-and-review flow.
 *
 * A teacher uploads a paper and, three minutes later, has a working digital
 * test with every question tagged to its topic. The critical design decision
 * is that **nothing is ever saved automatically from the upload**. Parsing a
 * messy photo or a Word file is fallible, and a wrong answer key in the
 * database would silently mis-mark every child afterwards. So the parsed
 * questions land in an editable review table, and the teacher confirms.
 *
 * The review table is the product here, not a formality: it is where a teacher
 * fixes a misread number, corrects a topic, adds an explanation, and deletes
 * the instruction line the scanner thought was a question.
 */

import { useActionState, useCallback, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Plus, Sparkles, Trash2,
  Upload, Wand2, X, FileText,
} from "lucide-react";
import { parseUpload, type ParseState } from "@/app/actions/papers";
import { TOPICS, QUESTION_TYPES, topicsForClass, type CompetencyId } from "@/lib/curriculum";
import { isAiEnabled, aiDisabledReason } from "@/lib/ai/client";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Textarea,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { TERM_OPTIONS } from "@/lib/paper/labels";

type ClassOption = { id: string; name: string; grade: number; studentCount: number };

type Draft = {
  stem: string;
  type: string;
  options: string[];
  answerKey: string;
  accepted: string[];
  marks: number;
  topicId: string | null;
  competency: CompetencyId;
  difficulty: number;
  explanation: string;
};

export function UploadWizard({
  classes,
  defaultClassId,
  locale,
}: {
  classes: ClassOption[];
  defaultClassId: string | null;
  locale: "en" | "hi";
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [classId, setClassId] = useState(defaultClassId ?? classes[0]?.id ?? "");
  const selectedClass = classes.find((c) => c.id === classId);
  const grade = selectedClass?.grade ?? 3;

  const [parseState, formAction, parsing] = useActionState<ParseState, FormData>(parseUpload, { status: "idle" });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState<string>("Term 1");
  const [saving, startSaving] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const aiOn = isAiEnabled();
  const aiReason = aiDisabledReason();

  // Move parsed questions into the editable draft list.
  const incoming = parseState.status === "done" ? parseState.result?.questions : undefined;
  const lastCount = useMemo(() => (incoming ? JSON.stringify(incoming).length : 0), [incoming]);

  const adopt = useCallback(() => {
    if (!incoming) return;
    setDrafts(
      incoming.map((q) => ({
        stem: q.stem,
        type: q.type,
        options: q.options ?? [],
        answerKey: q.answerKey,
        accepted: q.accepted ?? [],
        marks: q.marks,
        topicId: q.topicId,
        competency: (q.competency as CompetencyId) ?? "basic",
        difficulty: q.difficulty ?? 2,
        explanation: q.explanation ?? "",
      })),
    );
    setFileName(parseState.fileName ?? null);
    setTitle((prev) => prev || (parseState.fileName ? parseState.fileName.replace(/\.[^.]+$/, "") : "Untitled test"));
    setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCount]);

  /* ---------------------------------------------------------------- */

  const totalMarks = drafts.reduce((a, d) => a + (Number(d.marks) || 0), 0);
  const missingTopic = drafts.filter((d) => !d.topicId).length;
  const missingAnswer = drafts.filter((d) => !d.answerKey.trim()).length;

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  const remove = (i: number) => setDrafts((prev) => prev.filter((_, idx) => idx !== i));

  const move = (i: number, dir: -1 | 1) =>
    setDrafts((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });

  const blank = (): Draft => ({
    stem: "", type: "short", options: [], answerKey: "", accepted: [],
    marks: 1, topicId: null, competency: "basic", difficulty: 2, explanation: "",
  });

  const submit = () => {
    setSaveError(null);
    startSaving(async () => {
      try {
        const { createPaperFromReview } = await import("@/app/actions/papers");
        const form = new FormData();
        form.set("classId", classId);
        form.set("title", title || "Untitled test");
        form.set("term", term);
        form.set("grade", String(grade));
        form.set("sourceMeta", JSON.stringify({ fileName, method: parseState.result?.method }));
        form.set(
          "payload",
          JSON.stringify({
            classId: classId || null,
            title: title || "Untitled test",
            term,
            grade,
            sourceMeta: JSON.stringify({ fileName, method: parseState.result?.method }),
            questions: drafts.map((d) => ({
              stem: d.stem,
              type: d.type,
              options: d.options,
              answerKey: d.answerKey,
              accepted: d.accepted,
              marks: Number(d.marks) || 1,
              topicId: d.topicId,
              competency: d.competency,
              difficulty: d.difficulty,
              explanation: d.explanation,
            })),
          }),
        );
        await createPaperFromReview(form);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "Could not save the paper");
      }
    });
  };

  const availableTopics = topicsForClass(grade);

  /* ---------------------------------------------------------------- */

  return (
    <div className="p-5 max-w-6xl w-full space-y-4">
      {/* Stepper */}
      <div className="flex items-center gap-2">
        {[
          { n: 1, label: locale === "hi" ? "फ़ाइल चुनें" : "Choose a file" },
          { n: 2, label: locale === "hi" ? "जाँचें" : "Check the questions" },
          { n: 3, label: locale === "hi" ? "समाप्त" : "Finish" },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 ? <ChevronRight className="size-3.5 text-ink-4" /> : null}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium",
                step === s.n ? "bg-brand text-white" : step > s.n ? "bg-good-soft text-good" : "bg-surface-2 text-ink-4",
              )}
            >
              {step > s.n ? <Check className="size-3" /> : <span className="tabular-nums">{s.n}</span>}
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {step === 1 ? (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Which class is this test for?</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  This decides which topics the questions can be matched against.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {classes.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {classes.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setClassId(c.id)}
                      className={cn(
                        "rounded-control border-2 px-3.5 py-2 text-left transition-all",
                        classId === c.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-ink-4",
                      )}
                    >
                      <p className="text-xs font-semibold text-ink">{c.name}</p>
                      <p className="text-[10px] text-ink-3">Class {c.grade} · {c.studentCount} students</p>
                    </button>
                  ))}
                </div>
              ) : (
                <Alert tone="warn" title="No classes yet">
                  Create a class and add your students first.
                </Alert>
              )}

              <form action={formAction} className="space-y-3">
                <input type="hidden" name="grade" value={grade} />

                <label
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed px-6 py-10 text-center transition-colors",
                    parsing ? "border-brand bg-brand-soft/50" : "border-line hover:border-brand hover:bg-brand-soft/30",
                  )}
                >
                  <input
                    type="file"
                    name="file"
                    className="sr-only"
                    accept=".doc,.docx,.pdf,.txt,.png,.jpg,.jpeg,.webp,image/*"
                    disabled={parsing}
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0];
                      if (f) setTitle((prev) => prev || f.name.replace(/\.[^.]+$/, ""));
                    }}
                  />
                  {parsing ? (
                    <>
                      <Loader2 className="size-6 animate-spin text-brand" />
                      <p className="text-sm font-medium text-ink">Reading the paper…</p>
                      <p className="text-[11px] text-ink-3">A photo of a printed paper takes a little longer.</p>
                    </>
                  ) : (
                    <>
                      <Upload className="size-6 text-brand" />
                      <p className="text-sm font-medium text-ink">Drop a file here, or click to choose</p>
                      <p className="text-[11px] text-ink-3">
                        Word (.docx) · PDF · photo (JPG/PNG) · plain text
                      </p>
                    </>
                  )}
                </label>
                {parsing ? <div className="h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full w-1/3 animate-pulse bg-brand" /></div> : null}
              </form>

              {parseState.status === "error" ? (
                <Alert tone="bad" title="That did not work">{parseState.message}</Alert>
              ) : null}

              {!aiOn ? (
                <Alert tone="info" title="Reading photos needs the AI service">
                  {aiReason} Word, PDF and text files still work, and the built-in generator can create
                  a full paper offline.
                </Alert>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button variant="ghost" size="sm" onClick={() => { setDrafts([blank()]); setStep(2); setTitle(""); }}>
                  <FileText className="size-3.5" /> {locale === "hi" ? "स्वयं लिखें" : "Type the questions instead"}
                </Button>
                <Button asChild variant="secondary" size="sm" className="ml-auto">
                  <a href="/generator"><Wand2 className="size-3.5" /> {locale === "hi" ? "सिलेबस से बनाएँ" : "Generate from the syllabus"}</a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {parseState.status === "done" ? (
            <Card className="border-good/30">
              <CardContent className="pt-4 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {parseState.result?.questions.length ?? 0} questions found
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">{parseState.message}</p>
                </div>
                <Button size="sm" onClick={adopt}>Review them <ChevronRight className="size-3.5" /></Button>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Check each question</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  The answer key decides every mark, so please read it once. Fix anything the reader got wrong.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={missingAnswer > 0 ? "bad" : "good"} size="lg">
                  {missingAnswer > 0 ? `${missingAnswer} without an answer` : "All answers present"}
                </Badge>
                <Badge tone={missingTopic > 0 ? "warn" : "good"} size="lg">
                  {missingTopic > 0 ? `${missingTopic} without a topic` : "All topics set"}
                </Badge>
                <Badge tone="neutral" size="lg">{totalMarks} marks</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {saveError ? <Alert tone="bad">{saveError}</Alert> : null}
              {parseState.status === "done" && (parseState.result?.notes.length ?? 0) > 0 ? (
                <Alert tone="warn" title="Worth checking">
                  {parseState.result!.notes.join(" ")}
                </Alert>
              ) : null}

              {drafts.length === 0 ? (
                <Alert tone="info">No questions yet. Add one below.</Alert>
              ) : null}

              {drafts.map((d, i) => (
                <QuestionEditor
                  key={i}
                  index={i}
                  draft={d}
                  topics={availableTopics}
                  onChange={(patch) => update(i, patch)}
                  onRemove={() => remove(i)}
                  onMove={(dir) => move(i, dir)}
                  isFirst={i === 0}
                  isLast={i === drafts.length - 1}
                />
              ))}

              <Button variant="secondary" size="sm" onClick={() => setDrafts((p) => [...p, blank()])}>
                <Plus className="size-3.5" /> Add a question
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              <ChevronLeft className="size-3.5" /> Back
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => window.print()}>
                Print this list
              </Button>
              <Button
                size="sm"
                onClick={submit}
                disabled={saving || drafts.length === 0 || missingAnswer > 0}
              >
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {saving ? "Saving…" : "Create the test"}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One editable question                                               */
/* ------------------------------------------------------------------ */

function QuestionEditor({
  index, draft, topics, onChange, onRemove, onMove, isFirst, isLast,
}: {
  index: number;
  draft: Draft;
  topics: typeof TOPICS;
  onChange: (patch: Partial<Draft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(index === 0);
  const typeMeta = QUESTION_TYPES.find((t) => t.id === draft.type);
  const noAnswer = !draft.answerKey.trim();

  return (
    <div className={cn("rounded-control border", noAnswer ? "border-bad/40 bg-bad-soft/20" : "bg-surface")}>
      <div className="flex items-center gap-2 p-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-[0.4rem] bg-surface-2 text-[11px] font-bold text-ink-3">
          {index + 1}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <p className={cn("truncate text-xs font-medium", noAnswer ? "text-bad" : "text-ink")}>
            {draft.stem || <span className="italic text-ink-4">Empty question — click to fill it in</span>}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral" size="sm">{typeMeta?.name ?? draft.type}</Badge>
            <Badge tone="outline" size="sm">{draft.marks}m</Badge>
            {draft.topicId ? (
              <Badge tone="brand" size="sm">{topics.find((t) => t.id === draft.topicId)?.name ?? draft.topicId}</Badge>
            ) : (
              <Badge tone="warn" size="sm">No topic</Badge>
            )}
            {noAnswer ? <Badge tone="bad" size="sm">No answer</Badge> : null}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="iconSm" onClick={() => onMove(-1)} disabled={isFirst} aria-label="Move up">
            <ChevronLeft className="size-3.5 rotate-90" />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={() => onMove(1)} disabled={isLast} aria-label="Move down">
            <ChevronRight className="size-3.5 -rotate-90" />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={onRemove} aria-label="Remove question">
            <Trash2 className="size-3.5 text-bad" />
          </Button>
        </div>
      </div>

      {open ? (
        <div className="space-y-3 border-t p-3">
          <div className="space-y-1.5">
            <Label>Question</Label>
            <Textarea
              value={draft.stem}
              onChange={(e) => onChange({ stem: e.target.value })}
              placeholder="e.g. 6 × 4 = ?"
              rows={2}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={draft.type} onChange={(e) => onChange({ type: e.target.value, marks: Number(QUESTION_TYPES.find((t) => t.id === e.target.value)?.marks ?? 1) })}>
                {QUESTION_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Topic</Label>
              <Select value={draft.topicId ?? ""} onChange={(e) => onChange({ topicId: e.target.value || null })}>
                <option value="">Choose a topic…</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Marks</Label>
              <Input
                type="number"
                min={0}
                step={0.5}
                value={draft.marks}
                onChange={(e) => onChange({ marks: Number(e.target.value) })}
              />
            </div>
          </div>

          {draft.type === "mcq" ? (
            <div className="space-y-1.5">
              <Label>Options — one per line, and make sure the right one is marked</Label>
              <Textarea
                rows={4}
                value={draft.options.join("\n")}
                onChange={(e) => onChange({ options: e.target.value.split("\n").filter((l) => l.trim()) })}
                placeholder={"A. 10\nB. 18\nC. 24\nD. 26"}
              />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>
                Correct answer{" "}
                {draft.type === "mcq" ? <span className="font-normal text-ink-4">(just the letter)</span> : null}
              </Label>
              <Input
                value={draft.answerKey}
                onChange={(e) => onChange({ answerKey: e.target.value })}
                placeholder={draft.type === "mcq" ? "C" : "24"}
                className={noAnswer ? "border-bad" : ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Also accept <span className="font-normal text-ink-4">(comma separated)</span></Label>
              <Input
                value={draft.accepted.join(", ")}
                onChange={(e) => onChange({ accepted: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder="twenty four, XXIV"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Level</Label>
              <Select value={draft.competency} onChange={(e) => onChange({ competency: e.target.value as CompetencyId })}>
                <option value="basic">Basic — one step</option>
                <option value="competent">Competent — two steps</option>
                <option value="proficient">Proficient — reasoning</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Difficulty (1 easy → 5 hard)</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={draft.difficulty}
                onChange={(e) => onChange({ difficulty: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              How to solve it <span className="font-normal text-ink-4">— shown to students after the test</span>
            </Label>
            <Textarea
              rows={2}
              value={draft.explanation}
              onChange={(e) => onChange({ explanation: e.target.value })}
              placeholder="Draw an array of 4 rows of 6. Count them all: 24."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
