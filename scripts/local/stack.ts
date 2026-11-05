/**
 * LOCAL EMULATOR. Development and test only. Never deployed, never imported by src/.
 *
 * A real Postgres (PGlite) running the real migrations and real RLS, behind just enough of
 * PostgREST and GoTrue for @supabase/supabase-js, plus a fake PayPal sandbox. It exists because
 * this project must be testable with no accounts and no Docker. Passing here shows our logic and
 * policies are right. It does NOT show the real PayPal or Supabase APIs behave as emulated.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

export const JWT_SECRET = "local-stack-only-not-a-real-secret-0123456789";

const b64 = (v: string | Buffer) => Buffer.from(v).toString("base64url");
function sign(payload: Record<string, unknown>): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64(sig)}`;
}
function verify(token: string): Record<string, unknown> | null {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const want = b64(createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest());
  if (want !== sig) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  if (typeof claims.exp === "number" && claims.exp < Date.now() / 1000) return null;
  return claims;
}

export const ANON_KEY = sign({ role: "anon", iss: "local-stack", exp: 4102444800 });
export const SERVICE_KEY = sign({ role: "service_role", iss: "local-stack", exp: 4102444800 });

const AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    encrypted_password text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(AUTH_STUB);
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).sort()) {
    await db.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  return db;
}

// ---- PostgREST subset -------------------------------------------------------------------------

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name: string): string {
  if (!IDENT.test(name)) throw new RestError(400, "42601", `bad identifier ${name}`);
  return `"${name}"`;
}
function lit(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

class RestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function where(params: URLSearchParams): string {
  const clauses: string[] = [];
  for (const [col, raw] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(col)) continue;
    const dot = raw.indexOf(".");
    const op = raw.slice(0, dot);
    const val = raw.slice(dot + 1);
    const c = ident(col);
    switch (op) {
      case "eq": clauses.push(`${c} = ${lit(val)}`); break;
      case "neq": clauses.push(`${c} <> ${lit(val)}`); break;
      case "lt": clauses.push(`${c} < ${lit(val)}`); break;
      case "lte": clauses.push(`${c} <= ${lit(val)}`); break;
      case "gt": clauses.push(`${c} > ${lit(val)}`); break;
      case "gte": clauses.push(`${c} >= ${lit(val)}`); break;
      case "is":
        if (!["null", "true", "false"].includes(val)) throw new RestError(400, "42601", "bad is");
        clauses.push(`${c} is ${val}`);
        break;
      case "not.is": clauses.push(`${c} is not ${val === "null" ? "null" : "false"}`); break;
      case "in": {
        const items = val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/^"|"$/g, ""));
        clauses.push(`${c} in (${items.map(lit).join(",")})`);
        break;
      }
      default:
        throw new RestError(400, "42601", `emulator does not support filter ${op}`);
    }
  }
  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

function selectList(params: URLSearchParams): string {
  const s = params.get("select");
  if (!s || s === "*") return "*";
  return s.split(",").map((c) => ident(c.trim())).join(",");
}
function orderBy(params: URLSearchParams): string {
  const o = params.get("order");
  if (!o) return "";
  return "order by " + o.split(",").map((part) => {
    const [col, ...mods] = part.split(".");
    const dir = mods.includes("desc") ? "desc" : "asc";
    const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
    return `${ident(col!)} ${dir}${nulls}`;
  }).join(",");
}

type Role = { role: string; claims: Record<string, unknown> };

async function withRole<T>(db: PGlite, who: Role, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return (await db.transaction(async (tx) => {
    await tx.exec(`set local role ${who.role}`);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(who.claims)]);
    return fn(tx);
  })) as T;
}

async function jsonRows(tx: Transaction, sql: string): Promise<unknown[]> {
  const r = await tx.query<{ j: unknown[] | null }>(`select coalesce(json_agg(t), '[]'::json) as j from (${sql}) t`);
  return (r.rows[0]?.j ?? []) as unknown[];
}

async function mutate(tx: Transaction, cte: string): Promise<unknown[]> {
  const r = await tx.query<{ j: unknown[] | null }>(`with m as (${cte}) select coalesce(json_agg(m), '[]'::json) as j from m`);
  return (r.rows[0]?.j ?? []) as unknown[];
}

async function handleRest(db: PGlite, req: Request, url: URL, who: Role): Promise<Response> {
  const rel = url.pathname.replace(/^\/rest\/v1\//, "");
  const prefer = req.headers.get("prefer") ?? "";
  const wantsObject = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
  const p = url.searchParams;

  if (rel.startsWith("rpc/")) {
    const fn = ident(rel.slice(4));
    const args = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const named = Object.entries(args).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(", ");
    const out = await withRole(db, who, async (tx) => {
      const r = await tx.query<{ j: unknown }>(`select to_json(public.${fn}(${named})) as j`);
      return r.rows[0]?.j ?? null;
    });
    return Response.json(out);
  }

  const table = `public.${ident(rel)}`;
  const method = req.method;
  let rows: unknown[] = [];
  let count: number | null = null;

  if (method === "GET" || method === "HEAD") {
    rows = await withRole(db, who, async (tx) => {
      const limit = p.get("limit") ? `limit ${Number(p.get("limit"))}` : "";
      const offset = p.get("offset") ? `offset ${Number(p.get("offset"))}` : "";
      if (prefer.includes("count=")) {
        const c = await tx.query<{ n: number }>(`select count(*)::int as n from ${table} ${where(p)}`);
        count = c.rows[0]?.n ?? 0;
      }
      return jsonRows(tx, `select ${selectList(p)} from ${table} ${where(p)} ${orderBy(p)} ${limit} ${offset}`);
    });
  } else if (method === "POST") {
    const body = await req.json();
    const list = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[];
    const cols = [...new Set(list.flatMap((r) => Object.keys(r)))].map(ident);
    const resolution = prefer.includes("resolution=merge-duplicates") ? "merge"
      : prefer.includes("resolution=ignore-duplicates") ? "ignore" : null;
    let conflict = "";
    if (resolution) {
      const target = (p.get("on_conflict") ?? "id").split(",").map(ident).join(",");
      if (resolution === "ignore") conflict = `on conflict (${target}) do nothing`;
      else {
        const tgt = (p.get("on_conflict") ?? "id").split(",");
        const updates = cols.filter((c) => !tgt.includes(c.replace(/"/g, ""))).map((c) => `${c} = excluded.${c}`);
        conflict = updates.length ? `on conflict (${target}) do update set ${updates.join(",")}` : `on conflict (${target}) do nothing`;
      }
    }
    rows = await withRole(db, who, (tx) => mutate(tx,
      `insert into ${table} (${cols.join(",")})
         select ${cols.join(",")} from json_populate_recordset(null::${table}, ${lit(list)}::json)
         ${conflict} returning *`));
  } else if (method === "PATCH") {
    const body = (await req.json()) as Record<string, unknown>;
    const sets = Object.keys(body).map((k) => `${ident(k)} = r.${ident(k)}`).join(",");
    rows = await withRole(db, who, (tx) => mutate(tx,
      `update ${table} set ${sets} from json_populate_record(null::${table}, ${lit(body)}::json) r
         ${where(p).replace(/^where /, "where ").replace(/"(\w+)" /g, `${table}."$1" `)} returning ${table}.*`));
  } else if (method === "DELETE") {
    rows = await withRole(db, who, (tx) => mutate(tx, `delete from ${table} ${where(p)} returning *`));
  } else {
    throw new RestError(405, "PGRST", "method not allowed");
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (count !== null) headers.set("content-range", `0-${Math.max(rows.length - 1, 0)}/${count}`);
  if (method !== "GET" && method !== "HEAD" && !prefer.includes("return=representation")) {
    return new Response(null, { status: method === "POST" ? 201 : 204, headers });
  }
  if (method === "HEAD") return new Response(null, { status: 200, headers });
  if (wantsObject) {
    if (rows.length !== 1) {
      return Response.json(
        { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null },
        { status: 406 },
      );
    }
    return new Response(JSON.stringify(rows[0]), { status: method === "POST" ? 201 : 200, headers });
  }
  return new Response(JSON.stringify(rows), { status: method === "POST" ? 201 : 200, headers });
}

// ---- GoTrue subset ----------------------------------------------------------------------------

const hashPw = (pw: string) => createHash("sha256").update(pw).digest("hex");

function session(user: { id: string; email: string }) {
  const now = Math.floor(Date.now() / 1000);
  const expires_in = 3600;
  const shape = { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  return {
    access_token: sign({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + expires_in, session_id: randomUUID() }),
    refresh_token: sign({ sub: user.id, email: user.email, typ: "refresh", exp: now + 86400 * 30 }),
    token_type: "bearer",
    expires_in,
    expires_at: now + expires_in,
    user: shape,
  };
}

async function handleAuth(db: PGlite, req: Request, url: URL): Promise<Response> {
  const route = url.pathname.replace(/^\/auth\/v1/, "");
  const authErr = (status: number, code: string, msg: string) =>
    Response.json({ code: status, error_code: code, msg }, { status });
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");

  if (route === "/signup" && req.method === "POST") {
    const { email, password } = (await req.json()) as { email: string; password: string };
    if (!password || password.length < 6) return authErr(422, "weak_password", "Password should be at least 6 characters.");
    const exists = await db.query(`select 1 from auth.users where email = $1`, [email]);
    if (exists.rows.length) return authErr(422, "user_already_exists", "User already registered");
    const r = await db.query<{ id: string }>(`insert into auth.users (email, encrypted_password) values ($1,$2) returning id`, [email, hashPw(password)]);
    return Response.json(session({ id: r.rows[0]!.id, email }));
  }
  if (route === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    const body = (await req.json()) as { email?: string; password?: string; refresh_token?: string };
    if (grant === "password") {
      const r = await db.query<{ id: string; email: string }>(`select id, email from auth.users where email = $1 and encrypted_password = $2`, [body.email, hashPw(body.password ?? "")]);
      if (!r.rows[0]) return authErr(400, "invalid_credentials", "Invalid login credentials");
      return Response.json(session(r.rows[0]));
    }
    if (grant === "refresh_token") {
      const claims = verify(body.refresh_token ?? "");
      if (!claims || claims.typ !== "refresh") return authErr(400, "refresh_token_not_found", "Invalid Refresh Token");
      return Response.json(session({ id: String(claims.sub), email: String(claims.email) }));
    }
  }
  if (route === "/user" && req.method === "GET") {
    const claims = verify(bearer);
    if (!claims?.sub) return authErr(401, "bad_jwt", "invalid JWT");
    const r = await db.query<{ id: string; email: string }>(`select id, email from auth.users where id = $1`, [claims.sub]);
    if (!r.rows[0]) return authErr(401, "user_not_found", "User from sub claim in JWT does not exist");
    return Response.json({ ...session(r.rows[0]).user });
  }
  if (route === "/logout") return new Response(null, { status: 204 });
  if (route === "/admin/users" && req.method === "POST") {
    if (verify(bearer)?.role !== "service_role") return authErr(403, "not_admin", "forbidden");
    const { email, password } = (await req.json()) as { email: string; password: string };
    const r = await db.query<{ id: string }>(`insert into auth.users (email, encrypted_password) values ($1,$2) returning id`, [email, hashPw(password)]);
    return Response.json(session({ id: r.rows[0]!.id, email }).user);
  }
  if (route.startsWith("/admin/users/") && req.method === "DELETE") {
    if (verify(bearer)?.role !== "service_role") return authErr(403, "not_admin", "forbidden");
    await db.query(`delete from auth.users where id = $1`, [route.split("/").pop()]);
    return Response.json({});
  }
  return authErr(404, "not_found", `emulator does not implement ${req.method} ${route}`);
}

// ---- Fake PayPal sandbox ----------------------------------------------------------------------

type FakeOrder = {
  id: string;
  status: string;
  intent: string;
  purchase_units: { amount: { currency_code: string; value: string }; custom_id?: string; payments?: unknown }[];
  returnUrl: string;
  cancelUrl: string;
};

export type FakePaypal = {
  orders: Map<string, FakeOrder>;
  /** Next capture returns this capture status instead of COMPLETED. */
  nextCaptureStatus: string | null;
  captureCalls: number;
  createCalls: number;
  webhookSignatureValid: boolean;
  approve(id: string): void;
};

