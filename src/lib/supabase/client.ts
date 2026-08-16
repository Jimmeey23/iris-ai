import { createBrowserClient } from "@supabase/ssr";

/** Browser-side Supabase client — reads/writes the auth session as cookies so middleware can see it. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
