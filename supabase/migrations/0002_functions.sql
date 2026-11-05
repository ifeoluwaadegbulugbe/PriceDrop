-- Server-only database functions. Execute is revoked from clients.

-- Atomically consume one unit. Returns true when the unit was within the limit.
create or replace function public.bump_counter(p_key text, p_limit integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.usage_counters as c (key, count, updated_at)
  values (p_key, 1, now())
  on conflict (key) do update
    set count = c.count + 1, updated_at = now()
    where c.count < p_limit
  returning c.count into v_count;
  return v_count is not null and v_count <= p_limit;
end;
$$;

-- Rate limit buckets are per-window keys, so old rows are garbage. Monthly and
-- daily budget keys (prefix 'budget:') are kept for visibility.
create or replace function public.prune_counters()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.usage_counters
  where key like 'rl:%' and updated_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- The order state machine, enforced in the database as a second line of defence
-- behind src/lib/checkout/stateMachine.ts. The two must stay in step; a test checks it.
create or replace function public.enforce_paypal_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  new.updated_at := now();
  if new.status = old.status then
    return new;
  end if;
  allowed := case old.status
    when 'creating' then array['created', 'payer_action_required', 'failed', 'expired']
    when 'created' then array['payer_action_required', 'approved', 'failed', 'expired', 'cancelled']
    when 'payer_action_required' then array['approved', 'captured', 'failed', 'expired', 'cancelled']
    when 'approved' then array['captured', 'failed', 'expired', 'cancelled']
    else array[]::text[]
  end;
  if not (new.status = any (allowed)) then
    raise exception 'illegal paypal order transition % -> %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger paypal_orders_transition
  before update on public.paypal_orders
  for each row execute function public.enforce_paypal_order_transition();

-- One database transaction for everything a confirmed capture implies.
-- Call only after PayPal reported capture COMPLETED and the amount matched.
-- Idempotent: a repeat call returns the existing purchase.
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

  select * into v_alert from public.deal_alerts where id = v_order.deal_alert_id for update;
  select * into v_tracked from public.tracked_products where id = v_alert.tracked_product_id for update;

  -- The state machine trigger rejects this if the current status is not capturable.
  update public.paypal_orders
    set status = 'captured', paypal_capture_id = p_capture_id, failure_reason = null
    where id = v_order.id;

  insert into public.purchases (user_id, paypal_order_row, product_id, retailer_domain,
                                amount_cents, currency, paypal_order_id, paypal_capture_id, is_sandbox)
  values (v_order.user_id, v_order.id, v_tracked.product_id, p_retailer_domain,
          p_amount_cents, p_currency, v_order.paypal_order_id, p_capture_id, true)
  returning * into v_purchase;

  update public.deal_alerts set status = 'purchased' where id = v_alert.id;
  update public.tracked_products set status = 'purchased' where id = v_tracked.id;

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

revoke execute on function public.enforce_paypal_order_transition() from public, anon, authenticated;
revoke execute on function public.bump_counter(text, integer) from public, anon, authenticated;
revoke execute on function public.prune_counters() from public, anon, authenticated;
revoke execute on function public.finalize_capture(uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.bump_counter(text, integer) to service_role;
grant execute on function public.prune_counters() to service_role;
grant execute on function public.finalize_capture(uuid, text, integer, text, text) to service_role;
