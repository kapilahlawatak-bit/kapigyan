"use client";

import { useMemo, useState } from "react";
import { Check, Clock, Save, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ATTENDANCE_LABEL, ATTENDANCE_STATUSES, type AttendanceStatus } from "@/lib/intelligence/attendance";

export type RosterChild = {
  id: string;
  name: string;
  rollNo: number | null;
  status: AttendanceStatus;
};

export function Register({
  classId,
  date,
  roster,
  canSave,
}: {
  classId: string;
  date: string;
  roster: RosterChild[];
  canSave: boolean;
}) {
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(
    () => Object.fromEntries(roster.map((c) => [c.id, c.status])),
  );
  const [saved, setSaved] = useState(false);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of Object.values(statuses)) out[s] = (out[s] ?? 0) + 1;
    return out;
  }, [statuses]);

  const away = Object.entries(statuses).filter(([, s]) => s === "absent" || s === "late").length;
  const allPresent = away === 0;

  function set(childId: string, status: AttendanceStatus) {
    setSaved(false);
    setStatuses((prev) => ({ ...prev, [childId]: status }));
  }

  return (
    <form action={async (fd) => { await save(fd); setSaved(true); }} className="space-y-4">
      <input type="hidden" name="classId" value={classId} />
      <input type="hidden" name="date" value={date} />

      {/* Bulk actions for the common case: everyone is here. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button" size="sm" variant="secondary"
          onClick={() => { setSaved(false); setStatuses(Object.fromEntries(roster.map((c) => [c.id, "present"]))); }}
        >
          <Check className="size-3" /> All present
        </Button>
        <span className="text-[11px] text-ink-3">
          {roster.length} on the roll · {away === 0 ? "none marked away" : `${away} away`}
          {counts.excused ? ` · ${counts.excused} excused` : ""}
        </span>
      </div>

      {allPresent && roster.length > 0 ? (
        <p className="rounded-control border border-good/30 bg-good-soft/30 px-3 py-2 text-[11px] text-ink-2">
          Everyone is marked present. If that is right, press Save and move on — this takes a few seconds.
        </p>
      ) : null}

      <ul className="divide-y">
        {roster.map((c) => (
          <li key={c.id} className="flex items-center gap-3 py-1.5">
            <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-ink-4">
              {c.rollNo ?? "—"}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{c.name}</span>
            <div className="flex shrink-0 gap-1">
              {ATTENDANCE_STATUSES.map((s) => {
                const Icon = s === "present" ? Check : s === "late" ? Clock : s === "absent" ? X : UserX;
                const on = statuses[c.id] === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set(c.id, s)}
                    aria-pressed={on}
                    className={`rounded-control border px-2 py-1 text-[11px] ${
                      on
                        ? s === "present"
                          ? "border-good bg-good-soft text-good"
                          : s === "late"
                            ? "border-warn bg-warn-soft text-warn"
                            : s === "absent"
                              ? "border-bad bg-bad-soft text-bad"
                              : "border-line bg-surface-2 text-ink-2"
                        : "border-line text-ink-4 hover:text-ink-2"
                    }`}
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{ATTENDANCE_LABEL[s].en}</span>
                  </button>
                );
              })}
            </div>
            <input type="hidden" name={`status:${c.id}`} value={statuses[c.id] ?? "present"} />
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!canSave}>
          <Save className="size-3" /> Save register
        </Button>
        {saved ? <span className="text-[11px] text-good">Saved.</span> : null}
      </div>
    </form>
  );
}

async function save(fd: FormData) {
  const { saveAttendance } = await import("@/app/actions/attendance");
  await saveAttendance(fd);
}
