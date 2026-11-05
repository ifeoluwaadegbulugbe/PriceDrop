import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError } from "@/lib/api/errors";
import { isSupabaseConfigured } from "@/lib/env";
import { createServerSupabase } from "@/lib/supabase/server";

export type ApiFailure = { error: { code: string; message: string } & Record<string, unknown> };

/** Wraps a handler so failures have one typed shape and internals never leak. */
export function route<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json(
          { error: { code: e.code, message: e.publicMessage, ...e.extra } } satisfies ApiFailure,
          { status: e.status },
        );
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "That request wasn't valid." } } satisfies ApiFailure,
          { status: 400 },
        );
      }
      console.error(`route_error ${new URL(req.url).pathname}: ${e instanceof Error ? e.name : "unknown"}`);
      return NextResponse.json(
        { error: { code: "internal_error", message: "Something went wrong on our side." } } satisfies ApiFailure,
        { status: 500 },
      );
    }
  };
}

export async function requireUser(): Promise<{ id: string; email: string | null }> {
  if (!isSupabaseConfigured()) {
    throw new ApiError(503, "not_configured", "This deployment isn't connected to a database yet.");
  }
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new ApiError(401, "unauthenticated", "Please log in.");
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be JSON.");
  }
  return schema.parse(body);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // Compare against self on length mismatch so timing doesn't reveal length.
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
