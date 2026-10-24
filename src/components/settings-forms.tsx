"use client";

/**
 * Server-action form wrapper.
 *
 * Settings is mostly plain forms, but a plain <form action> navigating to a
 * route that then has to re-render the whole page on every keystroke saved is
 * slower and loses scroll position. This runs the action in a transition and
 * reports failures inline instead of replacing the page with an error.
 */

import { useActionState, useTransition, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { updateProfile, changePassword, switchLocale, renameSchool, setConsent, deleteMyData, signOut } from "@/app/actions/settings";
import { Button } from "@/components/ui/primitives";

const ACTIONS = {
  updateProfile,
  changePassword,
  switchLocale,
  renameSchool,
  setConsent,
  deleteMyData,
  signOut,
} as const;

type ActionName = keyof typeof ACTIONS;

type State = { error: string | null } | null;

export function Actions({ action, children }: { action: ActionName; children: ReactNode }) {
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_prev, fd) => {
      try {
        await ACTIONS[action](fd);
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Something went wrong" };
      }
    },
    null,
  );

  return (
    <form action={formAction} className="contents">
      {children}
      {pending ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-4">
          <Loader2 className="size-3 animate-spin" /> Saving…
        </p>
      ) : null}
      {state?.error ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-bad">
          <TriangleAlert className="size-3" /> {state.error}
        </p>
      ) : null}
    </form>
  );
}
