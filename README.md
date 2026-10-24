# Kapigyan · कपिग्यान

**Primary-school mathematics assessment for India, Classes 1–5.**

A teacher uploads a test they already have — a Word file, a PDF from the office,
or a phone photo of a printed paper. Kapigyan reads the questions and the answer
key, marks every child's sheet, sorts every answer under the NCERT topic it
belongs to, works out the *specific idea* behind each mistake, and produces a
lesson plan for the next period plus a class heatmap, printable reports, and
Excel/Word/PDF downloads.

It works with **no API key and no internet connection**. AI is an accelerant, never
a dependency.

---

## Quick start

```bash
npm install
cp .env.example .env          # set AUTH_SECRET to any long random string
npm run setup                 # prisma generate + db push + seed
npm run dev
```

`AUTH_SECRET` signs every session, so it is the whole trust boundary: anyone
who knows it can mint a token for any account, including an administrator. The
app **refuses to start in production** if it is still the `.env.example`
placeholder, and prints a loud warning in development so a fresh clone runs
without extra setup. Generate a real one with `openssl rand -base64 32`.

Then open http://localhost:3000 and sign in with one of the seeded accounts
(password for all of them is `kapigyan`, lower case):

| Email | Role | What it shows |
|---|---|---|
| `teacher@kapigyan.test` | Teacher | Two classes, 54 students, five marked papers with real misconception structure |
| `parent@kapigyan.test` | Parent | Two children, plain-language progress reports |
| `home@kapigyan.test` | Home educator | An empty home classroom, to walk through onboarding |
| `child1@kapigyan.test` | Student (Class 3) | The child's own view: stars, three things to try |

The seed is deterministic — re-running it reproduces the same demo.

### Moving to PostgreSQL

Development runs on SQLite so the project needs no Docker. The schema
deliberately avoids Prisma `enum` and `Json` types (strings plus TypeScript unions
instead), so production is a two-line change:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

```bash
npx prisma db push && npx prisma db seed
```

---

## What it does

### 1. Reads a paper you already have

Word (`.docx`), PDF, plain text, and photographs. Extraction runs server-side
(`mammoth`, `unpdf`, `fileToDataUrl`); the parsing chain is:

```
file  → extractText → parseQuestionsFromText → { AI parse → pattern parse (offline) }
photo → parseQuestionsFromImage              → { AI vision → pattern parse (offline) }
```

**Nothing is saved automatically.** Parsed questions land in an editable review
table (`src/components/upload-wizard.tsx`) where the teacher fixes a misread
number, corrects a topic, adds a working explanation, and deletes the instruction
line the scanner thought was a question. Only then is the paper created.

This is the load-bearing decision in the whole product: a wrong answer key in the
database would silently mis-mark every child on every future paper, and the teacher
would have no way to notice.

### 2. Marks the way a careful human marker would

`src/lib/answer-normaliser.ts` is the most important file in the repo. A child
writing `1 3`, `13.0`, `thirteen`, `१३` or `XIII` has given the right answer, and
the system has to agree. It handles:

- Devanagari, Kannada, Telugu and Arabic-Indic digits
- Unicode fractions (`⅔`), mixed numbers (`2 ½`), grouped digits (`1,20,450`)
- Unit words, currency symbols, trailing periods
- English and Hindi number words
- A separate whole-number comparison on fractions and decimals, so `5/10` is not
  marked equal to `5`

`src/lib/grading.ts` grades all eight question types, awards partial credit on long
answers when the *method* is right, and — critically — distinguishes **blank** from
**wrong**. A blank is recorded as `isCorrect: null`, never as a wrong answer,
because "did not attempt" and "chose the wrong idea" need different teaching.

### 3. Names the mistake, not just the error

This is the part the brief actually asked for: *"where each student lack behind and
where the student make mistakes more often and how that can be manage."*

`src/lib/intelligence/misconception-inference.ts` infers the specific belief behind
a wrong answer from three independent sources:

1. **Authored diagnosis tags** on the question (weight 0.75)
2. **`optionDiagnosis` on MCQ distractors** (weight 0.9) — the strongest signal,
   because a well-built MCQ encodes its distractors deliberately
3. **Structural analysis** — the stem is parsed into `a op b`, the response into a
   number, and ~30 pattern rules are tested. `6 × 4 = 10` is not "wrong"; it is
   `mc_mult_add_confusion` — the child added 6 and 4 instead of multiplying.

