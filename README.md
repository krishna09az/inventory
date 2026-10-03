# Inventory

A simple inventory app for phones, built with Expo (React Native). It tracks every delivery coming in and every dispatch going out, so stock is always the sum of its history. Data is backed up to Supabase per user account, while the app itself reads from a local copy, so it stays instant and works offline.

## What it does

- **Products**: name, SKU/code, low-stock alert level, notes.
- **Stock in**: each delivery is its own entry, with a date, quantity, price per unit and an optional supplier.
- **Stock out**: each dispatch records the date, quantity, client name and city.
- **Stock left** is calculated from the history (total in − total out). The app won't let stock go below zero.
- **Product page**: In / Out / Left totals, average purchase price, total spent, and the full dated history. Tap any entry to edit or delete it.
- **Inventory list**: search by name or SKU, with a filter for low-stock items.
- **Accounts**: email + password sign-in. Each account sees only its own data, on any phone it signs in on.

Example: Crystal Knobs, 20 units in on 30 Sep at ₹120 and 30 units in on 2 Oct. Then 6 units out to Mr. K (Bareilly) on 3 Oct and 3 units to Ms M (Delhi) on 4 Oct. The app shows **In 50 · Out 9 · Left 41**.

## Screens

1. **Sign in**: email and password, or create an account.
2. **Inventory**: the list of products and their stock. "Account" (top left) shows sync status and signs out.
3. **Product**: totals and history for one product.
4. **Add / Edit product**: when adding, you can also enter the first delivery.
5. **Stock in / Stock out**: add or edit an entry.

## How data is stored

```
 screens ──read/write──▶ SQLite on the phone (instant, offline)
                              │  ▲
                 upload edits │  │ download changes
                              ▼  │
                     Supabase Postgres (per-user, Row Level Security)
```

- Every edit is saved to the phone first, then uploaded about 1 second later. Sync also runs at sign-in and whenever the app comes back to the foreground.
- Without a connection, edits queue up on the phone ("N changes waiting to upload") and go up when you're back online.
- If two phones change the same entry, the last change to reach the server wins.
- Deletions are kept as flags (`deleted = true`) so other phones learn about them.
- Signing out clears this phone's copy. Your data stays in the cloud and comes back at the next sign-in.
- Data that existed on the phone before accounts were added is uploaded to the first account that signs in.

## Setup

Requires Node.js ≥ 20 and the [Expo Go](https://expo.dev/go) app on your phone.

### 1. Supabase project

1. Create a free project at [supabase.com](https://supabase.com/dashboard).
2. Create the tables and security rules with the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started): `supabase login`, `supabase link --project-ref <your-project-ref>`, then `supabase db push`. This applies everything in [`supabase/migrations/`](supabase/migrations). Alternatively, paste each migration file into **SQL Editor → New query** and click **Run**.
3. **Authentication → Sign In / Providers → Email**: email + password is on by default. "Confirm email" is also on by default, so new accounts must click a link in an email before signing in. Turn it off if you'd rather skip that step.
4. Copy the **Project URL** and the **publishable key** (Project Settings → API Keys).

### 2. App

```bash
npm install
cp .env.example .env.local   # then paste the URL and publishable key into .env.local
npx expo start --tunnel      # scan the QR code / open the exp:// URL in Expo Go
```

`--tunnel` works even when the phone can't reach the computer over Wi‑Fi. Without it, use `npx expo start` on the same network. Restart the dev server after editing `.env.local`.

In a browser: open http://localhost:8081 once the dev server is running. Web support for the local database is experimental.

## Website

The same app runs in the browser at **https://kraftbling-inventory.expo.app**: same sign-in, same data. It's hosted on [EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/). To publish changes:

```bash
npx expo export --platform web      # builds dist/ (reads the Supabase keys from .env.local)
npx eas-cli@latest deploy --prod
```

Each browser keeps its own local copy of the data, and signing out clears it. The browser database (expo-sqlite on web) is experimental in Expo.

## Android APK (private distribution)

Installable APKs are built in the cloud with [EAS Build](https://docs.expo.dev/build/introduction/) and shared by link, without the Play Store.

```bash
npx eas-cli@latest login                                   # once
npx eas-cli@latest build --platform android --profile preview
```

- The `preview` profile in `eas.json` produces an `.apk` with internal distribution. The version code goes up automatically on every build.
- The Supabase URL and publishable key come from EAS environment variables (environment `preview`), because `.env.local` isn't uploaded. If they ever change, update them too: `npx eas-cli@latest env:set --name EXPO_PUBLIC_SUPABASE_URL --value <url> --environment preview --visibility plaintext`.
- EAS stores the Android signing key. Every future APK must be signed with it for updates to install over an existing copy, so don't delete the credentials on expo.dev.
- When it finishes, the build page on expo.dev has a download link and QR code. Open it on the phone and install it. Android asks once to allow installs from the browser.
- Package ID: `com.kraftbling.inventory`.

## Checks

There are no automated tests. Before committing, run:

```bash
npx tsc --noEmit
npx expo lint
```

## Project layout

```
src/app/                 screens (Expo Router: one file per route)
src/db/inventory.ts      local database: schema, migrations, queries
src/db/sync.ts           upload/download between SQLite and Supabase
src/lib/supabase.ts      Supabase client (session stored on the phone)
src/providers/           signed-in user (auth) and sync status for the screens
src/utils/format.ts      dates (DD/MM/YYYY), ₹ formatting, number parsing
supabase/migrations/     server tables + Row Level Security (applied with supabase db push)
supabase/config.toml     Supabase CLI config
```

Schema changes go through numbered migrations in `src/db/inventory.ts` (on the phone) and `supabase/migrations/` (on the server: `supabase migration new <name>`, then `supabase db push`).

## Tech

Expo SDK 57 · React Native 0.86 · TypeScript · Expo Router · expo-sqlite · Supabase (Postgres + Auth) · React Compiler
