import { OnboardingFlow } from "@/components/onboarding-flow";
import { loadCategories, topLevel } from "@/lib/discovery/service";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Welcome - PriceDrop" };

export default async function OnboardingPage() {
  const { user, profile } = await getViewer();
  const tops = topLevel(await loadCategories(getDeps()));
  return (
    <OnboardingFlow
      userId={user.id}
      categories={tops.map((c) => ({ slug: c.slug, name: c.name, description: c.description }))}
      initial={{
        interests: profile?.interests ?? [],
        brands: profile?.favourite_brands ?? [],
        prefs: profile?.shopping_preferences ?? [],
        notify: profile?.notify_in_app ?? true,
      }}
    />
  );
}
