# Supabase & Deployment Guide

Project: `ladytin-story-studio` — ref `exmvsczxgippzcbjdrrj`

Authentication surface: one shared password field and one Enter button only.

Preview source: the current shared-library feature branch.

## Browser-safe configuration

The build injects only:

```env
SUPABASE_URL=https://exmvsczxgippzcbjdrrj.supabase.co
SUPABASE_PUBLISHABLE_KEY=
```

No service-role key, raw application password, database password or Google client secret is exposed to the browser.

## Shared password access

The interface contains one password field and one Enter button. It has no account creation, address field, confirmation flow or forgotten-password flow.

The password is verified inside the `shared-access` Supabase Edge Function against a one-way bcrypt verifier stored in the private schema. After verification:

1. A short-lived one-time ticket is created server-side.
2. The browser creates an anonymous Supabase session.
3. The Edge Function consumes the ticket and adds a twelve-hour shared-access claim to that anonymous session.
4. RLS grants the valid shared session one honest `editor` role across cloud projects.

Failed attempts are locked for fifteen minutes after five failures. The raw password is never committed, returned, logged or stored in browser storage.

Required Supabase dashboard setting:

```text
Authentication → Providers → Anonymous Sign-Ins → Enable
```

`.env.example` includes an empty `APP_ACCESS_PASSWORD=` placeholder for secret-management workflows only. The live project stores only the protected verifier.

## Migrations

The baseline collaboration migrations remain idempotent. The active shared-access and library additions are:

- `20260719193000_shared_password_rate_limit.sql`
- `20260719194000_shared_password_verifier.sql`
- `20260719195000_anonymous_shared_access_tickets.sql`
- `20260719195500_shared_editor_role.sql`
- shared library schema migrations under `supabase/migrations/`

The older invitation schema is retained only as historical database compatibility. It is not exposed by the current interface or cloud module.

## Edge Functions

- `shared-access`: password verification, lockout, one-time ticket issue and anonymous-session activation.

## Verification

```sql
select * from private.verify_ladytin_security();
select tablename, policyname, cmd from pg_policies where schemaname='public' order by 1;
select tablename from pg_publication_tables where pubname='supabase_realtime';
```

Smoke test:

1. Open the deployed app and enter the shared password.
2. Refresh and confirm the session restores without another prompt.
3. Create or open a project and refresh `/project/{id}`.
4. Edit a slide in two separate browser contexts and verify Realtime and Presence.
5. Upload items to the Media Library and Reference Library, assign them to slides, refresh, then download and reopen individual and bulk ZIPs.
6. Sign out and confirm the password screen returns.

## Deploy

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Merge only after the preview build and browser checks pass.
