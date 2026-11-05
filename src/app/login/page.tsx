import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "Log in - PriceDrop" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4 py-10">
      <Logo />
      <h1 className="text-3xl font-semibold">Welcome back</h1>
      {isSupabaseConfigured() ? <AuthForm mode="login" next={next} /> : <SetupNotice />}
    </main>
  );
}
