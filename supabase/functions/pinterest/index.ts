// LadyTin Story Studio — Pinterest integration (official API v5 only).
// Secrets live exclusively as Supabase Edge Function secrets. When they are not
// configured every action degrades to a safe {configured:false} response so the
// frontend can fall back to snapshot import and Original Editorial Direction.
import {createClient} from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const APP_ID = Deno.env.get('PINTEREST_APP_ID') ?? '';
const APP_SECRET = Deno.env.get('PINTEREST_APP_SECRET') ?? '';
const REDIRECT_URI = Deno.env.get('PINTEREST_REDIRECT_URI') ?? '';
const BOARD_URL = Deno.env.get('PINTEREST_BOARD_URL') ?? 'https://pin.it/7mSBrJubi';
const STATE_SECRET = Deno.env.get('PINTEREST_OAUTH_STATE_SECRET') ?? '';
const TOKEN_KEY = Deno.env.get('PINTEREST_TOKEN_ENCRYPTION_KEY') ?? '';

const configured = () => Boolean(APP_ID && APP_SECRET && REDIRECT_URI && STATE_SECRET && TOKEN_KEY);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const enc = new TextEncoder();
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(STATE_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}
async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(body)}`;
}
async function verifyState(state: string): Promise<Record<string, unknown> | null> {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromB64u(body)));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
async function aesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(TOKEN_KEY));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv}, await aesKey(), enc.encode(plain)));
  return `${b64u(iv)}.${b64u(cipher)}`;
}
async function decrypt(stored: string): Promise<string> {
  const [iv, cipher] = stored.split('.');
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: fromB64u(iv)}, await aesKey(), fromB64u(cipher));
  return new TextDecoder().decode(plain);
}

async function requireUser(req: Request) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {global: {headers: {Authorization: req.headers.get('Authorization') ?? ''}}});
  const {data, error} = await client.auth.getUser();
  if (error || !data.user) throw new Error('You must be signed in.');
  return data.user;
}
async function requireRole(projectId: string, userId: string, roles: string[]) {
  const {data} = await admin.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  if (!data || !roles.includes(data.role)) throw new Error('You do not have permission to manage Pinterest for this project.');
  return data.role;
}

async function tokenRequest(body: URLSearchParams) {
  const res = await fetch('https://api.pinterest.com/v5/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${APP_ID}:${APP_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Pinterest token request failed (${res.status}).`);
  return data;
}
async function accessTokenFor(projectId: string): Promise<string> {
  const {data: conn} = await admin.from('pinterest_connections').select('*').eq('project_id', projectId).maybeSingle();
  if (!conn) throw new Error('Pinterest is not connected for this project.');
  const expires = conn.access_token_expires_at ? new Date(conn.access_token_expires_at).getTime() : 0;
  if (expires > Date.now() + 60_000) return decrypt(conn.access_token_ciphertext);
  if (!conn.refresh_token_ciphertext) throw new Error('The Pinterest access token expired and no refresh token is stored. Reconnect Pinterest.');
  const refreshed = await tokenRequest(new URLSearchParams({grant_type: 'refresh_token', refresh_token: await decrypt(conn.refresh_token_ciphertext)}));
  await admin.from('pinterest_connections').update({
    access_token_ciphertext: await encrypt(refreshed.access_token),
    access_token_expires_at: new Date(Date.now() + (refreshed.expires_in ?? 3600) * 1000).toISOString(),
    ...(refreshed.refresh_token ? {refresh_token_ciphertext: await encrypt(refreshed.refresh_token)} : {}),
  }).eq('project_id', projectId);
  return refreshed.access_token;
}
async function api(token: string, path: string) {
  const res = await fetch(`https://api.pinterest.com/v5${path}`, {headers: {Authorization: `Bearer ${token}`}});
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Pinterest API request failed (${res.status}).`);
  return data;
}
async function resolveBoardId(token: string, boardUrl: string): Promise<string> {
  // pin.it short links redirect to the canonical board URL.
  let canonical = boardUrl;
  try {
    const res = await fetch(boardUrl, {redirect: 'follow'});
    canonical = res.url || boardUrl;
  } catch { /* keep the configured URL */ }
  const slug = canonical.split('?')[0].split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
  let bookmark = '';
  do {
    const page = await api(token, `/boards?page_size=100${bookmark ? `&bookmark=${bookmark}` : ''}`);
    for (const board of page.items ?? []) {
      const name = String(board.name ?? '').toLowerCase().replaceAll(' ', '-');
      if (board.id === slug || name === slug || name.includes(slug) || slug.includes(name)) return board.id;
    }
    bookmark = page.bookmark ?? '';
  } while (bookmark);
  const first = await api(token, '/boards?page_size=1');
  if (first.items?.[0]) return first.items[0].id;
  throw new Error('No Pinterest board could be resolved for this account.');
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({error: 'POST only.'}, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const action = String(body.action ?? '');
  if (!configured()) {
    return json({configured: false, connected: false, message: 'Pinterest OAuth is not configured. Set the PINTEREST_* Edge Function secrets. Snapshot import and Original Editorial Direction remain fully available.'});
  }
  try {
    const user = await requireUser(req);
    const projectId = String(body.project_id ?? '');

    if (action === 'status') {
      await requireRole(projectId, user.id, ['owner', 'editor', 'viewer']);
      const {data: conn} = await admin.from('pinterest_connections').select('project_id,board_url,board_id,last_synced_at,scope').eq('project_id', projectId).maybeSingle();
      return json({configured: true, connected: Boolean(conn), board_url: conn?.board_url ?? BOARD_URL, last_synced_at: conn?.last_synced_at ?? null});
    }
    if (action === 'authorize') {
      await requireRole(projectId, user.id, ['owner', 'editor']);
      const state = await signState({project_id: projectId, user_id: user.id, exp: Date.now() + 10 * 60 * 1000});
      const url = new URL('https://www.pinterest.com/oauth/');
      url.searchParams.set('client_id', APP_ID);
      url.searchParams.set('redirect_uri', REDIRECT_URI);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'boards:read,pins:read');
      url.searchParams.set('state', state);
      return json({configured: true, authorize_url: url.href});
    }
    if (action === 'callback') {
      const payload = await verifyState(String(body.state ?? ''));
      if (!payload || payload.user_id !== user.id) throw new Error('The OAuth state is invalid or expired. Start the connection again.');
      const callbackProject = String(payload.project_id);
      await requireRole(callbackProject, user.id, ['owner', 'editor']);
      const tokens = await tokenRequest(new URLSearchParams({grant_type: 'authorization_code', code: String(body.code ?? ''), redirect_uri: REDIRECT_URI}));
      const me = await api(tokens.access_token, '/user_account');
      await admin.from('pinterest_connections').upsert({
        project_id: callbackProject,
        connected_by: user.id,
        pinterest_user_id: me?.username ?? null,
        board_url: BOARD_URL,
        access_token_ciphertext: await encrypt(tokens.access_token),
        refresh_token_ciphertext: tokens.refresh_token ? await encrypt(tokens.refresh_token) : null,
        scope: 'boards:read pins:read',
        access_token_expires_at: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
        refresh_token_expires_at: tokens.refresh_token_expires_in ? new Date(Date.now() + tokens.refresh_token_expires_in * 1000).toISOString() : null,
      }, {onConflict: 'project_id'});
      return json({configured: true, connected: true, project_id: callbackProject});
    }
    if (action === 'sync') {
      await requireRole(projectId, user.id, ['owner', 'editor']);
      const token = await accessTokenFor(projectId);
      const {data: conn} = await admin.from('pinterest_connections').select('*').eq('project_id', projectId).single();
      let boardId = conn.board_id;
      if (!boardId) {
        boardId = await resolveBoardId(token, conn.board_url || BOARD_URL);
        await admin.from('pinterest_connections').update({board_id: boardId}).eq('project_id', projectId);
      }
      let bookmark = '', count = 0;
      do {
        const page = await api(token, `/boards/${boardId}/pins?page_size=100${bookmark ? `&bookmark=${bookmark}` : ''}`);
        const rows = (page.items ?? []).map((pin: Record<string, any>) => ({
          project_id: projectId,
          pinterest_pin_id: String(pin.id),
          board_id: String(boardId),
          pin_url: `https://www.pinterest.com/pin/${pin.id}/`,
          title: String(pin.title ?? ''),
          description: String(pin.description ?? ''),
          alt_text: String(pin.alt_text ?? ''),
          dominant_colour: pin.dominant_color ?? null,
          thumbnail_url: pin.media?.images?.['600x']?.url ?? pin.media?.images?.originals?.url ?? null,
          source_domain: (() => { try { return pin.link ? new URL(pin.link).hostname : null; } catch { return null; } })(),
          synced_at: new Date().toISOString(),
          visual_tags: {},
          design_analysis: {},
          analysis_hash: '',
          raw_metadata: pin,
        }));
        if (rows.length) {
          const {error} = await admin.from('pinterest_pins').upsert(rows, {onConflict: 'project_id,pinterest_pin_id'});
          if (error) throw new Error(error.message);
          count += rows.length;
        }
        bookmark = page.bookmark ?? '';
      } while (bookmark);
      await admin.from('pinterest_connections').update({last_synced_at: new Date().toISOString()}).eq('project_id', projectId);
      return json({configured: true, connected: true, count});
    }
    if (action === 'disconnect') {
      await requireRole(projectId, user.id, ['owner', 'editor']);
      await admin.from('pinterest_connections').delete().eq('project_id', projectId);
      return json({configured: true, connected: false});
    }
    return json({error: `Unknown action "${action}".`}, 400);
  } catch (error) {
    return json({error: error instanceof Error ? error.message : String(error)}, 400);
  }
});
