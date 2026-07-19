import crypto from 'node:crypto';

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const SHARED_EMAIL = 'shared-access@ladytin-story-studio.local';

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(body));
}

function clientKey(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0]
    .trim()
    .slice(0, 96);
}

function currentAttempt(key) {
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || now - row.windowStart > WINDOW_MS) return { count: 0, lockedUntil: 0, windowStart: now };
  return row;
}

function registerFailure(key) {
  const row = currentAttempt(key);
  row.count += 1;
  if (row.count >= MAX_FAILURES) row.lockedUntil = Date.now() + LOCK_MS;
  attempts.set(key, row);
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function safeCompare(a, b) {
  const left = digest(a);
  const right = digest(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function ensureSharedUser(supabaseUrl, serviceKey, accessPassword) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      email: SHARED_EMAIL,
      password: accessPassword,
      email_confirm: true,
      user_metadata: { app: 'LadyTin Story Studio', auth_model: 'shared_password' },
    }),
  });
  if (response.ok || response.status === 400 || response.status === 422) return;
  throw new Error('Shared access identity could not be prepared.');
}

async function createSupabaseSession(accessPassword) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !publicKey || !serviceKey) throw new Error('Password access is not configured.');

  await ensureSharedUser(supabaseUrl, serviceKey, accessPassword);
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publicKey },
    body: JSON.stringify({ email: SHARED_EMAIL, password: accessPassword }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token || !data?.refresh_token) throw new Error('Shared access session could not be created.');
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    expires_at: data.expires_at,
    token_type: data.token_type,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' });

  const key = clientKey(req);
  const attempt = currentAttempt(key);
  if (attempt.lockedUntil > Date.now()) return send(res, 429, { error: 'Too many incorrect attempts. Try again shortly.' });

  const expected = process.env.APP_ACCESS_PASSWORD || '';
  if (!expected) return send(res, 503, { error: 'Password access is not configured.' });

  const submitted = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeCompare(submitted, expected)) {
    registerFailure(key);
    return send(res, 401, { error: 'Incorrect password.' });
  }

  attempts.delete(key);
  try {
    const session = await createSupabaseSession(expected);
    return send(res, 200, { session, auth_model: 'shared_password' });
  } catch (error) {
    return send(res, 500, { error: error instanceof Error ? error.message : 'Could not create access session.' });
  }
}
