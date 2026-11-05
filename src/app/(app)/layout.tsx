import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { Logo } from "@/components/logo";
import { SetupNotice } from "@/components/setup-notice";
import type { NotificationRow } from "@/lib/db/types";
import { getEnv, isSupabaseConfigured } from "@/lib/env";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4 py-10">
        <Logo />
        <SetupNotice />
      </main>
    );
  }
  const { supabase, user } = await getViewer();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader notifications={(data ?? []) as NotificationRow[]} />
      {getEnv().DEMO_MODE && (
        <p role="note" className="bg-sim-soft px-4 py-1.5 text-center text-xs text-sim">
          Demo mode is on. Anything marked Demo simulation uses a made-up retailer price.
        </p>
      )}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
