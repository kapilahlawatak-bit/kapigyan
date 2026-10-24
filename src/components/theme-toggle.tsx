"use client";

import { Moon, Sun } from "lucide-react";

/**
 * Light / dark toggle.
 *
 * Three decisions worth stating, because the obvious implementations of each
 * are wrong here.
 *
 * **No React state decides which icon shows.** Reading the current theme during
 * render would make the server render one icon and the client the other, and
 * React would warn about a hydration mismatch on every page load. Instead both
 * icons are always in the DOM and CSS picks between them with `dark:`, so the
 * markup is identical on both sides of hydration. The click handler still needs
 * to know the current value — but it reads it from the DOM at click time, which
 * is always correct and never has to be guessed during render.
 *
 * **Choice is stored under a dedicated key.** There is already a `locale` cookie
 * in this app; the theme deliberately does not reuse it or `theme`, so clearing
 * site data for one reason does not silently reset the other.
 *
 * **The toggle is a real button.** The brand panel on the auth pages is white
 * text on indigo, so the control there carries its own colours rather than
 * inheriting `bg-surface` — which in dark mode is near-black and would vanish
 * against the panel.
 */
export function ThemeToggle({
  variant = "default",
  className = "",
}: {
  variant?: "default" | "onBrand";
  className?: string;
}) {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("kapigyan.theme", next);
    } catch {
      // Private mode or storage disabled. The theme still applies for this page;
      // it just will not be remembered next time.
    }
  }

  const onBrand = variant === "onBrand";

  return (
    <button
      type="button"
      onClick={toggle}
      title="Switch between light and dark"
      aria-label="Switch between light and dark"
      className={
        onBrand
          ? `inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 hover:text-white ${className}`
          : `inline-flex size-9 shrink-0 items-center justify-center rounded-control border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink ${className}`
      }
    >
      {/* Shown in light theme; hides itself once data-theme="dark" is set. */}
      <Moon className="size-4 dark:hidden" aria-hidden />
      <Sun className="hidden size-4 dark:block" aria-hidden />
    </button>
  );
}

/**
 * Set the theme on <html> and keep the browser chrome in step.
 *
 * The `<meta name="theme-color">` tags matter more than they look: they are
 * what paints the address bar on Android and the top strip on iOS. Without
 * updating them, toggling the theme leaves a white bar over a black page.
 */
export function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // Prefer a single dark declaration over two media-scoped ones, so this stays
  // in step with the attribute rather than only with the OS.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute("media");
    meta.setAttribute("content", theme === "dark" ? "#17171f" : "#ffffff");
  }
}

/**
 * Runs before first paint, inline in <head>.
 *
 * This has to be inline and synchronous. A theme applied from a React effect
 * arrives after the browser has already painted the light page, so the user
 * sees a white flash on every navigation in dark mode — which on a projector in
 * a lit classroom is genuinely unpleasant, not merely inelegant.
 *
 * Light is the default, and the OS preference is deliberately *not* consulted:
 * a school device that happens to sit in dark mode should still open on the
 * light page. Dark is used only when someone has actually chosen it, in which
 * case it is remembered and applied here before the first paint.
 */
export const themeScript = `(function(){try{var s=localStorage.getItem("kapigyan.theme");if(s!=="dark"){s="light";}document.documentElement.setAttribute("data-theme",s);var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++){m[i].removeAttribute("media");m[i].setAttribute("content",s==="dark"?"#17171f":"#ffffff");}}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;
