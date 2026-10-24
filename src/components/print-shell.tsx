"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/**
 * Print helpers.
 *
 * The print button is hidden by the print stylesheet, and the header carries
 * the school name because a sheet that comes out of the printer without
 * identifying its school is useless to whoever files it.
 */
export function PrintButton() {
  useEffect(() => {
    // Nothing to do on mount — but opening with a query flag is a common
    // shortcut ("print this for me"), so honour it.
    if (new URLSearchParams(window.location.search).get("print") === "1") {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, []);

  return (
    <div className="no-print mb-5 flex justify-end">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-9 items-center gap-2 rounded-control bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-ink transition-colors"
      >
        <Printer className="size-3.5" /> Print
      </button>
    </div>
  );
}

export function PrintHeader({
  school, lines, title, meta,
}: {
  school: string;
  lines?: string;
  title: string;
  meta: string;
}) {
  return (
    <header className="mb-5 border-b-2 border-black pb-3 text-center">
      <p className="text-[15px] font-bold tracking-wide uppercase">{school}</p>
      {lines ? <p className="text-[11px] text-black/60">{lines}</p> : null}
      <h1 className="mt-2 text-[19px] font-bold">{title}</h1>
      <p className="mt-1 text-[11px] text-black/65">{meta}</p>
    </header>
  );
}
