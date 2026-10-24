"use client";

/**
 * Application shell.
 *
 * One sidebar for teachers and home educators, a different shell for students
 * and parents. A school runs on shared, slow, low-end machines, so the sidebar
 * collapses to a bottom bar on small screens rather than hiding navigation
 * behind a hamburger — a teacher marking papers on a phone should not have to
 * hunt for the same three buttons every time.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BarChart3, BookOpen, Brain, Building2, CalendarCheck, CalendarDays, ChevronDown, DatabaseBackup, FileStack, Flame, GraduationCap, Home, LayoutDashboard,
  LogOut, Map, Menu, MessageCircleHeart, Settings, Sparkles, Sun, Target, TrendingUp, Upload, X, HeartHandshake, FlaskConical,
} from "lucide-react";
import { cn, avatarColor } from "@/lib/utils";
import { Avatar, Badge, Button } from "@/components/ui/primitives";
import { ROLE_LABEL, MODE_LABEL, type Role, type UserMode } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";

type NavItem = { href: string; label: string; labelHi: string; icon: React.ElementType; hint?: string };

/**
 * Every href here is a real route. When a screen was folded into another
 * (Analytics became Insights) the nav was updated rather than leaving a dead
 * link — a sidebar that 404s teaches people to distrust the whole app.
 *
 * The sidebar used to be a flat list of eighteen destinations, which is not a
 * menu so much as an inventory: it told a teacher everything the app could do
 * and therefore which single thing to do this morning. Grouping keeps every
 * route reachable while showing seven rows instead of eighteen. A group opens
 * itself when you are already inside it, so nothing that matters is ever two
 * clicks away from the page you are on.
 */
type NavEntry =
  | { kind: "link"; item: NavItem }
  | { kind: "group"; id: string; label: string; labelHi: string; icon: React.ElementType; items: NavItem[] };

const TEACHER_NAV: NavEntry[] = [
  { kind: "link", item: { href: "/dashboard", label: "Dashboard", labelHi: "डैशबोर्ड", icon: LayoutDashboard } },
  { kind: "link", item: { href: "/today", label: "Today", labelHi: "आज", icon: Sun } },
  { kind: "link", item: { href: "/classes", label: "Register", labelHi: "रजिस्टर", icon: CalendarCheck } },
  {
    kind: "group", id: "plan", label: "Plan", labelHi: "योजना", icon: CalendarDays,
    items: [
      { href: "/plan", label: "Term Plan", labelHi: "शिक्षण योजना", icon: CalendarDays, hint: "Term" },
      { href: "/curriculum", label: "Curriculum Map", labelHi: "पाठ्यक्रम", icon: Map },
    ],
  },
  {
    kind: "group", id: "assess", label: "Assess", labelHi: "मूल्यांकन", icon: FileStack,
    items: [
      { href: "/tests", label: "Tests & Papers", labelHi: "परीक्षाएँ", icon: FileStack },
      { href: "/tests/new", label: "Create / Upload", labelHi: "नया बनाएँ", icon: Upload },
      { href: "/generator", label: "Paper Generator", labelHi: "पेपर जनरेटर", icon: Sparkles },
      { href: "/question-bank", label: "Question Bank", labelHi: "प्रश्न बैंक", icon: BookOpen },
      { href: "/quality", label: "Question Quality", labelHi: "प्रश्न गुणवत्ता", icon: Target },
    ],
  },
  {
    kind: "group", id: "understand", label: "Understand", labelHi: "समझें", icon: Brain,
    items: [
      { href: "/insights", label: "Teaching Insights", labelHi: "शिक्षण अंतर्दृष्टि", icon: Brain, hint: "AI" },
      { href: "/gain", label: "Did it work?", labelHi: "क्या फलदायी", icon: TrendingUp },
      { href: "/principal", label: "School Overview", labelHi: "विद्यालय अवलोकन", icon: Building2 },
    ],
  },
  {
    kind: "group", id: "data", label: "Data", labelHi: "डेटा", icon: DatabaseBackup,
    items: [
      { href: "/reports", label: "Reports", labelHi: "रिपोर्ट", icon: GraduationCap },
      { href: "/export", label: "Data Export", labelHi: "डेटा निर्यात", icon: DatabaseBackup },
      { href: "/classes/nudge", label: "Messages Home", labelHi: "घर पर संदेश", icon: MessageCircleHeart },
    ],
  },
];

