# Supabase & Deployment Guide

Project: `ladytin-story-studio` — ref `exmvsczxgippzcbjdrrj` — https://exmvsczxgippzcbjdrrj.supabase.co

## Browser-safe configuration

The build injects two public values (see `scripts/build.mjs`):

```env
SUPABASE_URL=https://exmvsczxgippzcbjdrrj.supabase.co
SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_… from Supabase → Settings → API keys
```

Set them locally in `.env` (then `set -a; source .env; npm run build`) and on Vercel as
project environment variables. No service-role key, database password or Pinterest
secret is ever exposed to the browser; the built bundle only contains the publishable key.

## Migrations

`supabase/migrations/` contains:

1. `20260719173023_baseline_collaboration_schema.sql` — idempotent representation of the
   schema that already exists in the live database (tables, RLS, storage policies,
   triggers, realtime publication). Do **not** re-run it blindly against production; it is
   a no-op there, but the intended use on a fresh checkout is
   `supabase migration repair --status applied 20260719173023`.
2. `20260719190000_invite_acceptance_and_pin_upsert_support.sql` — already applied to the
   live database. Adds `public.accept_project_invite(text)` and the
   `(project_id, pinterest_pin_id)` unique index used by Pin upserts.

## Edge Functions

`supabase/functions/pinterest/index.ts` is deployed (JWT verification on). Actions:
`status`, `authorize`, `callback`, `sync`, `disconnect`. Without the `PINTEREST_*`
secrets every action returns a safe `{configured:false}` payload and the frontend keeps
snapshot import and Original Editorial Direction available.

Secrets (Supabase → Edge Functions → Secrets — never in Vercel or the repo):

```env
PINTEREST_APP_ID=
PINTEREST_APP_SECRET=
PINTEREST_REDIRECT_URI=https://ladytin-story-studio.vercel.app/project/pinterest/callback
PINTEREST_BOARD_URL=https://pin.it/7mSBrJubi
PINTEREST_OAUTH_STATE_SECRET=   # ≥32 random characters
PINTEREST_TOKEN_ENCRYPTION_KEY= # ≥32 random characters
```

## Security verification queries

Run in the SQL editor:

```sql
-- Built-in check suite (RLS everywhere, token lockdown, private bucket)
select * from private.verify_ladytin_security();

-- Policies per table
select tablename, policyname, cmd from pg_policies where schemaname='public' order by 1;

-- Realtime publication
select tablename from pg_publication_tables where pubname='supabase_realtime';

-- Invitation function exists and is restricted
select proname, prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname='accept_project_invite';
```

## Authenticated smoke test

1. Open the deployed app, sign in via magic link.
2. Create a project; confirm the URL becomes `/project/{id}` and survives refresh.
3. Paste story copy in `01 Copy`, parse, confirm; watch the topbar flip Saving → Saved.
4. Upload a main asset in `03 Assets & References`; refresh; the file stays usable and a
   slide package ZIP downloads with real bytes.
5. Share Project → invite a second email as viewer; open the invite link in another
   browser as that user; confirm the viewer badge, read-only fields and working ZIP
   downloads.
6. Edit a slide in one browser and watch the other update within a few seconds.

## Manual dashboard actions still required

1. Supabase → Authentication → URL Configuration:
   - Site URL: `https://ladytin-story-studio.vercel.app`
   - Redirect URLs: `https://ladytin-story-studio.vercel.app/**` and `http://localhost:4173/**`
2. Supabase → Edge Functions → Secrets: the `PINTEREST_*` values above once Pinterest
   developer access is approved.
3. Optional: replace the default Supabase email provider with custom SMTP for production
   magic-link volume (the default provider is rate-limited).

## Deploy

```bash
npm test && npm run build            # tests gate the build
npx vercel deploy                    # preview from the feature branch
npx vercel --prod                    # production after the PR merges
```
