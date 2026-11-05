-- PriceDrop schema. Money = integer minor units. All timestamps timestamptz.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  currency char(3) not null default 'USD',
  notify_in_app boolean not null default true,
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80));
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Shared display metadata only. Never prices.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('channel3', 'seed')),
  external_id text not null,
  title text not null,
  brand text,
  image_url text,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.tracked_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id),
  status text not null default 'active'
    check (status in ('active', 'paused', 'deal_found', 'purchased', 'removed')),
  currency char(3) not null default 'USD',
  target_price_cents integer not null check (target_price_cents > 0),
  max_total_cents integer not null,
  allowed_domains text[] not null default '{}',
  allowed_variants jsonb,
  require_in_stock boolean not null default true,
  last_checked_at timestamptz,
  last_check_status text,
  created_at timestamptz not null default now(),
  unique (user_id, product_id),
  check (max_total_cents >= target_price_cents)
);
create index tracked_products_user_status_idx on public.tracked_products (user_id, status);
create index tracked_products_status_checked_idx on public.tracked_products (status, last_checked_at);

create table public.price_observations (
  id bigint generated always as identity primary key,
  tracked_product_id uuid not null references public.tracked_products (id) on delete cascade,
  domain text not null,
  offer_url text,
  price_cents integer not null check (price_cents >= 0),
  shipping_cents integer check (shipping_cents >= 0),
  currency char(3) not null,
  in_stock boolean,
  source text not null check (source in ('channel3_live', 'seed', 'demo_simulation')),
  is_baseline boolean not null default false,
  observed_at timestamptz not null default now()
);
create index price_observations_tracked_observed_idx
  on public.price_observations (tracked_product_id, observed_at desc);

create table public.deal_alerts (
  id uuid primary key default gen_random_uuid(),
  tracked_product_id uuid not null references public.tracked_products (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  observation_id bigint not null references public.price_observations (id) on delete cascade,
  domain text not null,
  price_cents integer not null check (price_cents >= 0),
  previous_price_cents integer,
  evaluation jsonb not null,
  explanation text not null,
  explanation_source text not null check (explanation_source in ('llm', 'template')),
  status text not null default 'open'
    check (status in ('open', 'checkout_prepared', 'purchased', 'dismissed', 'expired')),
  created_at timestamptz not null default now()
);
create unique index deal_alerts_one_live_per_domain
  on public.deal_alerts (tracked_product_id, domain)
  where status in ('open', 'checkout_prepared');
create index deal_alerts_user_created_idx on public.deal_alerts (user_id, created_at desc);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('deal_found', 'tracking_status', 'payment_status')),
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);

create table public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  deal_alert_id uuid not null references public.deal_alerts (id) on delete cascade,
  paypal_order_id text unique,
  idempotency_key text not null unique,
  amount_cents integer not null check (amount_cents > 0),
  currency char(3) not null,
  status text not null
    check (status in ('creating', 'created', 'payer_action_required', 'approved',
                      'captured', 'failed', 'expired', 'cancelled')),
  approve_url text,
  expires_at timestamptz not null,
  paypal_capture_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index paypal_orders_one_live_per_alert
  on public.paypal_orders (deal_alert_id)
  where status in ('creating', 'created', 'payer_action_required', 'approved');
create index paypal_orders_status_created_idx on public.paypal_orders (status, created_at);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  paypal_order_row uuid not null unique references public.paypal_orders (id) on delete cascade,
  product_id uuid not null references public.products (id),
  retailer_domain text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency char(3) not null,
  paypal_order_id text not null,
  paypal_capture_id text not null,
  is_sandbox boolean not null default true,
  refunded_at timestamptz,
  purchased_at timestamptz not null default now()
);
create index purchases_user_purchased_idx on public.purchases (user_id, purchased_at desc);

-- Summaries only. Never secrets or raw PayPal payloads.
create table public.agent_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  tracked_product_id uuid references public.tracked_products (id) on delete cascade,
  agent text not null check (agent in ('intent', 'discovery', 'evaluation', 'monitoring', 'purchase')),
  action text not null,
  input_summary jsonb,
  output_summary jsonb,
  status text not null,
  created_at timestamptz not null default now()
);
create index agent_activity_user_created_idx on public.agent_activity (user_id, created_at desc);

create table public.webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

-- Budget guard, LLM cap and rate limit counters. Server only.
create table public.usage_counters (
  key text primary key,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.tracked_products enable row level security;
alter table public.price_observations enable row level security;
alter table public.deal_alerts enable row level security;
alter table public.notifications enable row level security;
alter table public.paypal_orders enable row level security;
alter table public.purchases enable row level security;
alter table public.agent_activity enable row level security;
alter table public.webhook_events enable row level security;
alter table public.usage_counters enable row level security;

-- Supabase grants broad table privileges by default. Start from nothing and
-- grant back precisely, so policies are not the only line of defence.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles, public.products, public.tracked_products,
  public.price_observations, public.deal_alerts, public.notifications,
  public.paypal_orders, public.purchases, public.agent_activity to authenticated;

grant update (display_name, currency, notify_in_app, onboarded) on public.profiles to authenticated;

grant insert (user_id, product_id, status, currency, target_price_cents, max_total_cents,
              allowed_domains, allowed_variants, require_in_stock)
  on public.tracked_products to authenticated;
grant update (status, target_price_cents, max_total_cents, allowed_domains,
              allowed_variants, require_in_stock)
  on public.tracked_products to authenticated;

grant update (read_at) on public.notifications to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy products_read on public.products
  for select to authenticated using (true);

create policy tracked_select_own on public.tracked_products
  for select to authenticated using (user_id = (select auth.uid()));
-- Clients may never set deal_found or purchased: those are outcomes the server records.
create policy tracked_insert_own on public.tracked_products
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status in ('active', 'paused'));
create policy tracked_update_own on public.tracked_products
  for update to authenticated
  using (user_id = (select auth.uid()) and status <> 'purchased')
  with check (user_id = (select auth.uid()) and status in ('active', 'paused', 'removed'));

create policy observations_select_via_owner on public.price_observations
  for select to authenticated
  using (exists (
    select 1 from public.tracked_products t
    where t.id = tracked_product_id and t.user_id = (select auth.uid())
  ));

create policy alerts_select_own on public.deal_alerts
  for select to authenticated using (user_id = (select auth.uid()));

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy orders_select_own on public.paypal_orders
  for select to authenticated using (user_id = (select auth.uid()));

create policy purchases_select_own on public.purchases
  for select to authenticated using (user_id = (select auth.uid()));

create policy activity_select_own on public.agent_activity
  for select to authenticated using (user_id = (select auth.uid()));

-- webhook_events and usage_counters: no policies, no grants. Service role only.