Fraction and decimal rules are separate, with guards against date- and
fraction-shaped false positives (`5/10` is a fraction, not a division answer).

About 30 misconceptions are catalogued in `src/lib/curriculum.ts`, each with the
child's belief in their own words, evidence that would confirm it, a remediation
sequence, and a teaching strategy.

### 4. Estimates mastery without a black box

```
mastery = (Σ evidence + 2 × classMean) / (weight + 2)
```

Evidence is weighted by recency (half-life 2.5 tests) and difficulty
(`0.6 + 0.2 × difficulty`). The prior pulls toward the class mean, so one lucky
answer never reads as mastery. Every component is inspectable, and
`MasteryResult` carries `confidence`, `trend` (improving / steady / declining) and
`delta`.

### 5. Decides what to teach next — and says why

`src/lib/intelligence/recommendations.ts` ranks topics by

```
priority = severity × reach × leverage × evidence
```

- **severity** — how far below the gap line
- **reach** — what fraction of the class is affected
- **leverage** — how much later work rests on it. A gap in place value costs more
  downstream than an equal gap in bar graphs.
- **evidence** — one question is a hint, four is a pattern

A multiplicative score is used deliberately: a sum would let a large but
unimportant group of children outrank a small group with a foundational gap.

Each recommendation carries a four-step lesson plan following **NCF-FL 2023's
concrete → pictorial → abstract** spine, with `{ minutes, phase, title, do, say,
materials }` per step, a same-lesson success check, and differentiation for
struggling / on-track / advanced children. The *say* field is written as a
question, because the pedagogy in the framework is not telling.

### 6. Plans the whole term, not just the next period

`/plan` and `src/lib/intelligence/teaching-plan.ts` turn the ranked gaps into a
term-long schedule — 8, 12 or 16 weeks, 3–5 periods a week, printable or PDF.

The recommendations module answers *"what do I teach next?"*, which is a
one-period question. A teacher is asked a bigger one on the first Monday of
term, and that answer needs three things a to-do list does not have:

- **Interleaving.** Ten multiplication topics back to back is blocked
  practice — children pass the next test on momentum from the last one and
  hold none of it a fortnight later. The planner keeps the priority ranking
  but never allows the same strand to dominate consecutive days.
- **Spaced retrieval.** Every taught topic returns at **+1 week and +3 weeks**,
  because forgetting starts within days and retrieval beats re-teaching. About
  30% of periods are revisits; turning them off is one click, and covers more
  ground while sticking far less.
- **Coverage of the unmeasured.** A plan built purely from test data quietly
  skips half the syllabus, because half the syllabus has never been tested.
  Unassessed topics are scored on leverage and still scheduled, flagged
  `not assessed`.

It also reports what did **not** fit, rather than promising to cover everything.

### 7. The curriculum map

`/curriculum` (teachers) and `/home/curriculum` (home educators) share one
component. Three states per topic, because "not assessed" and "assessed and
weak" are entirely different jobs: secure, needs work, and never tested. The
gaps are listed first, and the page reports FLN 2022/2025 Grade-3 domain
coverage, since a missing domain is a gap in the plan rather than in the child.

Underneath it sits the full board hierarchy — **Board → Level → Subject →
Chapter → Concept → Skill → LearningObjective** — seeded for CBSE Classes 1–5
and persisted, so a school's own structure can be loaded over the top via
`importCurriculum`. The hierarchy was in the schema and unreachable in the app;
it is now populated and wired.

### 8. Competitive exams, as an overlay

A Class 4 child sitting the Maths Olympiad is examined on the *same* ideas as
one sitting the unit test — place value, fractions, patterns. What changes is
**depth**. So each topic carries a tier rather than being duplicated into a
second syllabus, which would have had roughly 80% of its rows saying the same
thing and two reports counting the same child twice.

| Tier | Means | Topics |
|---|---|---|
| 0 | The taught syllabus and the unit test | 4 |
| 1 | Zone / district talent tests | 21 |
| 2 | State olympiads, NMTC-class papers | 29 |
| 3 | SOF NSO/IMO, SEAMO/NSEJS, NTSE-style | 14 |

Alongside the tier is the **extra step in words** — the part a textbook index
cannot give you, and the part a teacher most needs: *"extended form used to
reason about arithmetic you cannot yet do fluently"*, not "place value".

