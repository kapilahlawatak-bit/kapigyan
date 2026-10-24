import { redirect } from "next/navigation";

/**
 * The register and the roster now live together on /classes ("Register").
 * This keeps old links and bookmarks working — including the classId form
 * some analytics links used to emit — by forwarding to the merged page.
 */
export default async function AttendanceRedirect(props: PageProps<"/attendance">) {
  const sp = await props.searchParams;
  const params = new URLSearchParams();
  const cls = sp.class ?? sp.classId;
  if (cls) params.set("class", String(cls));
  if (sp.date) params.set("date", String(sp.date));
  const qs = params.toString();
  redirect(qs ? `/classes?${qs}` : "/classes");
}
