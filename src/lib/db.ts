import { PrismaClient } from "@/generated/prisma/client";

/**
 * A single Prisma client per process. In dev, Next.js re-evaluates modules on
 * every hot reload, so we cache on globalThis to avoid exhausting connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/* ------------------------------------------------------------------ */
/* Small typed helpers for JSON columns                                */
/* ------------------------------------------------------------------ */
/**
 * The schema stores structured values as JSON strings so the same models run
 * on SQLite and PostgreSQL. These keep the casts honest in one place.
 */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
