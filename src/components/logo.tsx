import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
      <svg aria-hidden viewBox="0 0 24 24" className="size-6 text-primary" fill="none">
        <rect width="24" height="24" rx="7" fill="currentColor" />
        <path d="M7 8.5h7.5a3 3 0 0 1 0 6H12M12 14.5 9.5 12M12 14.5 9.5 17" stroke="var(--primary-foreground)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      PriceDrop
    </Link>
  );
}
