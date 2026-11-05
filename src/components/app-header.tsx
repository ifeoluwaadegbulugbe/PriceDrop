"use client";

import { cn } from "cn";
import { Bell, Heart, Home, LineChart, Search, User } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { NotificationRow } from "@/lib/db/types";
import { timeAgo } from "@/lib/format";
import { createBrowserSupabase } from "@/lib/supabase/browser";

const DESKTOP_NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/price-intelligence", label: "Price Intelligence" },
  { href: "/purchases", label: "Purchases" },
];

const TABS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/watchlist", label: "Watchlist", icon: Heart },
  { href: "/price-intelligence", label: "Prices", icon: LineChart },
  { href: "/settings", label: "Profile", icon: User },
];

const iconButton = "inline-flex size-10 items-center justify-center rounded-full hover:bg-muted";

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
      <PopoverTrigger aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className={cn(iconButton, "relative")}>
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
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. We&apos;ll tell you here when a price you&apos;re tracking meets your target.</p>
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
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-4">
          <div className="flex items-center gap-6">
            <Logo href="/dashboard" />
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
              {DESKTOP_NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={active(n.href) ? "page" : undefined}
                  className={cn("rounded-lg px-3 py-1.5 text-sm hover:bg-muted", active(n.href) ? "font-medium text-foreground" : "text-muted-foreground")}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center">
            <Link href="/search" aria-label="Search" className={cn(iconButton, "hidden md:inline-flex")}><Search className="size-5" aria-hidden /></Link>
            <NotificationsBell initial={notifications} />
            <Link href="/watchlist" aria-label="Watchlist" className={cn(iconButton, "hidden md:inline-flex")}><Heart className="size-5" aria-hidden /></Link>
            <Link href="/settings" aria-label="Profile" className={cn(iconButton, "hidden md:inline-flex")}><User className="size-5" aria-hidden /></Link>
          </div>
        </div>
      </header>

      <nav aria-label="Main mobile" className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active(t.href) ? "page" : undefined}
            className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]", active(t.href) ? "font-semibold text-primary" : "text-muted-foreground")}
          >
            <t.icon className="size-5" aria-hidden />
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
