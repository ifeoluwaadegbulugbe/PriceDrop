import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/** Email confirmation link target. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";
  const safeNext = /^\/(?!\/)/.test(next) ? next : "/dashboard";
  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL("/login", url.origin));
}
