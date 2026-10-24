"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Flame, ArrowRight } from "lucide-react";
import { login, register, type ActionState } from "@/app/actions/auth";
import { Alert, Button, Card, Input, Label } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/theme-toggle";
import { useState } from "react";

/* ------------------------------------------------------------------ */
/* Shared chrome                                                       */
/* ------------------------------------------------------------------ */

export function AuthCard({
  title,
  titleHi,
  subtitle,
  children,
  footer,
}: {
  title: string;
  titleHi: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="min-h-full flex flex-col lg:flex-row">
      {/* Brand panel */}
      <div className="lg:w-[46%] bg-brand text-white p-8 lg:p-12 flex flex-col justify-between relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 70% 60%, white 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
          aria-hidden
        />
        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[0.65rem] bg-white/15 backdrop-blur">
            <Flame className="size-5" />
          </span>
          <span>
            <span className="block text-base font-bold tracking-tight">Kapigyan</span>
            <span className="block text-[11px] opacity-80">विद्यासेतु</span>
          </span>
        </Link>

        <div className="relative max-w-md my-10 lg:my-0">
          <h2 className="text-2xl lg:text-3xl font-bold leading-tight tracking-tight">
            Find out what a child has <em className="not-italic underline decoration-white/40 decoration-2 underline-offset-4">not understood</em> — in one class period.
          </h2>
          <ul className="mt-7 space-y-3 text-sm opacity-90">
            {[
              "Upload a Word file, a PDF, or a photo of the paper",
              "Every answer checked against the NCERT topic it belongs to",
              "The specific mistake behind each wrong answer, not just the mark",
              "A ready-to-teach plan for the next class period",
              "Works without internet, for home schooling too",
            ].map((line) => (
              <li key={line} className="flex gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/70" />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[11px] opacity-60">
          Aligned to NCF-FL 2023, CBSE primary syllabus and the FLN domains.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-10">
        <div className="w-full max-w-sm">
          {/*
            The light/dark control sits at the top right of the form panel, on
            the surface side rather than inside the indigo brand panel — that is
            where a reader's eye lands first, and it is the one region of this
            card that is guaranteed to be light or dark with the rest of the app.
          */}
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-ink">
                {title} · <span className="text-brand">{titleHi}</span>
              </h1>
              <p className="mt-1 text-xs text-ink-3">{subtitle}</p>
            </div>
            <ThemeToggle />
          </div>
          {children}
          <div className="mt-6 text-center text-xs text-ink-3">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && !error ? <p className="text-[11px] text-ink-4">{hint}</p> : null}
      {error ? <p className="text-[11px] text-bad">{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

export function LoginForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(login, null);
  return (
    <AuthCard
      title="Sign in"
      titleHi="साइन इन"
      subtitle="Welcome back."
      footer={
        <>
          New here?{" "}
          <Link href="/register" className="font-medium text-brand hover:underline">
            Create an account <ArrowRight className="inline size-3" />
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        {state?.error ? <Alert tone="bad">{state.error}</Alert> : null}
        <Field label="Email" error={state?.fieldErrors?.email}>
          <Input name="email" type="email" autoComplete="email" required placeholder="you@school.edu.in" />
        </Field>
        <Field label="Password" error={state?.fieldErrors?.password}>
          <Input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" />
        </Field>
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}

/* ------------------------------------------------------------------ */
/* Register                                                            */
/* ------------------------------------------------------------------ */

export function RegisterForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(register, null);
  const [mode, setMode] = useState<"SCHOOL" | "HOME">("SCHOOL");
  const [role, setRole] = useState<"TEACHER" | "PARENT" | "STUDENT">("TEACHER");

  return (
    <AuthCard
      title="Create account"
      titleHi="खाता बनाएँ"
      subtitle="Takes about a minute."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Sign in <ArrowRight className="inline size-3" />
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        {state?.error && !state.fieldErrors ? <Alert tone="bad">{state.error}</Alert> : null}

        {/* Who is this for? */}
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          {[
            { id: "SCHOOL", title: "School", sub: "Teacher or parent", emoji: "🏫" },
            { id: "HOME", title: "Home schooling", sub: "I teach my own children", emoji: "🏠" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={mode === opt.id}
              onClick={() => setMode(opt.id as "SCHOOL" | "HOME")}
              className={`rounded-control border-2 p-3 text-left transition-all ${
                mode === opt.id ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-ink-4"
              }`}
            >
              <span className="text-lg">{opt.emoji}</span>
              <p className="mt-1 text-xs font-semibold text-ink">{opt.title}</p>
              <p className="text-[11px] text-ink-3">{opt.sub}</p>
            </button>
          ))}
        </div>
        <input type="hidden" name="mode" value={mode} />

        <Field label="Full name" error={state?.fieldErrors?.name}>
          <Input name="name" required placeholder="Meera Sharma" autoComplete="name" />
        </Field>
        <Field label="Email" error={state?.fieldErrors?.email}>
          <Input name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
        </Field>
        <Field label="Password" error={state?.fieldErrors?.password} hint="At least 8 characters.">
          <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
        </Field>

        {mode === "SCHOOL" ? (
          <>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "TEACHER", label: "Teacher" },
                { id: "PARENT", label: "Parent" },
                { id: "STUDENT", label: "Student" },
              ].map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRole(r.id as "TEACHER" | "PARENT" | "STUDENT")}
                  className={`rounded-control border px-3 py-2 text-xs font-medium transition-colors ${
                    role === r.id ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink-2 hover:border-ink-4"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <input type="hidden" name="role" value={role} />

            <Field
              label="School name"
              error={state?.fieldErrors?.schoolName}
              hint="Leave blank if you have a school code from your office."
            >
              <Input name="schoolName" placeholder="Delhi Public School" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="School code" error={state?.fieldErrors?.schoolCode} hint="Optional">
                <Input name="schoolCode" placeholder="DPS12" className="uppercase" />
              </Field>
              <Field label="Class you teach" hint="1 to 5">
                <select name="childGrade" className="w-full h-10 bg-surface border border-line rounded-control px-3 text-sm">
                  {[1, 2, 3, 4, 5].map((g) => (
                    <option key={g} value={g}>Class {g}</option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input name="city" placeholder="Pune" />
              </Field>
              <Field label="State">
                <Input name="state" placeholder="Maharashtra" />
              </Field>
            </div>
          </>
        ) : (
          <>
            <Field label="Children's names" hint="Separate with commas. Leave blank to add them later.">
              <Input name="childNames" placeholder="Aarav, Diya" />
            </Field>
            <Field label="Class level" hint="We will map the practice to this syllabus.">
              <select name="childGrade" defaultValue={3} className="w-full h-10 bg-surface border border-line rounded-control px-3 text-sm">
                {[1, 2, 3, 4, 5].map((g) => (
                  <option key={g} value={g}>Class {g}</option>
                ))}
              </select>
            </Field>
            <Alert tone="info" title="No school code needed">
              You will get a full syllabus map for Classes 1 to 5, unlimited practice papers, printable
              worksheets with answer keys, and a termly progress report for each child.
            </Alert>
          </>
        )}

        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "Creating your account…" : "Create account"}
        </Button>

        <p className="text-[11px] text-ink-4 leading-relaxed">
          By continuing you agree that this service processes children&apos;s assessment data on behalf of
          the school or parent responsible for it, as required by the Digital Personal Data Protection
          Act, 2023. You can delete all data at any time from Settings.
        </p>
      </form>
    </AuthCard>
  );
}