const HOME_NAV: NavEntry[] = [
  { kind: "link", item: { href: "/home", label: "Home", labelHi: "होम", icon: Home } },
  {
    kind: "group", id: "home-learn", label: "Learning", labelHi: "पढ़ाई", icon: BookOpen,
    items: [
      { href: "/home/progress", label: "Progress", labelHi: "प्रगति", icon: BarChart3 },
      { href: "/home/curriculum", label: "Curriculum Map", labelHi: "पाठ्यक्रम", icon: Map },
      { href: "/insights", label: "What to Teach Next", labelHi: "अगला पाठ", icon: Brain, hint: "AI" },
    ],
  },
  {
    kind: "group", id: "home-work", label: "Work", labelHi: "काम", icon: FileStack,
    items: [
      { href: "/tests/new", label: "Create / Upload", labelHi: "नया बनाएँ", icon: Upload },
      { href: "/generator", label: "Practice Sets", labelHi: "अभ्यास", icon: Sparkles },
      { href: "/plan", label: "Term Plan", labelHi: "शिक्षण योजना", icon: CalendarDays },
      { href: "/gain", label: "Did it work?", labelHi: "क्या फलदायी", icon: TrendingUp },
    ],
  },
];

const STUDENT_NAV: NavEntry[] = [
  { kind: "link", item: { href: "/me", label: "My Progress", labelHi: "मेरी प्रगति", icon: BarChart3 } },
  { kind: "link", item: { href: "/me/tests", label: "My Tests", labelHi: "मेरी परीक्षाएँ", icon: FileStack } },
  { kind: "link", item: { href: "/me/practice", label: "Practice", labelHi: "अभ्यास", icon: FlaskConical } },
];

const PARENT_NAV: NavEntry[] = [
  { kind: "link", item: { href: "/parent", label: "My Children", labelHi: "मेरे बच्चे", icon: HeartHandshake } },
  { kind: "link", item: { href: "/parent/practice", label: "Practice at Home", labelHi: "घर पर अभ्यास", icon: FlaskConical } },
];

export function navFor(role: Role, mode: UserMode): NavEntry[] {
  if (role === "STUDENT") return STUDENT_NAV;
  if (role === "PARENT") return PARENT_NAV;
  if (mode === "HOME") return HOME_NAV;
  return TEACHER_NAV;
}

