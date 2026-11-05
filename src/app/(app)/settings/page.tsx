import { SettingsForm } from "@/components/profile-forms";
import { getEnv, isPaypalConfigured } from "@/lib/env";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Settings - PriceDrop" };

export default async function SettingsPage() {
  const { user, profile } = await getViewer();
  const env = getEnv();
  const status = [
    { label: "Product data", value: env.CHANNEL3_API_KEY ? "Channel3 live" : "Demo catalogue only" },
    { label: "AI assistant", value: env.LLM_ENABLED && env.GEMINI_API_KEY ? "On, with a daily cap" : "Basic mode" },
    { label: "Payments", value: isPaypalConfigured() ? "PayPal sandbox" : "Not configured" },
    { label: "Automatic checks", value: "About every 30 minutes (best effort)" },
  ];
  return (
    <div className="mx-auto grid max-w-xl gap-5">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <p className="text-sm break-all text-muted-foreground">Signed in as {user.email}</p>
      <SettingsForm
        userId={user.id}
        displayName={profile?.display_name ?? ""}
        currency={profile?.currency ?? "USD"}
        notifyInApp={profile?.notify_in_app ?? true}
      />
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
      </section>
    </div>
  );
}
