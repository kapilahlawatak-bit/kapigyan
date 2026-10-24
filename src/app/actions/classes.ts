"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireTeacher } from "@/lib/auth/guard";

/** Create a class. In home mode the class is named after the child. */
export async function createClass(formData: FormData): Promise<void> {
  const session = await requireTeacher();

  const name = String(formData.get("name") ?? "").trim();
  const grade = Number(formData.get("grade") ?? 3);
  if (!name || grade < 1 || grade > 5) throw new Error("A class needs a name and a grade from 1 to 5");

  const childName = String(formData.get("childName") ?? "").trim();

  const cls = await prisma.class.create({
    data: {
      schoolId: session.schoolId,
      name: name.slice(0, 60),
      grade,
      section: String(formData.get("section") ?? "").trim() || null,
      year: `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
      // Whoever creates a class owns it. Leaving this null makes the class
      // unreachable for teachers (`assertClassAccess` treats an unassigned
      // class as unclaimed, not as open) and there is no hand-over UI yet.
      teacherId: session.userId,
    },
  });

  // In home mode the class *is* the child, so create them straight away and
  // log the account in as them — a home educator should not have to set up a
  // separate login for each child.
  if (session.mode === "HOME" && childName) {
    const student = await prisma.student.create({ data: { name: childName.slice(0, 60), rollNo: 1 } });
    await prisma.enrollment.create({ data: { classId: cls.id, studentId: student.id, rollNo: 1 } });
    await prisma.paper.create({
      data: {
        schoolId: session.schoolId!,
        classId: cls.id,
        createdBy: session.userId,
        title: `${childName}'s first test`,
        grade,
        term: "Practice",
        source: "MANUAL",
        status: "DRAFT",
        maxMarks: 0,
      },
    });
  }

  revalidatePath("/classes");
  revalidatePath("/dashboard");
  redirect("/classes");
}