`EXAM_FAMILIES` maps SOF, NMTC, SEAMO/NSEJS and district tests to their
ceilings, so a school prepares for a *named* exam rather than an abstract tier.
Adding a family later is a constant, not a schema change. Questions carry
`isCompetition`, `style` (multi-step, reverse, estimation, pattern, logic,
representation, number theory) and `compTier`.

**This content is an interpretation, not a transcription.** Which topic reaches
which tier varies by board, school and year — so a school administrator can
correct it from the curriculum page, with a note saying why. Corrections are
stored per school (`TopicDepthOverride`) rather than by editing the bundled
column: changing that would rewrite the answer for every other school on the
server, which is a cross-tenant edit rather than a correction. A correction
made by one school is invisible to the next, and the page says which answer it
is showing — bundled, or corrected here.

A school's map can be **downloaded and handed to another school**
(`/api/depth-map`). The file contains no child data, states the school it came
from, and carries *both* sides of every correction — what that school decided
and what this build would have said — so the receiving school can disagree
rather than having to take it on trust. Importing applies the file **on top of**
what you already have rather than replacing it, because one hand-picked JSON
destroying a school's own argued-over map is not something a file should be
able to do.

### 9. Competition questions, derived rather than authored

A competition paper is built by *transforming* the ordinary generators rather
than by hand-authoring a second bank. Hand-authoring would be 68 topics × 7
styles of questions, each one a fresh chance to ship a wrong answer key — the
one failure this app refuses to risk, because a wrong key silently mis-marks
every child who ever sits the paper.

So a family of transforms derives competition questions from a base question,
and each one recomputes its own answer from the numbers it shows: **reasoning
backwards** (`y more than some number is n` → find the number), **parity of an
answer**, **estimation and bounds** (options placed a known distance apart,
never at random), **the next term of a shown sequence**, and **two-step
stories**. A second group reads a specific stem shape and rebuilds the question
around it — the successor or predecessor, a comparison as a distance, the value
of one digit, a rounded bound, a missing addend, and a shape property derived by
comparison. A transform that cannot read its base question returns nothing
rather than guessing, and one that would print its own answer is discarded.

`verify` re-grades every derived question through the app's own grader rather
than trusting the transform — several hundred of them across the bank — and the
assertion is a floor, not a target, so a regression that silently drops a whole
family cannot pass.

The generator has a fourth mode, **Competition**, with a zone / state / national
level switch. It is handed the *measured* availability per class and tier rather
than deriving it in the browser, and it says so plainly when a level has almost
nothing behind it — rather than building a short paper and leaving the teacher
to work out why.

**Coverage grew from six topics to twenty-eight, and is measured rather than
assumed.** A topic can only be derived from if its own generators produce a
readable answer — a number, a fraction, a price, a sequence, a whole-number
option — *and* a stem one of the transforms can read. That is why
`topicsThatCanCompete()` asks the generators instead of trusting the tier map,
and why the assertion in `verify` is that the number is *measured and stable*,
not that it is flattering:

| | Class 3 | Class 4 | Class 5 |
|---|---|---|---|
| Zone (tier 1) | 28 of 52 | 29 of 54 | 19 of 39 |
| State (tier 2) | 18 | 23 | 18 |
| National (tier 3) | 5 | 7 | 6 |

Two families beyond arithmetic do most of the work here. The six surgical
transforms (place value, rounding, comparison, missing operand, geometry,
successor) each read one stem shape and recompute their own answer; and a
second, *structured* group handles answers that are not whole numbers at all —
comparing two fractions with unlike denominators, turning a unit price into a
purchase with change, and continuing a sequence several places past the terms
shown. That second group exists because the whole-number reader deliberately
refuses decimals, so a fraction or a price could never reach the arithmetic
transforms.

`coverageReport()` goes further and says **why** each unreachable topic is
unreachable — "its answers are words" versus "its stems contain no operation".
Those need different work, and a school deciding what to commission next needs
the distinction.

### 10. Flags who is slipping, explainably

`assessRisk()` returns a score, a level, `reasons[]` and `actions[]`. Every
component that fired becomes a reason, so a teacher who disagrees can see exactly
which part to disagree with. A child scoring 70% can still be flagged as declining.

### 11. Reports teachers can actually use

