import Link from "next/link";
import { SettingsForm, SignOutButton } from "@/components/profile-forms";
import { categoryImages, loadCategories, topLevel } from "@/lib/discovery/service";
import { getEnv, isPaypalConfigured } from "@/lib/env";
import { paypalSetupStatus } from "@/lib/paypal/status";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Profile - PriceDrop" };

export default async function SettingsPage() {
  const { user, profile } = await getViewer();
  const env = getEnv();
  const deps = getDeps();
  const tops = topLevel(await loadCategories(deps));
  const images = await categoryImages(deps, tops, profile?.currency ?? "USD");
  const paypal = isPaypalConfigured() ? await paypalSetupStatus(deps) : { ok: false, message: "PayPal sandbox isn't set up on this deployment." };
  const status = [
    { label: "Product data", value: env.CHANNEL3_API_KEY ? "Channel3 live" : "Demo catalogue only" },
    { label: "AI search", value: env.LLM_ENABLED && env.GEMINI_API_KEY ? "On, with a daily cap" : "Basic mode" },
    { label: "Automatic checks", value: "About every 30 minutes (best effort)" },
  ];
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <div>
        <h1 className="text-3xl font-semibold">Profile</h1>
        <p className="mt-1 text-sm break-all text-muted-foreground">Signed in as {user.email}</p>
      </div>
      <SettingsForm
        userId={user.id}
        displayName={profile?.display_name ?? ""}
        notifyInApp={profile?.notify_in_app ?? true}
        interests={profile?.interests ?? []}
        brands={profile?.favourite_brands ?? []}
        prefs={profile?.shopping_preferences ?? []}
        categories={tops.map((c) => ({ slug: c.slug, name: c.name, description: c.description }))}
        images={images}
      />
      <nav aria-label="More" className="flex flex-wrap gap-x-5 gap-y-1 text-sm md:hidden">
        <Link href="/purchases" className="font-medium text-primary hover:underline">Purchases</Link>
      </nav>
      <section aria-label="How this deployment runs" className="grid gap-2 rounded-2xl border bg-card p-5">
        <h2 className="text-lg font-semibold">How this deployment runs</h2>
        <dl className="grid gap-2 text-sm">
          {status.map((s) => (
            <div key={s.label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{s.label}</dt>
              <dd className="text-right font-medium">{s.value}</dd>
            </div>
          ))}
        </dl>
        <p role="status" className={paypal.ok ? "mt-1 rounded-lg bg-deal-soft px-3 py-2 text-sm text-deal" : "mt-1 rounded-lg bg-caution-soft px-3 py-2 text-sm text-caution"}>
          <strong className="font-semibold">PayPal sandbox: </strong>{paypal.message}
        </p>
      </section>
      <div><SignOutButton /></div>
    </div>
  );
}
