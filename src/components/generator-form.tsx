"use client";

/**
 * Paper generator form.
 *
 * Three modes, because a teacher comes here with three different intentions:
 * find out where the class stands (diagnostic), fix what the last test exposed
 * (gap), or just make more practice on specific topics (focused).
 *
 * The weak topics are pre-selected in gap mode, because the commonest use of
 * this screen is "make me something for what they got wrong", and making the
 * teacher find those topics again would waste the one thing this screen is for.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Brain, Check, Loader2, Sparkles, Stethoscope, Target, Trophy, Wand2 } from "lucide-react";
import { generatePaper } from "@/app/actions/papers";
import { STRANDS, topicsForClass, TOPIC_BY_ID, type CompetencyId } from "@/lib/curriculum";
import { COMP_TIERS } from "@/lib/competition";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { TERM_OPTIONS } from "@/lib/paper/labels";

type Mode = "diagnostic" | "gap" | "focused" | "competition";

/** Why the competition topic list is what it is. */
export type CompAvailability = {
  /** Topics in this class's grade that a competition paper can be built from. */
  canBuild: string[];
  /** Topics the syllabus reaches at this tier but that cannot yet be derived. */
  eligibleButUnsupported: number;
};

export function GeneratorForm({
  classes, weakTopics, aiOn, aiReason, coverage, locale, compAvailability,
}: {
  classes: { id: string; name: string; grade: number; studentCount: number }[];
  weakTopics: string[];
  aiOn: boolean;
  aiReason: string | null;
  coverage: { topicId: string; name: string; hasGenerator: boolean }[];
  locale: "en" | "hi";
  /** Measured per class and per tier — not assumed. See topicsThatCanCompete. */
  compAvailability?: Record<number, Record<number, CompAvailability>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>(weakTopics.length > 0 ? "gap" : "diagnostic");
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [grade, setGrade] = useState(classes[0]?.grade ?? 3);
  const [totalMarks, setTotalMarks] = useState(20);
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState("Term 1");
  const [selected, setSelected] = useState<string[]>(weakTopics.slice(0, 5));
  const [competency, setCompetency] = useState<Record<CompetencyId, number>>({
    basic: 0.5, competent: 0.3, proficient: 0.2,
  });
  // 0 = off. A school paper is the common case, so competition is opt-in rather
  // than the default — switching a teacher's usual "close the gaps" paper to
  // olympiad questions because a flag was left on would be worse than the flag.
  const [compTier, setCompTier] = useState(0);

  const topics = useMemo(() => topicsForClass(grade), [grade]);

  const availability = compAvailability?.[grade]?.[compTier];
  // Extracted so the dependency is a plain value. `canBuildIds.join(",")` in the
  // dependency array is a complex expression, which React's compiler lint cannot
  // statically check — and an unchecked dependency list is how a stale topic
  // list silently survives a class change.
  const canBuildKey = (compAvailability?.[grade]?.[compTier]?.canBuild ?? []).join(",");
  const compTopicOptions = useMemo(() => {
    const ids = new Set(canBuildKey ? canBuildKey.split(",") : []);
    return topics.filter((t) => ids.has(t.id));
  }, [topics, canBuildKey]);

  const switchClass = (id: string) => {
    setClassId(id);
    const c = classes.find((x) => x.id === id);
    if (c) setGrade(c.grade);
  };

  // Choosing a competition level preselects only the topics that can actually be
  // derived, because every other topic would silently produce nothing and the
  // paper would come out short.
  const pickTier = (tier: number) => {
    setCompTier(tier);
    if (tier === 0) return;
    const next = topics.filter((t) => (compAvailability?.[grade]?.[tier]?.canBuild ?? []).includes(t.id));
    setSelected(next.slice(0, 6).map((t) => t.id));
  };

  const submit = () => {
    setError(null);
    start(async () => {
      const form = new FormData();
      form.set("classId", classId);
      form.set("grade", String(grade));
      form.set("totalMarks", String(totalMarks));
      form.set("mode", mode === "focused" ? "diagnostic" : mode);
      form.set("title", title);
      form.set("term", term);
      form.set("competitionTier", String(mode === "competition" ? compTier : 0));
      selected.forEach((t) => form.append("topicIds", t));
      // The generator uses the server's own mix; we record the teacher's
      // intent so a future version can honour it without another field.
      form.set("competencyMix", JSON.stringify(competency));
      try {
        await generatePaper(form);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not build the paper");
        router.refresh();
      }
    });
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="space-y-4">
      {error ? <Alert tone="bad" title="Could not build the paper">{error}</Alert> : null}

      {/* Mode */}
      <div className="grid gap-2.5 sm:grid-cols-3">
        {[
          { id: "diagnostic" as Mode, icon: <Stethoscope className="size-4" />, title: "Diagnostic", body: "One question on every strand, to find out where the class really is." },
          { id: "gap" as Mode, icon: <Target className="size-4" />, title: "Close the gaps", body: "Weighted towards whatever the class got wrong last time.", badge: weakTopics.length > 0 ? `${weakTopics.length} weak topics found` : null },
          { id: "focused" as Mode, icon: <Sparkles className="size-4" />, title: "Chosen topics", body: "You pick the topics. Good for a specific reteach." },
          { id: "competition" as Mode, icon: <Trophy className="size-4" />, title: "Competition", body: "Each question one step past the classroom method, for a zone, state or national paper.", badge: null },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMode(m.id);
              if (m.id === "gap") setSelected(weakTopics.slice(0, 5));
              if (m.id === "competition" && compTier === 0) pickTier(1);
            }}
            className={cn(
              "card p-4 text-left transition-all hover:shadow-lift",
              mode === m.id ? "ring-2 ring-brand border-brand" : "",
            )}
          >
            <span className={cn("flex size-8 items-center justify-center rounded-[0.55rem]", mode === m.id ? "bg-brand text-white" : "bg-surface-2 text-ink-3")}>
              {m.icon}
            </span>
            <p className="mt-2.5 text-xs font-semibold text-ink">{m.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{m.body}</p>
            {m.badge ? <Badge tone="brand" size="sm" className="mt-2">{m.badge}</Badge> : null}
          </button>
        ))}
      </div>

      {/* Settings */}
      <Card>
        <CardHeader><CardTitle>Paper settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {mode === "competition" ? (
            <>
              <div className="space-y-1.5">
                <Label>Exam level</Label>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => pickTier(t)}
                      className={cn(
                        "rounded-control border px-3 py-1.5 text-[11px] font-medium transition-colors",
                        compTier === t
                          ? "border-brand bg-brand-soft text-brand-ink"
                          : "border-line bg-surface text-ink-2 hover:border-ink-4",
                      )}
                    >
                      {COMP_TIERS[t]?.label}
                      <span className="ml-1.5 opacity-70">{compAvailability?.[grade]?.[t]?.canBuild.length ?? 0}</span>
                    </button>
                  ))}
                </div>
              </div>

              {availability ? (
                availability.canBuild.length === 0 ? (
                  <Alert tone="warn" title="Nothing to build from at this level yet">
                    No topic in Class {grade} can produce a competition question at this level. The
                    questions are derived from the ordinary generators, and only some of them produce a
                    stem that can be turned into one. Choosing a lower level will give you more.
                  </Alert>
                ) : (
                  <Alert tone="info" title={`${availability.canBuild.length} topics can carry a competition question`}>
                    {availability.eligibleButUnsupported > 0 ? (
                      <>
                        The syllabus reaches {availability.canBuild.length + availability.eligibleButUnsupported}{" "}
                        topics at this level, but questions can be built from {availability.canBuild.length} of
                        them today. The rest are ordinary topics whose generators do not yet produce a stem
                        that can be turned into a competition question — so a paper on them would come out
                        short, and would say so rather than filling the gap with easier questions.
                      </>
                    ) : (
                      <>Every topic at this level can carry a competition question.</>
                    )}
                  </Alert>
                )
              ) : null}
            </>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select value={classId} onChange={(e) => switchClass(e.target.value)}>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.studentCount})</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Total marks</Label>
              <Input type="number" min={5} max={100} step={1} value={totalMarks} onChange={(e) => setTotalMarks(Number(e.target.value) || 20)} />
            </div>
            <div className="space-y-1.5">
              <Label>Term</Label>
              <Select value={term} onChange={(e) => setTerm(e.target.value)}>
                {TERM_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Title <span className="font-normal text-ink-4">(optional)</span></Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auto if left blank" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Difficulty mix
              <span className="font-normal text-ink-4"> — follows the CBSE competency bands</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {([
                ["basic", "Basic", 0.5],
                ["competent", "Competent", 0.3],
                ["proficient", "Proficient", 0.2],
              ] as [CompetencyId, string, number][]).map(([id, label, def]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCompetency((p) => ({ ...p, [id]: p[id] === def ? 0 : def }))}
                  className={cn(
                    "rounded-control border px-3 py-1.5 text-[11px] font-medium transition-colors",
                    competency[id] > 0 ? "border-brand bg-brand-soft text-brand-ink" : "border-line text-ink-4",
                  )}
                >
                  {label} {competency[id] > 0 ? `${Math.round(competency[id] * 100)}%` : "off"}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Topics */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Topics to include</CardTitle>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {mode === "diagnostic"
                ? "Leave everything unselected to spread the paper across all strands."
                : `${selected.length} selected · the more you pick, the fewer questions each gets`}
            </p>
          </div>
          {selected.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear</Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {STRANDS.map((strand) => {
    const strandTopics = compTopicOptions.filter((t) => t.strand === strand.id);
    if (strandTopics.length === 0) return null;
            return (
              <div key={strand.id}>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: strand.color }} />
                  <p className="text-[11px] font-semibold text-ink-2">{strand.name}</p>
                  <span className="text-[10px] text-ink-4">{strand.nameHi}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {strandTopics.map((t) => {
                    const on = selected.includes(t.id);
                    const gen = coverage.find((c) => c.topicId === t.id)?.hasGenerator ?? false;
                    const weak = weakTopics.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggle(t.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                          on ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-2 hover:border-ink-4",
                        )}
                      >
                        {on ? <Check className="size-3" /> : null}
                        {t.name}
                        {weak && !on ? <span className="size-1.5 rounded-full bg-bad" title="Weak in this class" /> : null}
                        {!gen ? (
                          <span className={cn("text-[9px]", on ? "text-white/60" : "text-ink-4")} title="Needs AI to generate">
                            {aiOn ? "AI" : "no-gen"}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {!aiOn ? (
        <Alert tone="info" title="Generating without AI" icon={<Brain className="size-3.5" />}>
          {aiReason} Topics marked <span className="font-semibold">no-gen</span> have no built-in
          generator, so they will be filled from the shared question bank or left out. Everything else
          is produced arithmetically and is always correct.
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[11px] text-ink-3">
          Produces about {Math.max(3, Math.round(totalMarks / 2))} questions. You can edit every one before
          using it.
        </p>
        <Button onClick={submit} disabled={pending || classes.length === 0} className="ml-auto">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          {pending ? "Building…" : "Build the paper"}
        </Button>
      </div>
    </div>
  );
}