One `ReportBundle` (`src/lib/reports/bundle.ts`) feeds every format, so the PDF, the
Excel and the printed page cannot disagree. Export is server-side — no converter
service, no data leaving the school server.

- **Excel** (`exceljs`) — 4 sheets: Summary, Student marks, Topic analysis, Question
  analysis. Real percentage number formats, frozen headers.
- **Word** (`docx`) — the register copy, with a "What to do next" section.
- **PDF** (`jspdf` + `jspdf-autotable`) — A4, repeating table headers, footer
  pagination, and a "What to teach next" page carrying the remediation steps.
- **Print** — a dedicated route with school letterhead, answer lines, and Hindi stems
  alongside English.

### 12. Home schooling

`User.mode = "HOME"`. No school code, no roster, no timetable. A home educator
adds each child as a class and everything else follows. `/home` gives a weekly
teaching plan; `/home/curriculum` is the syllabus laid out as a map with per-topic
mastery and one-click practice.

### 13. Parents and children get their own view

- **Parent** (`/parent`): a report written on the assumption the reader is not a
  mathematician and may not be reading in their first language. No mastery
  percentages without an explanation, no ranking against other children, at-risk
  framed as a conversation rather than a label. A4-printable.
- **Child** (`/me`): stars, a short "you are good at", and three things to try.
  Deliberately no percentages — a ten-year-old does not benefit from being told they
  are "at 62%".

### 14. Legal and access basics

- DPDP Act 2023: `consentAt`/`consentBy` on every user, `consentAt`/`revokedAt` on
  every parent link, and a real deletion path in Settings. Withdrawal is checked on
  **every read**, not just at link time, so a revoked parent loses access immediately
  even through a saved link.
- Parents can only read their own child; students only themselves; teachers only
  their own school **and only the classes they are assigned to**. All enforced in
  `src/lib/auth/guard.ts` at the data layer, not in the UI.
- The signed cookie proves *who* signed in; role, school and password validity are
  re-read from the database on every request, so a demotion takes effect on the next
  page load rather than when a fourteen-day token happens to expire.
- **Audit trail.** Marking a child's work is not a one-time act: a marker overrules
  the engine, a paper is re-marked because a key was wrong, a guardian withdraws
  consent. Each of those changes what the record says, and the `note` string on an
  answer row records only what somebody wrote, not what changed. `AuditLog` answers
  the question that matters later — who changed this, when, and from what to what —
  and keeps the actor's *name* after their account is deleted, because erasing your
  own data must not erase the school's record that it happened.

### 15. Light and dark

A sun/moon toggle on the sign-in and registration forms, the landing page, the app
shell and Settings. The choice is stored per device in `localStorage` and defaults to
the operating system preference.

Two details that are easy to get wrong and are worth knowing if you touch this:

- **The theme is an attribute, not a media query.** `data-theme` on `<html>` drives
  every token, and `@custom-variant dark` repoints Tailwind's `dark:` variant at that
  attribute instead of `prefers-color-scheme`. A media query alone would mean only the
  OS can choose, and a teacher on a dark-mode laptop in a bright classroom has no way
  to override it. `@theme inline` is what makes overriding a token under a selector
  actually reach the generated utilities.
- **Print is forced back to light.** Reports are paper. If the screen is in dark mode
  the printed sheet must still be black-on-white, `color-scheme` included, or form
  controls render dark on a white page.

The theme is applied by a small blocking script in `<head>` rather than from an effect,
so there is no white flash before hydration. Printing never shows the toggle.

---

## Layout

