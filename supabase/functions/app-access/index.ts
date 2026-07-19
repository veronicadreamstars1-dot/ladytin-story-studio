import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Attempt = { count: number; lockedUntil: number; windowStart: number };
const attempts = new Map<string, Attempt>();
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const SHARED_EMAIL = "shared-access@ladytin-story-studio.local";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clientKey(req: Request) {
  return (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown")
    .split(",")[0]
    .trim()
    .slice(0, 96);
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function currentAttempt(key: string) {
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || now - row.windowStart > WINDOW_MS) return { count: 0, lockedUntil: 0, windowStart: now };
  return row;
}

function registerFailure(key: string) {
  const row = currentAttempt(key);
  row.count += 1;
  if (row.count >= MAX_FAILURES) row.lockedUntil = Date.now() + LOCK_MS;
  attempts.set(key, row);
}

async function ensureSharedUser(supabaseUrl: string, serviceKey: string, accessPassword: string) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      email: SHARED_EMAIL,
      password: accessPassword,
      email_confirm: true,
      user_metadata: { app: "LadyTin Story Studio", auth_model: "shared_password" },
    }),
  });
  if (res.ok || res.status === 422 || res.status === 400) return;
  throw new Error("Shared access identity could not be prepared.");
}

async function createSession(supabaseUrl: string, anonKey: string, serviceKey: string, accessPassword: string) {
  await ensureSharedUser(supabaseUrl, serviceKey, accessPassword);
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email: SHARED_EMAIL, password: accessPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.access_token || !data?.refresh_token) throw new Error("Shared access session could not be created.");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: data.expires_at,
    token_type: data.token_type,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const key = clientKey(req);
  const attempt = currentAttempt(key);
  if (attempt.lockedUntil > Date.now()) return json({ error: "Too many incorrect attempts. Try again shortly." }, 429);

  const expected = Deno.env.get("APP_ACCESS_PASSWORD") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!expected || !supabaseUrl || !anonKey || !serviceKey) return json({ error: "Password access is not configured." }, 503);

  let submitted = "";
  try {
    const body = await req.json();
    submitted = typeof body?.password === "string" ? body.password : "";
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  const ok = timingSafeEqual(await sha256(submitted), await sha256(expected));
  if (!ok) {
    registerFailure(key);
    return json({ error: "Incorrect password." }, 401);
  }

  attempts.delete(key);
  try {
    const session = await createSession(supabaseUrl, anonKey, serviceKey, expected);
    return json({ session, auth_model: "shared_password" });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not create access session." }, 500);
  }
});
