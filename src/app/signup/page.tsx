import { AuthForm } from "@/components/auth-form";
import { Logo } from "@/components/logo";
import { SetupNotice } from "@/components/setup-notice";
import { isSupabaseConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign up - PriceDrop" };

export default function SignupPage() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-4 py-10">
      <Logo />
      <div>
        <h1 className="text-3xl font-semibold">Create your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">Sandbox prototype: no real money moves.</p>
      </div>
      {isSupabaseConfigured() ? <AuthForm mode="signup" /> : <SetupNotice />}
    </main>
  );
}
