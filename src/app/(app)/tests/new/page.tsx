import { requireTeacher } from "@/lib/auth/guard";
import { getLocale } from "@/lib/i18n";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/app-shell";
import { UploadWizard } from "@/components/upload-wizard";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export const metadata = { title: "Create a test" };
export const dynamic = "force-dynamic";

export default async function NewTestPage() {
  const session = await requireTeacher();
  const locale = await getLocale();

  const classes = await prisma.class.findMany({
    where: { schoolId: session.schoolId, ...(session.role === "TEACHER" ? { teacherId: session.userId } : {}) },
    orderBy: { grade: "asc" },
    include: { _count: { select: { enrollments: true } } },
  });

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Create a test"
        titleHi="नई परीक्षा बनाएँ"
        description="Upload a paper you already have, or type the questions in."
        locale={locale}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/tests">Back to tests</Link>
          </Button>
        }
      />
      <UploadWizard
        locale={locale}
        defaultClassId={classes[0]?.id ?? null}
        classes={classes.map((c) => ({ id: c.id, name: c.name, grade: c.grade, studentCount: c._count.enrollments }))}
      />
    </div>
  );
}
