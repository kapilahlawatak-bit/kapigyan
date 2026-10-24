/**
 * Session handling: a signed JWT in an httpOnly cookie.
 *
 * `jose` is used rather than `next-auth` because a school deployment wants to
 * own its own data and its own credential store, and because the session
 * payload here is deliberately tiny.
 *
 * The token is a *hint*, not the authority. It proves which user signed in;
 * everything that can change — their role, their school, their password — is
 * re-read from the database on each request by `guard.ts`. That is what makes
 * revoking access a database operation rather than a token edit, and it is why
 * `revokedAt` on a parent link takes effect immediately.
 */

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { isMode, isRole, type Role, type UserMode } from "./roles";

const COOKIE = "kapigyan_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

export type Session = {
  userId: string;
  schoolId: string | null;
  role: Role;
  mode: UserMode;
  name: string;
  email: string;
  /** When the token was issued, as seconds. Compared against passwordChangedAt. */
  issuedAt: number;
};

/** A session that is guaranteed to have a school, for school-scoped queries. */
export type SchoolSession = Session & { schoolId: string };

let warnedAboutSecret = false;

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Copy .env.example to .env and set a long random string.",
    );
  }
  // The example value is published in .env.example, so anyone who has read the
  // repository can forge a session for any account — including ADMIN, which
  // sees a whole school. Sessions are HS256, so this one string is the whole
  // trust boundary.
  //
  // Production refuses to start on it. Development only warns, so that a fresh
  // clone runs on `npm run dev` without extra setup; the warning is long
  // because the failure is otherwise silent until someone forges a token.
  if (value.startsWith("change-me")) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AUTH_SECRET is still the example placeholder from .env.example. " +
          "Generate a real one before deploying, for example: openssl rand -base64 32",
      );
    }
    if (!warnedAboutSecret) {
      warnedAboutSecret = true;
      console.warn(
        [
          "",
          "  ┌─────────────────────────────────────────────────────────────────┐",
          "  │  AUTH_SECRET is still the placeholder from .env.example.        │",
          "  │  Anyone can forge a session for any account. This is fine for   │",
          "  │  local development and unsafe anywhere else.                    │",
          "  │  Fix:  openssl rand -base64 32  →  put it in .env                │",
          "  └─────────────────────────────────────────────────────────────────┘",
          "",
        ].join("\n"),
      );
    }
  }
  return new TextEncoder().encode(value);
}

/**
 * What a caller supplies to mint a session. `issuedAt` is deliberately absent:
 * it is the server's job, taken from the JWT `iat` claim, and accepting it from
 * a caller would let them backdate a token past a password change.
 */
export type NewSession = Omit<Session, "role" | "mode" | "issuedAt"> & {
  role: Role;
  mode: UserMode;
};

export async function createSessionToken(session: NewSession): Promise<string> {
  return new SignJWT({
    sid: session.schoolId,
    rol: session.role,
    mod: session.mode,
    nm: session.name,
    em: session.email,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
}

export async function readSessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const role = payload.rol;
    const mode = payload.mod;
    if (typeof payload.sub !== "string") return null;
    if (typeof role !== "string" || !isRole(role)) return null;
    if (typeof mode !== "string" || !isMode(mode)) return null;
    return {
      userId: payload.sub,
      schoolId: typeof payload.sid === "string" ? payload.sid : null,
      role,
      mode,
      name: typeof payload.nm === "string" ? payload.nm : "",
      email: typeof payload.em === "string" ? payload.em : "",
      issuedAt: typeof payload.iat === "number" ? payload.iat : 0,
    };
  } catch {
    return null;
  }
}

/** Read the session in a Server Component, page or route handler. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token);
}

export async function setSessionCookie(session: NewSession): Promise<void> {
  const token = await createSessionToken(session);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}