```
src/
  app/
    page.tsx                    Landing page
    actions/                    Server actions (auth, classes, papers, recheck,
                                reflection, import-marks, settings, competition,
                                attendance)
    (app)/                      Authenticated shell, role-aware nav
      dashboard/                Teacher dashboard
      today/                    What to do now, from real taught records
      plan/                     Term teaching plan (+ print, + PDF, + materials)
      gain/                     Did the teaching work? (learning gain)
      attendance/               Forwards to the register on /classes
      curriculum/               Syllabus map
      tests/                    List, upload wizard, mark, analysis, print,
                                re-check, review queue, pre-flight, OMR
      generator/                Paper generator
      insights/                 The intelligence page
      quality/                  Question quality
      question-bank/            The bank
      students/                 Roster + individual child
      classes/                  Register: roster + daily and past attendance,
                                handover note, self check, import
      reports/                  Every report, every export
      principal/                School-wide coverage and shared gaps
      export/                   Whole-school data export
      home/  parent/  me/       Home schooling, parent, child
      settings/                 Account, school, language, data rights
    api/
      depth-map/                This school's competitive map, as a shareable file
      export/school/[format]/   JSON · CSV · Excel · Word (whole school)
      papers/[id]/export/[fmt]/ PDF · Excel · Word (one paper)
      plan/[classId]/           Term plan as PDF
      practice/[studentId]/[topicId]/  Printable home practice sheet
      reports/[kind]/[id]/      Single-child and parent reports
  components/
    curriculum-map.tsx         Shared by teachers and home educators
    theme-toggle.tsx           Light/dark, plus the pre-paint script in layout
  lib/
    curriculum.ts               8 strands, ~70 topics, ~30 misconceptions
    competition.ts              Tier 0-3, exam families, the extra step per topic
    answer-normaliser.ts        Digit/script/fraction/unit normalisation
    grading.ts                  8 question types, partial credit, blank ≠ wrong
    omr-parse.ts                Pure OMR parser (no Prisma, client-safe)
    question-generation/
      competition.ts            Derives competition questions from ordinary ones
    intelligence/
      misconception-inference.ts  Three evidence sources, ~30 pattern rules
      mastery.ts                  Weighted mastery, risk, gap summary
      recommendations.ts          Priority ranking + lesson plans
      teaching-plan.ts            Interleaving, spaced retrieval, coverage
      materials.ts                Printable lesson sheets + paper-only variants
      learning-gain.ts            Did the teaching work? (uses .raw)
      attendance.ts               Absence patterns, without judgement
      retrieval.ts                Spaced retrieval schedule per child
      parent-nudge.ts              Messages home, per topic, no comparisons
      reflection.ts               Self-assessment calibration
    paper/generator.ts          Blueprint → bank → AI → built-in → competition
    reports/
      bundle.ts                   One paper → every format
      school-export.ts            Whole-school data export + manifest
    analytics/
      class.ts                   Paper analysis, heatmap, calibration
      view.ts                    Student + class view data
      plan-data.ts               Classes, mastery and gaps for map + plan
      distractors.ts             Plausible wrong answers for MCQ
      review-queue.ts            Fast marking, grouped by wrong answer
      preflight.ts               Pre-print paper check
      today.ts                   Today's lesson, from real taught records
      omr.ts                     OMR bubble sheet builder
      handover.ts                Substitute teacher note
      school-view.ts             School-wide coverage and shared gaps
      csv-marks.ts               Other-subject CSV import
      attendance-data.ts  learning-gain-data.ts  retrieval-data.ts
      nudge-data.ts              Data loaders for the pages above
    ai/                         Optional; every path has an offline fallback
    auth/                       JWT session, roles, guards
    audit.ts                    Append-only trail of consequential edits```

---

## Where the curriculum content came from

**Please verify this before using it in a real school.** The strand structure,
topic list and misconception catalogue were written from domain knowledge of the
NCERT primary mathematics syllabus, the NCF for Foundational Stage 2023, the CBSE
competency bands (basic / competent / proficient) and the FLN 2022/2025 Grade-3
domains. Live web research was not available during the build.

Concretely: the 8 strands and ~70 topics are a defensible structure, but the mapping
of specific topics to specific classes, and the FLN domain assignments, should be
checked against your state's textbook and the current NCERT/NCERT-AL curriculum
before the app is used for assessment.

---

## Optional AI

Without a key, the app uses built-in deterministic generators (~55 templates keyed
by topic, correct by construction, seeded for reproducibility), an offline regex
paper parser, and a keyword topic classifier. Everything works.

With a key, it additionally:

- reads photographs and handwriting (`AI_VISION_MODEL`)
- writes free-form questions for topics with no built-in generator
- repairs arithmetic in an AI-proposed answer key before saving

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1   # any OpenAI-compatible endpoint
AI_VISION_MODEL=gpt-4o
AI_TEXT_MODEL=gpt-4o-mini
```

DeepSeek, together.ai, Groq, Ollama and any other OpenAI-compatible endpoint work by
changing `OPENAI_BASE_URL`. Generated questions are validated before saving, and a
wrong arithmetic answer key is repaired rather than trusted.

---

## Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run db:push      # sync schema
npm run db:seed      # demo data
npm run db:studio    # browse the database
npm run db:reset     # wipe and re-seed
npm run setup        # generate + push + seed
npm run smoke        # route + auth-guard test against a running server
npm run verify       # content test: does the intelligence actually work?
npm run test:all     # typecheck + smoke + verify
```

