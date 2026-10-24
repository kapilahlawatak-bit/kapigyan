import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";
import type { Role, UserMode } from "@/lib/auth/roles";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  if (!session) redirect("/login");

  const [locale, user] = await Promise.all([
    getLocale(),
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true, email: true, role: true, mode: true },
    }),
  ]);

  // The database is authoritative; the cookie is only a fast path.
  const role: Role =
    user?.role === "ADMIN" || user?.role === "TEACHER" || user?.role === "STUDENT" || user?.role === "PARENT"
      ? user.role
      : session.role;
  const mode: UserMode = user?.mode === "HOME" ? "HOME" : "SCHOOL";

  return (
    <AppShell
      user={{ name: user?.name ?? session.name, email: user?.email ?? session.email }}
      role={role}
      mode={mode}
      locale={locale}
    >
      {children}
    </AppShell>
  );
}