export function AppShell({
  user,
  role,
  mode,
  locale,
  children,
}: {
  user: { name: string; email: string };
  role: Role;
  mode: UserMode;
  locale: Locale;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const entries = navFor(role, mode);

  function isActive(href: string): boolean {
    return pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  }

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-40 flex items-center gap-2 border-b bg-surface/95 backdrop-blur px-3 h-14 no-print">
        <Button variant="ghost" size="iconSm" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </Button>
        <Brand compact />
        <div className="ml-auto flex items-center gap-2">
          <LocaleToggle locale={locale} />
          <ThemeToggle />
        </div>
      </div>

      {/* Sidebar */}
      <aside
        data-app-shell
        className={cn(
          "no-print shrink-0 border-r bg-surface lg:sticky lg:top-0 lg:h-screen lg:w-60 xl:w-64",
          "flex flex-col",
          open ? "fixed inset-x-0 top-14 bottom-0 z-40 overflow-y-auto scrollbar-thin" : "hidden lg:flex",
        )}
      >
        <div className="hidden lg:flex items-center gap-2.5 px-5 h-16 border-b">
          <Brand />
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {entries.map((entry) => {
            if (entry.kind === "link") {
              return (
                <NavLink key={entry.item.href} item={entry.item} active={isActive(entry.item.href)} locale={locale} onNavigate={() => setOpen(false)} />
              );
            }
            const groupActive = entry.items.some((c) => isActive(c.href));
            const isOpen = expanded[entry.id] ?? groupActive;
            const GroupIcon = entry.icon;
            return (
              <div key={entry.id}>
                <button
                  type="button"
                  onClick={() => setExpanded((prev) => ({ ...prev, [entry.id]: !isOpen }))}
                  aria-expanded={isOpen}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-2.5 py-2 rounded-control text-[13px] font-medium transition-colors",
                    groupActive ? "text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  <GroupIcon className={cn("size-4 shrink-0", groupActive ? "text-brand" : "text-ink-4")} />
                  <span className="truncate">{locale === "hi" ? entry.labelHi : entry.label}</span>
                  <ChevronDown className={cn("ml-auto size-3.5 shrink-0 text-ink-4 transition-transform", isOpen && "rotate-180")} />
                </button>
                {isOpen ? (
                  <div className="mt-0.5 ml-3 space-y-0.5 border-l border-line pl-2">
                    {entry.items.map((c) => (
                      <NavLink key={c.href} item={c} active={isActive(c.href)} nested locale={locale} onNavigate={() => setOpen(false)} />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>

        <div className="p-3 border-t space-y-2">
          <div className="flex items-center gap-2 px-2.5">
            <LocaleToggle locale={locale} />
            <ThemeToggle className="ml-auto" />
          </div>
          {/* Settings stays in the footer for every role. Removing it from the
              nav list to shorten the sidebar must not remove access: the page
              guards on a session only, and it is where language, theme and
              data rights live. */}
          <Link href="/settings" className="flex items-center gap-2.5 px-2.5 py-2 rounded-control text-[13px] text-ink-2 hover:bg-surface-2">
            <Settings className="size-4 text-ink-4" /> Settings
          </Link>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-control text-[13px] text-ink-2 hover:bg-surface-2"
            >
              <LogOut className="size-4 text-ink-4" /> Sign out
            </button>
          </form>
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-control bg-surface-2">
            <Avatar name={user.name} size={30} color={avatarColor(user.name)} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-ink truncate">{user.name}</p>
              <p className="text-[10px] text-ink-3 truncate">
                {mode === "HOME" ? MODE_LABEL.HOME[locale] : ROLE_LABEL[role][locale]}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 pb-20 lg:pb-0">{children}</main>
    </div>
  );
}

function NavLink({
  item, active, nested = false, locale, onNavigate,
}: {
  item: NavItem;
  active: boolean;
  nested?: boolean;
  locale: Locale;
  onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "group flex items-center gap-2.5 px-2.5 py-2 rounded-control font-medium transition-colors",
        nested ? "text-[12px]" : "text-[13px]",
        active ? "bg-brand-soft text-brand-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className={cn("shrink-0", nested ? "size-3.5" : "size-4", active ? "text-brand" : "text-ink-4 group-hover:text-ink-3")} />
      <span className="truncate">{locale === "hi" ? item.labelHi : item.label}</span>
      {item.hint ? <Badge tone="brand" size="sm" className="ml-auto">{item.hint}</Badge> : null}
    </Link>
  );
}

function Brand({ compact: isCompact }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 min-w-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[0.6rem] bg-brand text-white shadow-soft">
        <Flame className="size-4" />
      </span>
      {!isCompact ? (
        <span className="min-w-0">
          <span className="block text-sm font-bold tracking-tight text-ink leading-tight">Kapigyan</span>
          <span className="block text-[10px] text-ink-3 leading-tight">विद्यासेतु</span>
        </span>
      ) : null}
    </Link>
  );
}

function LocaleToggle({ locale }: { locale: Locale }) {
  return (
    <form action="/api/locale" method="post">
      <input type="hidden" name="locale" value={locale === "en" ? "hi" : "en"} />
      <Button type="submit" variant="secondary" size="sm">
        {locale === "en" ? "हिंदी" : "English"}
      </Button>
    </form>
  );
}

export function PageHeader({
  title,
  titleHi,
  description,
  descriptionHi,
  locale,
  actions,
}: {
  title: string;
  titleHi?: string;
  description?: string;
  descriptionHi?: string;
  locale: Locale;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-surface px-5 py-4">
      <div className="min-w-0">
        <h1 className="text-lg font-bold tracking-tight text-ink">
          {locale === "hi" && titleHi ? titleHi : title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-xs text-ink-3 max-w-2xl">
            {locale === "hi" && descriptionHi ? descriptionHi : description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
