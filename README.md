# Inventory

A simple offline inventory app for phones, built with Expo (React Native). It tracks every delivery coming in and every dispatch going out, so stock is always the sum of its history.

## What it does

- **Products**: name, SKU/code, low-stock alert level, notes.
- **Stock in**: each delivery is its own entry, with a date, quantity, price per unit and an optional supplier.
- **Stock out**: each dispatch records the date, quantity, client name and city.
- **Stock left** is calculated from the history (total in − total out). The app won't let stock go below zero.
- **Product page**: In / Out / Left totals, average purchase price, total spent, and the full dated history. Tap any entry to edit or delete it.
- **Inventory list**: search by name or SKU, with a filter for low-stock items.

Example: Crystal Knobs, 20 units in on 30 Sep at ₹120 and 30 units in on 2 Oct. Then 6 units out to Mr. K (Bareilly) on 3 Oct and 3 units to Ms M (Delhi) on 4 Oct. The app shows **In 50 · Out 9 · Left 41**.

All data is stored on the device in SQLite. There is no account or server.

## Screens

1. **Inventory**: the list of products and their stock.
2. **Product**: totals and history for one product.
3. **Add / Edit product**: when adding, you can also enter the first delivery.
4. **Stock in / Stock out**: add or edit an entry.

## Running it

Requires Node.js ≥ 20 and the [Expo Go](https://expo.dev/go) app on your phone.

```bash
npm install
npx expo start --tunnel   # scan the QR code / open the exp:// URL in Expo Go
```

`--tunnel` works even when the phone can't reach the computer over Wi‑Fi. Without it, use `npx expo start` on the same network.

In a browser: open http://localhost:8081 once the dev server is running. Web support for the database is experimental, and browser data is separate from the phone's.

## Checks

There are no automated tests. Before committing, run:

```bash
npx tsc --noEmit
npx expo lint
```

## Project layout

```
src/app/            screens (Expo Router: one file per route)
src/db/inventory.ts all database code: schema, migrations, queries
src/utils/format.ts dates (DD/MM/YYYY), ₹ formatting, number parsing
src/components/     shared UI
src/constants/      colors and spacing
```

Schema changes go through numbered migrations in `src/db/inventory.ts`, so existing data on phones is upgraded in place.

## Tech

Expo SDK 57 · React Native 0.86 · TypeScript · Expo Router · expo-sqlite · React Compiler
