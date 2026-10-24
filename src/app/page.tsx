import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/roles";
import { Flame, Brain, Upload, FileStack, BarChart3, HeartHandshake, Home, Languages, WifiOff } from "lucide-react";
import { Button, Badge } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/theme-toggle";
import { STRANDS } from "@/lib/curriculum";

export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect(homeFor(session.role, session.mode));

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b bg-surface/85 backdrop-blur no-print">
        <div className="mx-auto max-w-6xl px-5 h-16 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[0.65rem] bg-brand text-white shadow-soft">
            <Flame className="size-5" />
          </span>
          <div>
            <span className="block text-sm font-bold tracking-tight text-ink leading-tight">Kapigyan</span>
            <span className="block text-[10px] text-ink-3 leading-tight">विद्यासेतु</span>
          </div>
          <nav className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
              <a href="#how">How it works</a>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden border-b">
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 15% 25%, var(--color-brand) 1.5px, transparent 1.5px), radial-gradient(circle at 65% 70%, var(--color-brand) 1.5px, transparent 1.5px)",
            backgroundSize: "28px 28px",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-5 py-16 lg:py-24">
          <Badge tone="brand" size="lg">Classes 1–5 · Mathematics · NCERT &amp; NCF-FL aligned</Badge>
          <h1 className="mt-5 max-w-3xl text-4xl lg:text-5xl font-bold leading-[1.1] tracking-tight text-ink">
            Know exactly which maths a child has not understood — before the next term.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-2">
            Upload the test you already have, in Word, PDF or a photo. Kapigyan marks it, sorts every
            answer under the NCERT topic it belongs to, works out the specific idea behind each mistake,
            and hands you a lesson plan for the next class period.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/register">Create a free account</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/register">I home educate</Link>
            </Button>
            <span className="text-xs text-ink-4">No card. No installation. Works on a phone.</span>
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-bold tracking-tight text-ink">What it actually does</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: <Upload className="size-4" />, title: "Upload what you have", body: "A Word file, a PDF from the office, or a phone photo of a printed paper. It reads the questions, the marks and the answer key." },
            { icon: <Brain className="size-4" />, title: "It explains the mistake", body: "Not “wrong”, but “added 6+4 instead of multiplying”. Each wrong answer is matched to a named misconception with a way to reteach it." },
            { icon: <BarChart3 className="size-4" />, title: "A class heatmap", body: "Every child against every topic, so you can see at a glance which three children and which two topics make the whole block orange." },
            { icon: <FileStack className="size-4" />, title: "Unlimited practice", body: "Generate syllabus-matched papers and worksheets with answer keys, for any class from 1 to 5, in English or Hindi." },
            { icon: <Home className="size-4" />, title: "Built for home schooling", body: "No school code, no class roster, no timetable. A full curriculum map and printable practice for each of your children." },
            { icon: <HeartHandshake className="size-4" />, title: "Parents see the truth", body: "A plain-language progress report in the parent&apos;s own language, showing strengths, gaps and what to practise at home." },
          ].map((f) => (
            <div key={f.title} className="card p-5">
              <span className="flex size-8 items-center justify-center rounded-[0.55rem] bg-brand-soft text-brand">
                {f.icon}
              </span>
              <h3 className="mt-3 text-sm font-semibold text-ink">{f.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-ink">
            Mapped to the syllabus your child is actually following
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-3">
            Every question is classified into one of these strands, so reports speak the same language as
            the textbook and the FLN national assessment.
          </p>
          <div className="mt-6 grid gap-2.5 md:grid-cols-4">
            {STRANDS.map((s) => (
              <div key={s.id} className="rounded-control border p-3.5">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                  <p className="text-xs font-semibold text-ink">{s.name}</p>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-4">{s.nameHi}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-6 lg:grid-cols-2 items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink">It still works when the internet does not</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">
              Most Indian classrooms have unreliable connectivity. The built-in question generators
              produce correct, syllabus-aligned questions arithmetically, with no network and no API key,
              and every report prints, downloads and works offline. AI is an accelerant, never a dependency.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Badge tone="neutral" size="lg"><WifiOff className="size-3" /> Works offline</Badge>
              <Badge tone="neutral" size="lg"><Languages className="size-3" /> English + हिन्दी</Badge>
              <Badge tone="neutral" size="lg">PDF · Excel · Word · Print</Badge>
            </div>
          </div>
          <div className="card p-5">
            <p className="text-xs font-semibold text-ink-3 mb-3">Example — a wrong answer, explained</p>
            <div className="rounded-control border bg-surface-2/60 p-3.5">
              <p className="text-xs text-ink-2"><span className="font-semibold">Question:</span> 6 × 4 = ?</p>
              <p className="mt-2 text-xs text-ink-2">
                <span className="font-semibold">Aarav wrote:</span>{" "}
                <span className="rounded bg-bad-soft px-1.5 py-0.5 font-mono text-bad">10</span>
              </p>
              <div className="mt-3 border-t pt-3">
                <p className="text-[11px] font-semibold text-brand-ink">Why this is wrong</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
                  6 + 4 = 10 was written for 6 × 4. The child added the two numbers together instead of
                  multiplying them. This is the single most common error in Classes 2–3.
                </p>
                <p className="mt-2 text-[11px] font-semibold text-ink-2">How to fix it in 10 minutes</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-ink-3">
                  <li>Build 6 × 4 as an array of 4 rows of 6 and count them all.</li>
                  <li>Count 4 groups of 6, touching each group once.</li>
                  <li>Show the difference on a number line: jumps of 6, not +6 then +4.</li>
                </ol>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-8 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-ink-4">
            Kapigyan · Built for Indian primary mathematics · Data stays on your server
          </p>
          <p className="text-[11px] text-ink-4">Digital Personal Data Protection Act, 2023 compliant by design</p>
        </div>
      </footer>
    </div>
  );
}
