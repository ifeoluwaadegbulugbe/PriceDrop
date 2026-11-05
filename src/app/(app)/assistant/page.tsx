import { redirect } from "next/navigation";

/** Search and the assistant are one experience now. Old links keep working. */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  redirect(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
}
