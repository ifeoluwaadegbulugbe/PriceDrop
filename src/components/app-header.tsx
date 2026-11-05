"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Bell, LogOut } from "lucide-react";
import { Logo } from "@/components/logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NotificationRow } from "@/lib/db/types";
import { timeAgo } from "@/lib/format";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/search", label: "Search" },
  { href: "/purchases", label: "Purchases" },
  { href: "/settings", label: "Settings" },
];

function NotificationsBell({ initial }: { initial: NotificationRow[] }) {
  const [items, setItems] = useState(initial);
  const router = useRouter();
  const unread = items.filter((n) => !n.read_at).length;

  async function markAllRead() {
    const ids = items.filter((n) => !n.read_at).map((n) => n.id);
    if (ids.length === 0) return;
    const stamp = new Date().toISOString();
    setItems((cur) => cur.map((n) => ({ ...n, read_at: n.read_at ?? stamp })));
    // RLS and a column grant allow exactly this write.
    await createBrowserSupabase().from("notifications").update({ read_at: stamp }).in("id", ids);
    router.refresh();
  }

  return (
    <Popover onOpenChange={(open) => { if (!open) void markAllRead(); }}>
      <PopoverTrigger
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="tnum absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Notifications</p>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. We&apos;ll tell you here when a deal meets your rules.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id} className={cn("px-4 py-3 text-sm", !n.read_at && "bg-accent/50")}>
                {n.link ? <Link href={n.link} className="font-medium hover:underline">{n.title}</Link> : <p className="font-medium">{n.title}</p>}
                <p className="mt-0.5 break-words text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{timeAgo(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function AppHeader({ notifications }: { notifications: NotificationRow[] }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createBrowserSupabase().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-6">
          <Logo href="/dashboard" />
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={pathname.startsWith(n.href) ? "page" : undefined}
                className={cn("rounded-lg px-3 py-1.5 text-sm hover:bg-muted", pathname.startsWith(n.href) ? "font-medium text-foreground" : "text-muted-foreground")}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-1">
          <NotificationsBell initial={notifications} />
          <button type="button" onClick={signOut} aria-label="Log out" className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-muted">
            <LogOut className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <nav aria-label="Main mobile" className="flex border-t md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={pathname.startsWith(n.href) ? "page" : undefined}
            className={cn("flex-1 py-2.5 text-center text-xs", pathname.startsWith(n.href) ? "font-semibold text-primary" : "text-muted-foreground")}
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
