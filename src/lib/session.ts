import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { userAccounts, staff } from "@/db/schema";
import { createSupabaseServerClient } from "./supabase/server";

export type Role = "admin" | "manager" | "executive";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  department: string;
  staffId: number | null;
  /** Job title from the staff directory, e.g. "Ops Manager" — used for ticket-ownership overrides. */
  jobTitle: string;
  studio: string;
};

/** Current signed-in user, auto-provisioning a user_accounts row on first login. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return null;

  const [existing] = await db.select().from(userAccounts).where(eq(userAccounts.authUserId, user.id)).limit(1);
  if (existing) {
    const [match] = existing.staffId
      ? await db.select().from(staff).where(eq(staff.id, existing.staffId)).limit(1)
      : [];
    return {
      id: existing.authUserId,
      email: existing.email,
      name: existing.name || existing.email,
      role: existing.role as Role,
      department: existing.department,
      staffId: existing.staffId,
      jobTitle: match?.role ?? "",
      studio: match?.location ?? "",
    };
  }

  // First-time login: match against the staff directory for name/department, provision the account.
  const [match] = await db.select().from(staff).where(eq(staff.email, user.email)).limit(1);
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(userAccounts);
  const role: Role = count === 0 ? "admin" : "executive"; // first account bootstraps as admin

  const [created] = await db
    .insert(userAccounts)
    .values({
      authUserId: user.id,
      email: user.email,
      name: match?.name || user.email,
      role,
      department: match?.department || "",
      staffId: match?.id ?? null,
    })
    .onConflictDoNothing({ target: userAccounts.authUserId })
    .returning();

  const row = created ?? (await db.select().from(userAccounts).where(eq(userAccounts.authUserId, user.id)).limit(1))[0];
  return {
    id: row.authUserId,
    email: row.email,
    name: row.name || row.email,
    role: row.role as Role,
    department: row.department,
    staffId: row.staffId,
    jobTitle: match?.role ?? "",
    studio: match?.location ?? "",
  };
}
