export function SetupNotice() {
  return (
    <div role="status" className="rounded-2xl border bg-card p-5 text-sm">
      <p className="font-semibold">This deployment isn&apos;t connected to a database yet.</p>
      <p className="mt-1 text-muted-foreground">Accounts need Supabase. Add the Supabase variables from .env.example, then restart. See docs/DEPLOY.md.</p>
    </div>
  );
}
