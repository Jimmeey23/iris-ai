/**
 * Development-only auth fallback.
 *
 * Active ONLY when both hold:
 *  1. the app is NOT running in production (`NODE_ENV !== "production"`), and
 *  2. Supabase is not configured (no NEXT_PUBLIC_SUPABASE_URL).
 *
 * A production deployment always satisfies neither condition — NODE_ENV is
 * "production" and Supabase env vars are part of deployment — so this can
 * never widen authentication there. It exists so local runs and sandbox
 * previews without a Supabase project can still use the app, as a fixed
 * local user, instead of being trapped by auth they cannot configure.
 */
export function devAuthBypassActive(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/** The fixed identity used under the dev bypass. Admin so config surfaces work. */
export const DEV_USER = {
  id: "dev-local-user",
  email: "dev@localhost",
  name: "Dev User",
  role: "admin" as const,
  department: "Operations",
  staffId: null,
  jobTitle: "Studio Manager",
  studio: "Kwality House, Kemps Corner",
};
