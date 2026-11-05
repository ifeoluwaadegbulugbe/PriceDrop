-- Consumer shopping: interests, categories, saved items, recently viewed, discovery cache.

alter table public.profiles
  add column interests text[] not null default '{}',
  add column favourite_brands text[] not null default '{}',
  add column shopping_preferences text[] not null default '{}';

grant update (interests, favourite_brands, shopping_preferences)
  on public.profiles to authenticated;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete cascade,
  slug text not null unique,
  name text not null,
  description text not null default '',
  image_url text,
  -- Real Channel3 category slugs, from scripts/channel3-categories.ts.
  channel3_slugs text[] not null default '{}',
  search_query text not null,
  -- Which Demo catalogue items belong here. Empty means none, so the page shows an empty state.
  seed_terms text[] not null default '{}',
  display_order integer not null default 0,
  active boolean not null default true
);
create index categories_parent_order_idx on public.categories (parent_id, display_order);

create table public.saved_products (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table public.recently_viewed (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
create index recently_viewed_user_idx on public.recently_viewed (user_id, viewed_at desc);

-- Server-only key/value store: product ID lists and short-lived snapshots.
create table public.discovery_cache (
  key text primary key,
  value jsonb not null,
  fetched_at timestamptz not null default now()
);

alter table public.categories enable row level security;
alter table public.saved_products enable row level security;
alter table public.recently_viewed enable row level security;
alter table public.discovery_cache enable row level security;

revoke all on public.categories, public.saved_products, public.recently_viewed, public.discovery_cache
  from anon, authenticated;

grant select on public.categories, public.saved_products, public.recently_viewed to authenticated;
grant all on public.categories, public.saved_products, public.recently_viewed, public.discovery_cache
  to service_role;

create policy categories_read_active on public.categories
  for select to authenticated using (active);
create policy saved_select_own on public.saved_products
  for select to authenticated using (user_id = (select auth.uid()));
create policy viewed_select_own on public.recently_viewed
  for select to authenticated using (user_id = (select auth.uid()));
-- discovery_cache: no policies, no client grants.

-- Genuine recent drops: the latest observation at a retailer is at least 1% below the one before it,
-- both from a real source, still in stock. Reveals products and prices, never who tracks them.
create or replace function public.trending_price_drops(
  p_since timestamptz,
  p_limit integer,
  p_include_simulated boolean
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with ranked as (
    select
      o.id, o.domain, o.price_cents, o.currency, o.source, o.observed_at, o.in_stock,
      t.product_id,
      lag(o.price_cents) over w as previous_cents,
      lag(o.currency) over w as previous_currency,
      lag(o.source) over w as previous_source,
      row_number() over (
        partition by o.tracked_product_id, o.domain order by o.observed_at desc, o.id desc
      ) as recency
    from public.price_observations o
    join public.tracked_products t on t.id = o.tracked_product_id
    window w as (partition by o.tracked_product_id, o.domain order by o.observed_at, o.id)
  ),
  drops as (
    select distinct on (r.product_id)
      r.product_id, r.domain, r.price_cents, r.previous_cents, r.currency, r.source, r.observed_at
    from ranked r
    where r.recency = 1
      and r.previous_cents is not null
      and r.previous_currency = r.currency
      and r.previous_cents > r.price_cents
      and (r.previous_cents - r.price_cents) * 100 >= r.previous_cents
      and r.observed_at >= p_since
      and r.in_stock is distinct from false
      and r.source <> 'seed'
      and (p_include_simulated or (r.source = 'channel3_live' and r.previous_source = 'channel3_live'))
    order by r.product_id, (r.previous_cents - r.price_cents)::numeric / r.previous_cents desc, r.observed_at desc
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  from (
    select
      d.domain, d.price_cents, d.previous_cents, d.currency, d.source, d.observed_at,
      p.id as product_id, p.source as product_source, p.external_id, p.title, p.brand, p.image_url
    from drops d
    join public.products p on p.id = d.product_id
    order by (d.previous_cents - d.price_cents)::numeric / d.previous_cents desc, d.observed_at desc
    limit p_limit
  ) x;
$$;

-- Products that at least p_min_users people are tracking or have saved. Returns no counts or user data.
create or replace function public.popular_products(p_min_users integer, p_limit integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with interest as (
    select product_id, user_id from public.tracked_products where status in ('active', 'deal_found')
    union
    select product_id, user_id from public.saved_products
  ),
  ranked as (
    select product_id, count(distinct user_id) as people
    from interest
    group by product_id
    having count(distinct user_id) >= p_min_users
    order by people desc
    limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object('source', p.source, 'id', p.external_id)), '[]'::jsonb)
  from ranked r
  join public.products p on p.id = r.product_id;
$$;

revoke execute on function public.trending_price_drops(timestamptz, integer, boolean) from public, anon, authenticated;
revoke execute on function public.popular_products(integer, integer) from public, anon, authenticated;
grant execute on function public.trending_price_drops(timestamptz, integer, boolean) to service_role;
grant execute on function public.popular_products(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Category seed. Slugs in channel3_slugs were checked against Channel3's category search.
-- ---------------------------------------------------------------------------
insert into public.categories (slug, name, description, channel3_slugs, search_query, seed_terms, display_order) values
  ('electronics', 'Electronics', 'Phones, audio, TVs and more', '{electronics}', 'smartphone headphones', '{headphones,phone}', 1),
  ('fashion', 'Fashion', 'Clothes and shoes for every day', '{clothing,shoes}', 'fashion', '{shoes,sneakers}', 2),
  ('beauty', 'Beauty', 'Skincare, makeup and fragrance', '{health-beauty}', 'beauty skincare makeup', '{}', 3),
  ('home-living', 'Home & Living', 'Make your space feel good', '{decor,furniture,linens-bedding}', 'living room furniture', '{}', 4),
  ('computers-accessories', 'Computers & Accessories', 'Laptops, monitors and desk gear', '{computers,computer-accessories}', 'laptop', '{laptop}', 5),
  ('home-appliances', 'Home Appliances', 'Kitchen, laundry and cooling', '{household-appliances,kitchen-appliances}', 'air fryer blender', '{}', 6),
  ('sports-fitness', 'Sports & Fitness', 'Gear to keep you moving', '{exercise-fitness,athletics}', 'fitness equipment', '{running}', 7),
  ('gaming', 'Gaming', 'Consoles, handhelds and more', '{video-game-consoles,gaming-laptops}', 'gaming', '{}', 8),
  ('baby-kids', 'Baby & Kids', 'Toys and essentials for little ones', '{baby-toddler,toys}', 'baby and kids', '{}', 9),
  ('books-stationery', 'Books & Stationery', 'Good reads and desk supplies', '{books,office-supplies}', 'books', '{}', 10),
  ('automotive', 'Automotive', 'Care and accessories for your car', '{vehicle-parts-accessories}', 'car floor mats phone mount', '{}', 11),
  ('accessories', 'Accessories', 'Jewellery, bags and finishing touches', '{jewelry,clothing-accessories}', 'accessories', '{}', 12);

insert into public.categories (parent_id, slug, name, description, channel3_slugs, search_query, seed_terms, display_order)
select p.id, v.slug, v.name, '', v.channel3_slugs, v.search_query, v.seed_terms, v.display_order
from (values
  ('electronics', 'smartphones', 'Smartphones', '{smart-phones}'::text[], 'smartphone', '{phone}'::text[], 1),
  ('electronics', 'tablets', 'Tablets', '{tablet-computers}', 'tablet', '{}', 2),
  ('electronics', 'televisions', 'Televisions', '{televisions}', 'television', '{}', 3),
  ('electronics', 'audio', 'Audio', '{audio}', 'headphones speakers', '{headphones}', 4),
  ('electronics', 'cameras', 'Cameras', '{digital-cameras}', 'digital camera', '{}', 5),
  ('electronics', 'wearables', 'Wearables', '{activity-monitors}', 'smartwatch fitness tracker', '{}', 6),
  ('fashion', 'womens-clothing', 'Women''s clothing', '{clothing}', 'women''s clothing', '{}', 1),
  ('fashion', 'mens-clothing', 'Men''s clothing', '{clothing}', 'men''s clothing', '{}', 2),
  ('fashion', 'shoes', 'Shoes', '{shoes}', 'shoes', '{shoes,sneakers}', 3),
  ('fashion', 'bags', 'Bags', '{luggage-bags}', 'bags', '{}', 4),
  ('fashion', 'fashion-accessories', 'Accessories', '{clothing-accessories}', 'fashion accessories', '{}', 5),
  ('beauty', 'skincare', 'Skincare', '{skin-care}', 'skincare', '{}', 1),
  ('beauty', 'makeup', 'Makeup', '{makeup}', 'makeup', '{}', 2),
  ('beauty', 'haircare', 'Haircare', '{hair-care}', 'hair care', '{}', 3),
  ('beauty', 'fragrance', 'Fragrance', '{perfume-cologne}', 'perfume', '{}', 4),
  ('home-living', 'furniture', 'Furniture', '{furniture}', 'furniture', '{}', 1),
  ('home-living', 'kitchen', 'Kitchen', '{kitchen-dining}', 'kitchen', '{}', 2),
  ('home-living', 'bedding', 'Bedding', '{bedding}', 'bedding', '{}', 3),
  ('home-living', 'home-decor', 'Home decor', '{decor}', 'home decor', '{}', 4),
  ('home-living', 'storage', 'Storage', '{storage-organization}', 'storage organizer', '{}', 5),
  ('computers-accessories', 'laptops', 'Laptops', '{laptops}', 'laptop', '{laptop}', 1),
  ('computers-accessories', 'monitors', 'Monitors', '{computer-monitors}', 'computer monitor', '{}', 2),
  ('computers-accessories', 'computer-accessories', 'Accessories', '{computer-accessories}', 'computer accessories', '{}', 3),
  ('home-appliances', 'kitchen-appliances', 'Kitchen appliances', '{kitchen-appliances}', 'kitchen appliance', '{}', 1),
  ('home-appliances', 'laundry', 'Laundry', '{laundry-appliances}', 'washing machine', '{}', 2),
  ('home-appliances', 'cooling-heating', 'Cooling & heating', '{climate-control-appliances}', 'air conditioner fan', '{}', 3),
  ('sports-fitness', 'exercise', 'Exercise & fitness', '{exercise-fitness}', 'fitness equipment', '{}', 1),
  ('sports-fitness', 'athletic-shoes', 'Athletic shoes', '{athletic-shoes}', 'running shoes', '{running}', 2),
  ('gaming', 'consoles', 'Consoles', '{home-game-consoles}', 'game console', '{}', 1),
  ('gaming', 'handhelds', 'Handhelds', '{handheld-game-consoles}', 'handheld console', '{}', 2),
  ('gaming', 'gaming-laptops', 'Gaming laptops', '{gaming-laptops}', 'gaming laptop', '{}', 3),
  ('baby-kids', 'toys', 'Toys', '{toys}', 'toys', '{}', 1),
  ('baby-kids', 'baby-essentials', 'Baby essentials', '{baby-toddler}', 'baby essentials', '{}', 2),
  ('books-stationery', 'books', 'Books', '{print-books}', 'books', '{}', 1),
  ('books-stationery', 'stationery', 'Stationery', '{stationery,notebooks-notepads}', 'notebook stationery', '{}', 2),
  ('automotive', 'car-care', 'Car care', '{vehicle-maintenance-care-decor}', 'car care', '{}', 1),
  ('automotive', 'car-parts', 'Parts', '{motor-vehicle-parts}', 'car parts', '{}', 2),
  ('accessories', 'jewellery', 'Jewellery', '{jewelry}', 'jewelry', '{}', 1),
  ('accessories', 'luggage', 'Bags & luggage', '{luggage-bags}', 'luggage', '{}', 2)
) as v(parent_slug, slug, name, channel3_slugs, search_query, seed_terms, display_order)
join public.categories p on p.slug = v.parent_slug;

-- ---------------------------------------------------------------------------
-- Buy now: a sandbox checkout that doesn't start from a deal alert.
-- ---------------------------------------------------------------------------
alter table public.paypal_orders
  alter column deal_alert_id drop not null,
  add column product_id uuid references public.products (id),
  add column retailer_domain text,
  add constraint paypal_orders_has_origin check (
    deal_alert_id is not null or (product_id is not null and retailer_domain is not null)
  );

create unique index paypal_orders_one_live_direct
  on public.paypal_orders (user_id, product_id, retailer_domain)
  where deal_alert_id is null and status in ('creating', 'created', 'payer_action_required', 'approved');

create or replace function public.finalize_capture(
  p_order_row uuid,
  p_capture_id text,
  p_amount_cents integer,
  p_currency text,
  p_retailer_domain text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_order public.paypal_orders%rowtype;
  v_alert public.deal_alerts%rowtype;
  v_tracked public.tracked_products%rowtype;
  v_purchase public.purchases%rowtype;
  v_product uuid;
begin
  select * into v_order from public.paypal_orders where id = p_order_row for update;
  if not found then
    raise exception 'order row not found' using errcode = 'P0002';
  end if;

  if v_order.status = 'captured' then
    select * into v_purchase from public.purchases where paypal_order_row = v_order.id;
    return jsonb_build_object('already_captured', true, 'purchase_id', v_purchase.id);
  end if;

  if v_order.amount_cents <> p_amount_cents or v_order.currency <> p_currency then
    raise exception 'capture amount does not match order row' using errcode = 'P0001';
  end if;
  if v_order.paypal_order_id is null then
    raise exception 'order row has no paypal order id' using errcode = 'P0001';
  end if;

  if v_order.deal_alert_id is not null then
    select * into v_alert from public.deal_alerts where id = v_order.deal_alert_id for update;
    select * into v_tracked from public.tracked_products where id = v_alert.tracked_product_id for update;
    v_product := v_tracked.product_id;
  else
    v_product := v_order.product_id;
    -- Buying something you were also tracking ends the tracking.
    select * into v_tracked from public.tracked_products
      where user_id = v_order.user_id and product_id = v_product for update;
  end if;

  -- The state machine trigger rejects this if the current status is not capturable.
  update public.paypal_orders
    set status = 'captured', paypal_capture_id = p_capture_id, failure_reason = null
    where id = v_order.id;

  insert into public.purchases (user_id, paypal_order_row, product_id, retailer_domain,
                                amount_cents, currency, paypal_order_id, paypal_capture_id, is_sandbox)
  values (v_order.user_id, v_order.id, v_product, p_retailer_domain,
          p_amount_cents, p_currency, v_order.paypal_order_id, p_capture_id, true)
  returning * into v_purchase;

  if v_order.deal_alert_id is not null then
    update public.deal_alerts set status = 'purchased' where id = v_alert.id;
  end if;
  if v_tracked.id is not null then
    update public.tracked_products set status = 'purchased' where id = v_tracked.id;
  end if;

  insert into public.notifications (user_id, kind, title, body, link)
  values (v_order.user_id, 'payment_status', 'Sandbox payment captured',
          'PayPal confirmed the sandbox capture. No real money moved and no retailer ships an item.',
          '/purchases');

  insert into public.agent_activity (user_id, tracked_product_id, agent, action, output_summary, status)
  values (v_order.user_id, v_tracked.id, 'purchase', 'capture_confirmed',
          jsonb_build_object('amount_cents', p_amount_cents, 'currency', p_currency,
                             'retailer', p_retailer_domain),
          'ok');

  return jsonb_build_object('already_captured', false, 'purchase_id', v_purchase.id);
end;
$$;