export function createFakePaypal(baseUrl: () => string): { state: FakePaypal; handle: (req: Request, url: URL) => Promise<Response> } {
  const orders = new Map<string, FakeOrder>();
  const seen = new Map<string, unknown>();
  const state: FakePaypal = {
    orders, nextCaptureStatus: null, captureCalls: 0, createCalls: 0, webhookSignatureValid: true,
    approve(id) { const o = orders.get(id); if (o) o.status = "APPROVED"; },
  };
  const publicOrder = (o: FakeOrder) => ({
    id: o.id, status: o.status, intent: o.intent, purchase_units: o.purchase_units,
    links: [
      { href: `${baseUrl()}/v2/checkout/orders/${o.id}`, rel: "self", method: "GET" },
      { href: `${baseUrl()}/checkoutnow?token=${o.id}`, rel: "payer-action", method: "GET" },
    ],
  });
  const err = (status: number, name: string, issue: string) =>
    Response.json({ name, message: name, debug_id: "fake-debug", details: [{ issue }] }, { status });

  async function handle(req: Request, url: URL): Promise<Response> {
    const route = url.pathname.replace(/^\/paypal-sandbox/, "");
    if (route === "/v1/oauth2/token") {
      if (!req.headers.get("authorization")?.startsWith("Basic ")) return Response.json({ error: "invalid_client", error_description: "Client Authentication failed" }, { status: 401 });
      return Response.json({ access_token: "fake-token", token_type: "Bearer", expires_in: 3600, app_id: "fake", scope: "fake", nonce: "fake" });
    }
    if (route === "/v2/checkout/orders" && req.method === "POST") {
      const rid = req.headers.get("paypal-request-id");
      if (rid && seen.has(rid)) return Response.json(seen.get(rid), { status: 200 });
      state.createCalls++;
      const body = (await req.json()) as { intent: string; purchase_units: FakeOrder["purchase_units"]; payment_source?: { paypal?: { experience_context?: { return_url?: string; cancel_url?: string } } } };
      const id = "FAKE" + randomUUID().replace(/-/g, "").slice(0, 13).toUpperCase();
      const ctx = body.payment_source?.paypal?.experience_context;
      const order: FakeOrder = { id, status: "PAYER_ACTION_REQUIRED", intent: body.intent, purchase_units: body.purchase_units, returnUrl: ctx?.return_url ?? "", cancelUrl: ctx?.cancel_url ?? "" };
      orders.set(id, order);
      const out = publicOrder(order);
      if (rid) seen.set(rid, out);
      return Response.json(out, { status: 201 });
    }
    if (route === "/checkoutnow") {
      const id = url.searchParams.get("token") ?? "";
      const o = orders.get(id);
      if (!o) return new Response("unknown order", { status: 404 });
      const amt = o.purchase_units[0]!.amount;
      return new Response(`<!doctype html><title>Fake PayPal</title><body style="font-family:sans-serif;max-width:420px;margin:60px auto">
        <h1>Fake PayPal (local emulator)</h1><p>Not PayPal. Local test double for development.</p><p><b>${amt.currency_code} ${amt.value}</b></p>
        <form method="post" action="${baseUrl()}/checkoutnow/approve?token=${id}"><button id="approve">Approve</button></form>
        <form method="post" action="${baseUrl()}/checkoutnow/cancel?token=${id}"><button id="cancel">Cancel</button></form></body>`,
        { headers: { "content-type": "text/html" } });
    }
    if (route === "/checkoutnow/approve" || route === "/checkoutnow/cancel") {
      const id = url.searchParams.get("token") ?? "";
      const o = orders.get(id);
      if (!o) return new Response("unknown order", { status: 404 });
      if (route.endsWith("approve")) o.status = "APPROVED";
      const dest = route.endsWith("approve") ? o.returnUrl : o.cancelUrl;
      const sep = dest.includes("?") ? "&" : "?";
      return new Response(null, { status: 303, headers: { location: `${dest}${sep}token=${id}&PayerID=FAKEPAYER` } });
    }
    const m = route.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/);
    if (m) {
      const o = orders.get(m[1]!);
      if (!o) return err(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID");
      if (!m[2]) return Response.json(publicOrder(o));
      const rid = req.headers.get("paypal-request-id");
      if (rid && seen.has(rid)) return Response.json(seen.get(rid), { status: 200 });
      state.captureCalls++;
      if (o.status === "COMPLETED") return err(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED");
      if (o.status !== "APPROVED") return err(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED");
      const capStatus = state.nextCaptureStatus ?? "COMPLETED";
      state.nextCaptureStatus = null;
      o.status = capStatus === "COMPLETED" ? "COMPLETED" : capStatus === "PENDING" ? "COMPLETED" : "APPROVED";
      o.purchase_units[0]!.payments = { captures: [{ id: "CAP" + randomUUID().slice(0, 8).toUpperCase(), status: capStatus, amount: o.purchase_units[0]!.amount, final_capture: true }] };
      const out = publicOrder(o);
      if (rid) seen.set(rid, out);
      return Response.json(out, { status: 201 });
    }
    if (route === "/v1/notifications/verify-webhook-signature") {
      return Response.json({ verification_status: state.webhookSignatureValid ? "SUCCESS" : "FAILURE" });
    }
    return err(404, "RESOURCE_NOT_FOUND", `emulator does not implement ${route}`);
  }
  return { state, handle };
}

// ---- Server -----------------------------------------------------------------------------------

export type Stack = {
  db: PGlite;
  paypal: FakePaypal;
  url: string;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  close(): Promise<void>;
};

export async function startStack(port = 0): Promise<Stack> {
  const db = await createDb();
  let base = "";
  const fake = createFakePaypal(() => `${base}/paypal-sandbox`);

  const route = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const cors = {
      "access-control-allow-origin": req.headers.get("origin") ?? "*",
      "access-control-allow-headers": "*, authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version",
      "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
      "access-control-expose-headers": "content-range",
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let res: Response;
    try {
      if (url.pathname.startsWith("/paypal-sandbox")) return await fake.handle(req, url);
      if (url.pathname.startsWith("/auth/v1")) res = await handleAuth(db, req, url);
      else if (url.pathname.startsWith("/rest/v1/")) {
        const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "") || req.headers.get("apikey") || "";
        const claims = verify(token);
        if (!claims) res = Response.json({ code: "PGRST301", message: "JWT invalid" }, { status: 401 });
        else res = await handleRest(db, req, url, { role: String(claims.role), claims });
      } else res = new Response("local stack", { status: 200 });
    } catch (e) {
      const pg = e as { code?: string; message?: string; status?: number; detail?: string };
      const code = pg.code ?? "XX000";
      const status = e instanceof RestError ? e.status
        : code === "42501" ? 403
        : code === "23505" ? 409
        : code === "P0002" ? 404 : 400;
      res = Response.json({ code, message: pg.message ?? "error", details: pg.detail ?? null, hint: null }, { status });
    }
    const out = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) out.set(k, v);
    return new Response(res.body, { status: res.status, headers: out });
  };

  const server = http.createServer(async (nreq, nres) => {
    const chunks: Buffer[] = [];
    for await (const c of nreq) chunks.push(c as Buffer);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (typeof v === "string") headers.set(k, v);
    const req = new Request(`http://${nreq.headers.host}${nreq.url}`, {
      method: nreq.method,
      headers,
      body: nreq.method === "GET" || nreq.method === "HEAD" ? undefined : body,
    });
    const res = await route(req);
    nres.writeHead(res.status, Object.fromEntries(res.headers));
    nres.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;

  return {
    db,
    paypal: fake.state,
    url: base,
    fetch: (input, init) => fetch(input, init),
    close: async () => {
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); });
      await db.close();
    },
  };
}
