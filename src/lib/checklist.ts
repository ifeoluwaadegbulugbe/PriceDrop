/** Getting-started progress, worked out from what the person has really done. Pure, so it can be tested. */

export type ChecklistFacts = {
  interests: number;
  searches: number;
  productsOpened: number;
  saved: number;
  idealPrices: number;
  updatesConfirmed: boolean;
  dismissed: boolean;
};

export type ChecklistTask = { id: string; title: string; description: string; href: string | null; cta: string; done: boolean };
export type Checklist = { tasks: ChecklistTask[]; completed: number; total: number; allDone: boolean; visible: boolean };

export function buildChecklist(f: ChecklistFacts): Checklist {
  const tasks: ChecklistTask[] = [
    { id: "interests", title: "Choose what you love", description: "Select your favourite shopping categories.", href: "/settings", cta: "Choose", done: f.interests > 0 },
    { id: "search", title: "Try your first AI search", description: "Tell PriceDrop what you're looking for.", href: "/assistant", cta: "Ask", done: f.searches > 0 },
    { id: "explore", title: "Explore your recommendations", description: "Open a product to see what PriceDrop finds for you.", href: "/assistant", cta: "Explore", done: f.productsOpened > 0 },
    { id: "save", title: "Save something you like", description: "Keep an item handy so you can follow its price.", href: "/categories", cta: "Browse", done: f.saved > 0 },
    { id: "ideal", title: "Set your ideal price", description: "Tell PriceDrop how much you'd like to pay.", href: "/saved", cta: "Set price", done: f.idealPrices > 0 },
    { id: "updates", title: "Turn on price updates", description: "Hear about it here when prices change.", href: null, cta: "Turn on", done: f.updatesConfirmed },
  ];
  const completed = tasks.filter((t) => t.done).length;
  return { tasks, completed, total: tasks.length, allDone: completed === tasks.length, visible: !f.dismissed };
}
