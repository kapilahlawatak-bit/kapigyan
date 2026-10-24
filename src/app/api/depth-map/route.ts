/**
 * Download this school's competitive-depth map as a portable file.
 *
 * Separate from the whole-school export because it answers a different
 * question. That one is "here is our children's data" — DPDP portability, a
 * backup, an archive. This one is "here is the argument we made about the
 * syllabus", which contains no child's data at all and is meant to be handed to
 * another school.
 *
 * That distinction is why it is its own route rather than another value of
 * `format` on the school export: this file can leave the school, and the other
 * one should not be sent to a colleague at another school by accident.
 */

import { NextResponse } from "next/server";
import { requireApi } from "@/lib/auth/guard";
import { buildDepthMapExport } from "@/lib/reports/school-export";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApi("ADMIN");
  if ("response" in auth) return auth.response;
  const { session } = auth;
  if (!session.schoolId) return NextResponse.json({ error: "No school" }, { status: 403 });

  const file = await buildDepthMapExport(session.schoolId);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const stamp = file.exportedAt.slice(0, 10);
  const safe = file.school.name.replace(/[^\wऀ-ॿ -]+/g, "").trim().replace(/\s+/g, "-") || "school";

  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kapigyan-depth-map-${safe}-${stamp}.json"`,
    },
  });
}