`smoke` and `verify` both need a server already running (`npm run build && npm start`),
and point at it by argument: `npm run smoke -- http://localhost:3000`.

They answer two different questions, and the second one is the one that matters:

| Script | Question |
| --- | --- |
| `smoke` | Do the pages exist, and is each role kept out of the others' pages? |
| `verify` | Is the analysis **true** — are the misconceptions really inferred from the answers, is the ranking defensible, are the exports real files? |

`verify` is the one to read before trusting the analysis. It asserts that wrong
answers are actually diagnosed, that a blank answer is never diagnosed as a
misconception, that no topic is recommended without evidence behind it, that the
exports open as real PDF/Word/Excel documents, and that the answer key accepts
what children actually write (`१३`, `Rs 24`, `24 cm`, `1 3`, `twenty four`) and
rejects what it should. A green `smoke` with a red `verify` means the app looks
right and thinks wrong; that is the failure mode worth being able to catch.

## Known limits

Stated plainly, because the app is otherwise confident on the page:

- **Classes 1–5 only, and the curriculum is hard-coded.** The ~68 topics live in
  `src/lib/curriculum.ts` as a constant, not as configurable data. The
  *hierarchy* is now real and importable — a school can load its own
  Board → Level → Subject → Chapter → Concept → Skill → Learning Objective via
  `importCurriculum` — but the **analysis taxonomy is still the bundled one**.
  A school on a different board, or teaching Classes 6–12, can load its
  structure and then finds that its concepts point at topics this app has no
  bank for. Those are shown as uncovered rather than rejected, which is honest
  but not useful. Making the taxonomy itself configurable remains the largest
  single piece of work, and it touches the question bank, the generator, the
  heatmap and every report.
- **The competitive tier map is an interpretation, and will be wrong for some
  schools.** Which topic a zone or national paper actually turns on varies by
  board, by school and by year. A school administrator can correct it from the
  curriculum page and download the result as a file to share or keep as a
  backup, but there is no way to merge two schools' maps, and no history of who
  changed what beyond the single "why" note stored on each row.
- **The class plan cannot know what was actually taught.** The term plan is
  organised by week and day, with no calendar dates attached, so the app cannot
  infer "you have not got to Lesson 4 yet". A human ticks lessons off as they
  teach them ("Mark taught"), and the Today view, learning-gain measurement and
  the handover note all read those ticks instead of guessing. Without them, those
  pages have nothing real to say and say so.
- **The curriculum taxonomy was written from domain knowledge, not from live
  sources.** The 8 strands, ~70 topics and the FLN domain mapping are a
  structural interpretation of NCF-FL 2023 and the CBSE Class 1–5 syllabus, not
  a transcription of it. Check them against NCERT before real classroom use.
- **Diagnosis coverage on the demo data is ~78%.** That is deliberate: the
  system refuses to name a belief it cannot see a signature for, and reports the
  rest as "wrong but not diagnosed" rather than guessing. Real classrooms will
  vary with how the questions are written. The seed is deterministic, so this
  figure is reproducible rather than a one-run observation.
- **OMR does not read photographs.** It prints a bubble sheet and parses the
  bubbled responses you type or enter. Reading a photograph of a sheet would need
  a vision model, and a misread bubble silently becomes a wrong mark — so the
  app does not do it rather than doing it badly.
- **Imported other-subject marks are never analysed.** English, Hindi and EVS
  marks are stored as context and excluded from mastery, the misconception
  engine and the risk score. An English mark is no evidence about how a child
  reasons in a sum.
- **Free-form question generation and photo/handwriting reading need an AI
  key.** Everything else — generation, marking, analysis, exports — works
  offline.
- **Question difficulty calibration is not on a schedule.** The
  `calibrateQuestions` hook exists and is not yet called automatically.
- **There is no teacher leaderboard, and there will not be one.** Ranking
  teachers by their classes' scores makes the teacher of a hard class look like
  a failing teacher. The principal's view shows coverage and shared gaps
  instead. This is a choice, not an omission.

## Licence

MIT. The curriculum taxonomy is a structural interpretation and should be reviewed
against official NCERT/CBSE sources before classroom use.
