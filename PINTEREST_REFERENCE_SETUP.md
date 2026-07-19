# Pinterest Reference Setup

LadyTin Story Studio uses the official Pinterest API v5 with the minimum read scopes `boards:read` and `pins:read`. The production integration is implemented in the authenticated Supabase Edge Function at `supabase/functions/pinterest`.

## Pinterest developer app

1. Sign in to a Pinterest business account.
2. Open Pinterest Developers → My apps.
3. Create an app and request Trial or Standard API access.
4. Add this exact redirect URI: `https://ladytin-story-studio.vercel.app/project/pinterest/callback`.
5. Request only `boards:read` and `pins:read`.
6. Copy the App ID and App Secret after Pinterest approves the app.

Pinterest may require application review before board and Pin reads work outside test access.

## Supabase Edge Function secrets

Set these only as Supabase Edge Function secrets. Never expose them in browser code or Vercel public variables.

- `PINTEREST_APP_ID`
- `PINTEREST_APP_SECRET`
- `PINTEREST_REDIRECT_URI`
- `PINTEREST_BOARD_URL=https://pin.it/7mSBrJubi`
- `PINTEREST_OAUTH_STATE_SECRET` — at least 32 random characters
- `PINTEREST_TOKEN_ENCRYPTION_KEY` — at least 32 random characters

Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to the Edge Function. The service key stays server-side.

## OAuth and sync

The function supports `authorize`, `callback`, `status`, `sync`, and `disconnect`. OAuth state is HMAC-signed and expires after ten minutes. Pinterest access and refresh tokens are AES-GCM encrypted before database storage. The sync follows Pinterest pagination and upserts Pins by `(project_id, pinterest_pin_id)` so unchanged Pins are not duplicated.

## Snapshot fallback

The app works without Pinterest credentials or API approval. In **Assets & References**, import:

- a Pinterest JSON export,
- an object containing an `items` or `pins` array,
- one Pin URL per line,
- or a manually saved board snapshot.

The deterministic tagger, complete-set planner, four reference modes, prompts and ZIP packages work from snapshot data. No unauthorised HTML scraping is used.

## Reference modes

- **Pinterest Auto** — the complete-set planner selects the highest suitable Pin.
- **Pinterest Selected** — the user explicitly selects a Pin.
- **Manual Upload** — an uploaded image or PDF overrides Pinterest Auto.
- **Original Editorial Direction** — a complete original editorial specification generated from the story and source asset.

When no Pinterest candidate clears the suitability threshold, the slide falls back to Original Editorial Direction. Locked references are preserved during recalculation.

## ZIP behaviour

Pinterest-led packages contain `pinterest-reference.json` with the Pin URL, attribution, structured visual analysis, match score and match reason. A Pinterest preview binary is optional and is included only when legally permitted and successfully retrieved. A missing Pinterest binary does not block generation.

Manual references remain real binary files. Original Editorial Direction does not create an empty reference attachment.

## Testing

Run:

```bash
npm test
npm run lint
npm run build
```

Credential-dependent smoke testing requires a Pinterest-approved app and authenticated project members.
