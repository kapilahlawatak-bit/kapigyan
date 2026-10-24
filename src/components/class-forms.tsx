"use client";

import { useTransition } from "react";
import { Plus, Users } from "lucide-react";
import { createClass } from "@/app/actions/classes";
import { addStudents } from "@/app/actions/papers";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";

/**
 * Creating a class.
 *
 * One row. The form used to be a four-column grid with its own submit row
 * underneath, which made a three-field form look like a form to be studied. The
 * button now sits in the grid, bottom-aligned with the inputs, so the whole
 * thing reads as a single sentence: name, optional section, grade, go.
 */
export function ClassForm({ isHome }: { isHome: boolean }) {
  const [pending, start] = useTransition();

  return (
    <form
      action={(fd) => start(async () => { await createClass(fd); })}
      className="grid items-end gap-2 sm:grid-cols-[1fr_auto_auto_auto]"
    >
      <div className="space-y-1.5">
        <Label>{isHome ? "What should we call this?" : "Class name"}</Label>
        <Input name="name" placeholder={isHome ? "Aarav" : "Class 3-A"} required maxLength={60} />
      </div>
      {isHome ? (
        <div className="space-y-1.5">
          <Label>Child&apos;s name</Label>
          <Input name="childName" placeholder="Aarav Sharma" maxLength={60} />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>Section</Label>
          <Input name="section" placeholder="A" maxLength={10} className="w-20" />
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Class</Label>
        <Select name="grade" defaultValue="3" className="w-28">
          {[1, 2, 3, 4, 5].map((g) => <option key={g} value={g}>Class {g}</option>)}
        </Select>
      </div>
      <Button type="submit" disabled={pending} className="h-10">
        <Plus className="size-3.5" /> {pending ? "…" : isHome ? "Add" : "Create"}
      </Button>
    </form>
  );
}

export function AddStudentsForm({ classId }: { classId: string }) {
  const [pending, start] = useTransition();
  return (
    <form action={(fd) => start(async () => { await addStudents(fd); })} className="flex flex-wrap gap-2">
      <input type="hidden" name="classId" value={classId} />
      <Textarea
        name="names"
        rows={1}
        placeholder="Type names separated by commas, or one per line"
        className="min-h-9 flex-1 resize-none py-2"
        required
      />
      <Button type="submit" size="sm" disabled={pending} variant="secondary">
        <Users className="size-3.5" /> {pending ? "Adding…" : "Add"}
      </Button>
    </form>
  );
}
