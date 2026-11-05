import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv, supabaseAnonKey } from "@/lib/env";

/** Acts as the signed-in user. RLS applies. */
export async function createServerSupabase() {
  const store = await cookies();
  return createServerClient(getEnv().NEXT_PUBLIC_SUPABASE_URL!, supabaseAnonKey()!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component. proxy.ts refreshes the session cookie instead.
        }
      },
    },
  });
}
