import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { Button, Card, CardContent } from "@/components/ui/primitives";
import { ROLE_LABEL } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

/**
 * Shown when a signed-in user reaches a page their role cannot see.
 *
 * It deliberately does not leak whether the resource exists, and it does not
 * silently bounce people to their dashboard — if a parent followed a stale
 * link from an email, they should be told what happened and given the way out.
 */
export default async function NoAccessPage() {
  const session = await getSession();

  return (
    <div className="flex min-h-full items-center justify-center p-5">
      <Card className="max-w-md">
        <CardContent className="pt-6 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-warn-soft text-warn">
            <ShieldAlert className="size-5" />
          </span>
          <h1 className="mt-3 text-base font-semibold text-ink">This page is not for your role</h1>
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            {session
              ? `You are signed in as ${ROLE_LABEL[session.role].en.toLowerCase()}. This page belongs to a different role, so nothing is shown.`
              : "You are not signed in."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button asChild size="sm"><Link href="/dashboard">Go to my dashboard</Link></Button>
            <Button asChild size="sm" variant="secondary"><Link href="/login">Sign in again</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
