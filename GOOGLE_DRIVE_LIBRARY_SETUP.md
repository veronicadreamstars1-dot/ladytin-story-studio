# Google Drive Library Setup

LadyTin Story Studio can use Google Drive as the original-file source for the shared Reference Library and Media Asset Library. Supabase remains the source of truth for metadata, assignments, tags, collections, archive state, usage and Realtime.

## Google Cloud

1. Create or open a Google Cloud project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create a Web OAuth client.
5. Add the production redirect URI used by the server-side callback.
6. Use the narrow Drive scope `https://www.googleapis.com/auth/drive.file` unless a selected existing folder flow requires broader access.

## Server Secrets

Set these only in protected server or Supabase Edge Function settings. Do not expose them through browser config.

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_OAUTH_STATE_SECRET=
GOOGLE_TOKEN_ENCRYPTION_KEY=
```

## Folder Structure

The app expects either a selected existing root folder or a generated structure:

```text
LadyTin Story Studio/
Reference Library/
Collections/
Unsorted/
Media Asset Library/
Collections/
Unsorted/
```

## Sync Behaviour

Sync should index supported files, store stable Drive file IDs, update renamed or moved files, archive missing Drive files, and preserve existing slide assignments. Supported originals are JPG, JPEG, PNG, WEBP, GIF, HEIC where available, SVG, PDF, MP4, MOV and M4V.

Native Google Docs, Sheets, Slides and Drawings are not treated as generation binaries.

## Current App State

When Drive secrets are absent, the app shows `Google Drive is not configured yet.` Shared library uploads use private Supabase Storage and remain reusable across projects.
