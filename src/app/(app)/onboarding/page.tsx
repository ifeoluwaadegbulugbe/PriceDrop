import { OnboardingForm } from "@/components/profile-forms";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Welcome - PriceDrop" };

const POINTS = [
  { title: "How it works", body: "Tell us what you want and your price. We check about every 30 minutes (best effort), record what we see, and alert you here when an offer meets your rules." },
  { title: "What approval means", body: "We never pay on our own. When a deal appears you choose whether to prepare a checkout, then you approve it yourself at PayPal. Without that, nothing is taken." },
  { title: "What's real", body: "Prices come from Channel3 where connected. Payments run in PayPal's sandbox: no real money moves and no retailer ships an item." },
];

export default async function OnboardingPage() {
  const { user, profile } = await getViewer();
  return (
    <div className="mx-auto grid max-w-lg gap-6">
      <h1 className="text-3xl font-semibold">Welcome to PriceDrop</h1>
      <ul className="grid gap-4">
        {POINTS.map((p) => (
          <li key={p.title}>
            <h2 className="text-base font-semibold">{p.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
          </li>
        ))}
      </ul>
      <OnboardingForm userId={user.id} currency={profile?.currency ?? "USD"} />
    </div>
  );
}
