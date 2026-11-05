import { AssistantFlow } from "@/components/assistant-flow";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Assistant - PriceDrop" };

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { profile } = await getViewer();
  return (
    <div className="grid gap-5">
      <h1 className="text-3xl font-semibold">Assistant</h1>
      <AssistantFlow initialPrompt={(q ?? "").slice(0, 500)} currency={profile?.currency ?? "USD"} />
    </div>
  );
}
