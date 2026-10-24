import { NextResponse } from "next/server";
import { getLocale, setLocale } from "@/lib/i18n";

/** Small language switch that works from a plain form post in the sidebar. */
export async function POST(request: Request) {
  const form = await request.formData();
  const locale = String(form.get("locale") ?? "en");
  await setLocale(locale);
  return NextResponse.redirect(safeBack(request));
}

export async function GET() {
  return NextResponse.json({ locale: await getLocale() });
}

/**
 * Where to send the browser back to after switching language.
 *
 * The `Referer` header is attacker-controlled, so it is only followed when it
 * names this same origin *and* stays on an in-app path. Falling back to
 * `new URL(referer, request.url)` would turn this unauthenticated endpoint
 * into an open redirect: a link to `/api/locale` from an attacker's page would
 * bounce a teacher to a convincing copy of a sign-in page.
 */
function safeBack(request: Request): URL {
  const here = new URL(request.url);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const target = new URL(referer);
      if (target.origin === here.origin && target.pathname.startsWith("/") && !target.pathname.startsWith("//")) {
        return target;
      }
    } catch {
      // Malformed Referer; fall through to the dashboard.
    }
  }
  return new URL("/dashboard", here);
}
