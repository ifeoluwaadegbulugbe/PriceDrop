import { CategoryTile } from "@/components/category-tile";
import { loadCategories, topLevel } from "@/lib/discovery/service";
import { getDeps } from "@/lib/serverDeps";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Categories - PriceDrop" };

export default async function CategoriesPage() {
  await getViewer();
  const tops = topLevel(await loadCategories(getDeps()));
  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-3xl font-semibold">Explore products</h1>
        <p className="mt-1 text-muted-foreground">Have a look around, or just tell PriceDrop what you need.</p>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tops.map((c, i) => (
          <li key={c.slug} className={[0, 5, 6, 11].includes(i) ? "md:col-span-2" : ""}>
            <CategoryTile category={c} className="h-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
