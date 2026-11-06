"use client";

import { cn } from "cn";
import {
  Baby, BookOpen, Car, Check, Dumbbell, Gamepad2, Gem, Laptop, Package, Refrigerator, Shirt, Smartphone, Sofa, Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

const ART: Record<string, { icon: LucideIcon; from: string; to: string }> = {
  electronics: { icon: Smartphone, from: "#e4ecff", to: "#c9d8ff" },
  fashion: { icon: Shirt, from: "#ffe6ee", to: "#ffc9d9" },
  beauty: { icon: Sparkles, from: "#fdeaf7", to: "#f8cfe9" },
  "home-living": { icon: Sofa, from: "#fff1dd", to: "#ffdfb5" },
  "computers-accessories": { icon: Laptop, from: "#e6f3f7", to: "#c5e4ee" },
  "home-appliances": { icon: Refrigerator, from: "#ecf0f4", to: "#d4dde6" },
  "sports-fitness": { icon: Dumbbell, from: "#e5f8e9", to: "#c4eecd" },
  gaming: { icon: Gamepad2, from: "#efe8ff", to: "#dacbff" },
  "baby-kids": { icon: Baby, from: "#fff7d6", to: "#ffeca6" },
  "books-stationery": { icon: BookOpen, from: "#f5ede3", to: "#e9d9c4" },
  automotive: { icon: Car, from: "#e8ecef", to: "#ccd4da" },
  accessories: { icon: Gem, from: "#e7f7f5", to: "#c5ebe6" },
};

export type TileCategory = { slug: string; name: string; description: string };

function TileArt({ category }: { category: TileCategory }) {
  const art = ART[category.slug] ?? { icon: Package, from: "#f1f1f4", to: "#dfdfe6" };
  const Icon = art.icon;
  return (
    <div aria-hidden className="absolute inset-0" style={{ background: `linear-gradient(145deg, ${art.from}, ${art.to})` }}>
      <Icon strokeWidth={1.1} className="absolute -right-3 -bottom-3 size-[62%] max-h-44 text-black/25 transition-transform duration-300 group-hover:scale-105" />
    </div>
  );
}

function TileText({ category, showDescription }: { category: TileCategory; showDescription: boolean }) {
  return (
    <span className="relative block max-w-[85%] p-3.5 sm:p-4">
      <span className="block font-display text-base leading-tight font-semibold text-[#1b1b24] sm:text-lg">{category.name}</span>
      {showDescription && <span className="mt-1 block text-xs leading-snug text-[#3f3f4c]">{category.description}</span>}
    </span>
  );
}

/** Large illustrated tile linking to a category page. */
export function CategoryTile({ category, className }: { category: TileCategory; className?: string }) {
  return (
    <Link
      href={`/categories/${category.slug}`}
      className={cn("group relative block min-h-36 overflow-hidden rounded-2xl sm:min-h-44", className)}
    >
      <TileArt category={category} />
      <TileText category={category} showDescription />
    </Link>
  );
}

/** The same tile as a multi-select control, for onboarding and settings. */
export function SelectableTile({
  category,
  selected,
  onToggle,
}: {
  category: TileCategory;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={category.name}
      onClick={onToggle}
      className={cn(
        "group relative block min-h-32 w-full overflow-hidden rounded-2xl text-left ring-offset-2 ring-offset-background transition-shadow sm:min-h-36",
        selected ? "ring-3 ring-brand" : "ring-1 ring-black/5",
      )}
    >
      <TileArt category={category} />
      <TileText category={category} showDescription={false} />
      <span
        aria-hidden
        className={cn(
          "absolute top-2.5 right-2.5 flex size-6 items-center justify-center rounded-full border-2 transition-colors",
          selected ? "border-brand bg-brand text-white" : "border-white bg-white/70 text-transparent",
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </button>
  );
}
