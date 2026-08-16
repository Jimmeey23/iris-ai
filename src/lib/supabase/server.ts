import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Server-side Supabase client for route handlers / server components (reads the session cookie). */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component render — session refresh is handled by middleware instead.
        }
      },
    },
  });
}
