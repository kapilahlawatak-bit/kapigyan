import { redirect } from "next/navigation";
import { Building2, Download, Globe, KeyRound, LogOut, Palette, ShieldCheck, Trash2, User as UserIcon } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getLocale, t } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { ROLE_LABEL, MODE_LABEL } from "@/lib/auth/roles";
import { isAiEnabled, aiDisabledReason } from "@/lib/ai/client";
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui/primitives";
import { Actions } from "@/components/settings-forms";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const locale = await getLocale();

  const [user, school, children] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.userId } }),
    session.schoolId ? prisma.school.findUnique({ where: { id: session.schoolId } }) : null,
    session.role === "PARENT"
      ? prisma.parentLink.findMany({
          where: { parentId: session.userId },
          include: { student: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
  ]);

  const aiEnabled = isAiEnabled();

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Settings"
        titleHi={t(locale, "settings")}
        description="Your account, this school, and your data."
        locale={locale}
      />

      <div className="p-5 max-w-3xl w-full space-y-4">
        {/* Account */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><UserIcon className="size-3.5" /> Your account</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="flex flex-wrap gap-2">
              <Badge tone="brand" size="lg">{ROLE_LABEL[session.role].en}</Badge>
              <Badge tone="neutral" size="lg">{MODE_LABEL[session.mode].en}</Badge>
              {user?.consentAt ? (
                <Badge tone="good" size="lg">Data consent recorded {formatDate(user.consentAt, true)}</Badge>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input name="name" defaultValue={user?.name ?? session.name} />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input value={session.email} readOnly disabled className="bg-surface-2" />
              </div>
            </div>
            <Actions action="updateProfile">
              <Button type="submit" size="sm">Save name</Button>
            </Actions>
          </CardContent>
        </Card>

        {/* School */}
        {school ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5"><Building2 className="size-3.5" /> School</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <p className="text-xs text-ink-2">{school.name}{school.city ? `, ${school.city}` : ""}{school.state ? `, ${school.state}` : ""}</p>
              {session.role === "ADMIN" ? (
                <Actions action="renameSchool">
                  <div className="flex flex-wrap gap-2">
                    <Input name="schoolName" defaultValue={school.name} className="max-w-xs" />
                    <Button type="submit" size="sm">Rename</Button>
                  </div>
                </Actions>
              ) : (
                <p className="text-[11px] text-ink-4">Only a school administrator can rename the school.</p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Language */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Globe className="size-3.5" /> Language</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Actions action="switchLocale">
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-52 space-y-1.5">
                  <Label>App language</Label>
                  <Select name="locale" defaultValue={locale}>
                    <option value="en">English</option>
                    <option value="hi">हिन्दी (Hindi)</option>
                  </Select>
                </div>
                <Button type="submit" size="sm">Apply</Button>
              </div>
            </Actions>
            <p className="mt-2 text-[11px] text-ink-4">
              Question papers keep their English and Hindi text either way — this only changes the interface.
            </p>
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><Palette className="size-3.5" /> Appearance</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap items-center gap-3">
              <ThemeToggle />
              <div className="min-w-0">
                <p className="text-xs font-medium text-ink">Light or dark</p>
                <p className="mt-0.5 text-[11px] text-ink-4">
                  Follows your device by default. Your choice is remembered on this device only — nothing about
                  it is sent to the school server.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5"><KeyRound className="size-3.5" /> Password</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Actions action="changePassword">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Current password</Label>
                  <Input type="password" name="current" autoComplete="current-password" required />
                </div>
                <div className="space-y-1.5">
                  <Label>New password</Label>
                  <Input type="password" name="next" autoComplete="new-password" required minLength={8} />
                </div>
              </div>
              <Button type="submit" size="sm" className="mt-3">Change password</Button>
            </Actions>
          </CardContent>
        </Card>

        {/* AI */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5"><SparkleDot /> AI services</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Reading photographs and generating unusual questions needs an API key. Everything else —
                marking, analysis, the question bank, paper generation and every report — works without one.
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {aiEnabled ? (
              <Alert tone="good" title="AI is on">Photographs and free-form question generation are available.</Alert>
            ) : (
              <Alert tone="info" title="AI is off">{aiDisabledReason()}</Alert>
            )}
          </CardContent>
        </Card>

        {/* Consent */}
        {session.role === "PARENT" && children.length > 0 ? (
          <Card>
            <CardHeader>
              <div>
                <CardTitle className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Consent and access</CardTitle>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  You can see only your own child. Withdrawing consent takes effect immediately, including
                  on any link you have already saved.
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0">
              {children.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-control border p-3">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{c.student.name}</span>
                  <Badge tone={c.revokedAt ? "bad" : "good"} size="sm">{c.revokedAt ? "withdrawn" : "active"}</Badge>
                  <Actions action="setConsent" key={`${c.id}-${c.revokedAt ? "r" : "g"}`}>
                    <input type="hidden" name="studentId" value={c.student.id} />
                    <input type="hidden" name="grant" value={c.revokedAt ? "yes" : "no"} />
                    <Button type="submit" size="sm" variant={c.revokedAt ? "secondary" : "ghost"}>
                      {c.revokedAt ? "Give access back" : "Withdraw access"}
                    </Button>
                  </Actions>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {/* Danger */}
        <Card className="border-bad/30">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-1.5 text-bad"><Trash2 className="size-3.5" /> Delete my data</CardTitle>
              <p className="mt-0.5 text-[11px] text-ink-3">
                Under the DPDP Act 2023 you can ask for everything held about you to be erased. This deletes
                your account and every test and answer you created. Student records your school holds in
                its own name are kept, because that is a separate obligation — ask the school to remove
                those if you want that too.
              </p>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <Actions action="deleteMyData">
              <div className="flex flex-wrap items-center gap-2">
                <Input name="confirm" placeholder="Type DELETE to confirm" className="max-w-56" />
                <Button type="submit" size="sm" variant="danger">Delete everything</Button>
              </div>
            </Actions>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Actions action="signOut">
            <Button type="submit" size="sm" variant="secondary">
              <LogOut className="size-3.5" /> Sign out
            </Button>
          </Actions>
        </div>
      </div>
    </div>
  );
}

function SparkleDot() {
  return <span className="size-3.5 rounded-full bg-brand" />;
}
