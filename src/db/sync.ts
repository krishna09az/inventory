import type { SupabaseClient } from '@supabase/supabase-js';
import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Two-way sync between the local SQLite cache and Supabase.
 *
 * - Screens only ever read/write SQLite (instant, works offline).
 * - Push: rows with `dirty = 1` are upserted to Supabase, then marked clean
 *   (unless they were edited again while uploading).
 * - Pull: rows whose server `updated_at` is newer than the last pull are applied
 *   locally, except over rows that still have unsent local edits.
 * - Conflicts: last write to reach the server wins.
 */

const PAGE_SIZE = 500;
/** Re-pull a small window before the cursor so rows committed slightly out of order aren't missed. */
const PULL_OVERLAP_MS = 30_000;

type ServerItem = {
  id: string;
  name: string;
  sku: string;
  low_stock_at: number;
  notes: string;
  deleted: boolean;
  updated_at: string;
};

type ServerMovement = {
  id: string;
  item_id: string;
  type: 'in' | 'out';
  quantity: number;
  unit_price: number | null;
  party: string;
  city: string;
  date: string;
  notes: string;
  created_at: string;
  deleted: boolean;
  updated_at: string;
};

type LocalItemRow = {
  id: string;
  name: string;
  sku: string;
  lowStockAt: number;
  notes: string;
  updatedAt: number;
  deleted: number;
};

type LocalMovementRow = {
  id: string;
  itemId: string;
  type: 'in' | 'out';
  quantity: number;
  unitPrice: number | null;
  party: string;
  city: string;
  date: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  deleted: number;
};

export type SyncResult = { pushed: number; pulled: number };

// --- meta (key/value sync state) ---

async function getMeta(db: SQLiteDatabase, key: string) {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

async function setMeta(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
}

/** Wipes the local cache (used on sign-out so the next account starts clean). */
export async function clearLocalData(db: SQLiteDatabase) {
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM movements; DELETE FROM items; DELETE FROM meta;');
  });
}

/**
 * Makes the local cache belong to `userId`.
 * - Same owner: nothing to do.
 * - No owner yet (data from before sign-in existed): adopt it, so it uploads.
 * - Different owner: wipe and start fresh (their data stays in the cloud).
 */
export async function prepareLocalDataForUser(db: SQLiteDatabase, userId: string) {
  const owner = await getMeta(db, 'ownerId');
  if (owner === userId) return;
  if (owner === null) {
    await db.withTransactionAsync(async () => {
      await db.execAsync('UPDATE items SET dirty = 1; UPDATE movements SET dirty = 1;');
      await setMeta(db, 'ownerId', userId);
    });
    return;
  }
  await clearLocalData(db);
  await setMeta(db, 'ownerId', userId);
}

/** Number of local rows not yet uploaded. */
export async function countPendingChanges(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT (SELECT COUNT(*) FROM items WHERE dirty = 1) + (SELECT COUNT(*) FROM movements WHERE dirty = 1) AS n'
  );
  return row?.n ?? 0;
}

export async function syncOnce(db: SQLiteDatabase, supabase: SupabaseClient): Promise<SyncResult> {
  // Items first: the server requires a movement's item to exist.
  const pushed = (await pushItems(db, supabase)) + (await pushMovements(db, supabase));
  const pulled = await pull(db, supabase);
  return { pushed, pulled };
}

// --- push ---

async function pushItems(db: SQLiteDatabase, supabase: SupabaseClient) {
  const rows = await db.getAllAsync<LocalItemRow>(
    'SELECT id, name, sku, lowStockAt, notes, updatedAt, deleted FROM items WHERE dirty = 1'
  );
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const chunk = rows.slice(i, i + PAGE_SIZE);
    const { error } = await supabase.from('items').upsert(
      chunk.map((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        low_stock_at: r.lowStockAt,
        notes: r.notes,
        deleted: r.deleted === 1,
      }))
    );
    if (error) throw new Error(error.message);
    await markClean(db, 'items', chunk);
  }
  return rows.length;
}

async function pushMovements(db: SQLiteDatabase, supabase: SupabaseClient) {
  const rows = await db.getAllAsync<LocalMovementRow>(
    `SELECT id, itemId, type, quantity, unitPrice, party, city, date, notes, createdAt, updatedAt, deleted
     FROM movements WHERE dirty = 1`
  );
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const chunk = rows.slice(i, i + PAGE_SIZE);
    const { error } = await supabase.from('movements').upsert(
      chunk.map((r) => ({
        id: r.id,
        item_id: r.itemId,
        type: r.type,
        quantity: r.quantity,
        unit_price: r.unitPrice,
        party: r.party,
        city: r.city,
        date: r.date,
        notes: r.notes,
        created_at: new Date(r.createdAt).toISOString(),
        deleted: r.deleted === 1,
      }))
    );
    if (error) throw new Error(error.message);
    await markClean(db, 'movements', chunk);
  }
  return rows.length;
}

/** Clears `dirty` only on rows not edited again since they were read for upload. */
async function markClean(db: SQLiteDatabase, table: 'items' | 'movements', rows: { id: string; updatedAt: number }[]) {
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE id = ? AND updatedAt = ?`, r.id, r.updatedAt);
    }
  });
}

// --- pull ---

async function pull(db: SQLiteDatabase, supabase: SupabaseClient) {
  const cursor = await getMeta(db, 'pulledUntil');
  const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;

  const items = await fetchChanged<ServerItem>(supabase, 'items', since);
  const movements = await fetchChanged<ServerMovement>(supabase, 'movements', since);

  const latest = [...items, ...movements].reduce<string | null>(
    (max, r) => (max === null || Date.parse(r.updated_at) > Date.parse(max) ? r.updated_at : max),
    cursor
  );

  // `WHERE dirty = 0` on conflict: never overwrite local edits that haven't uploaded yet.
  let changed = 0;
  await db.withTransactionAsync(async () => {
    for (const r of items) {
      const result = await db.runAsync(
        `INSERT INTO items (id, name, sku, lowStockAt, notes, updatedAt, deleted, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, sku = excluded.sku, lowStockAt = excluded.lowStockAt,
           notes = excluded.notes, updatedAt = excluded.updatedAt, deleted = excluded.deleted
         WHERE items.dirty = 0 AND items.updatedAt != excluded.updatedAt`,
        r.id,
        r.name,
        r.sku,
        r.low_stock_at,
        r.notes,
        Date.parse(r.updated_at),
        r.deleted ? 1 : 0
      );
      changed += result.changes;
    }
    for (const r of movements) {
      const result = await db.runAsync(
        `INSERT INTO movements (id, itemId, type, quantity, unitPrice, party, city, date, notes, createdAt, updatedAt, deleted, dirty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET itemId = excluded.itemId, type = excluded.type, quantity = excluded.quantity,
           unitPrice = excluded.unitPrice, party = excluded.party, city = excluded.city, date = excluded.date,
           notes = excluded.notes, createdAt = excluded.createdAt, updatedAt = excluded.updatedAt, deleted = excluded.deleted
         WHERE movements.dirty = 0 AND movements.updatedAt != excluded.updatedAt`,
        r.id,
        r.item_id,
        r.type,
        r.quantity,
        r.unit_price === null ? null : Number(r.unit_price),
        r.party,
        r.city,
        r.date,
        r.notes,
        Date.parse(r.created_at),
        Date.parse(r.updated_at),
        r.deleted ? 1 : 0
      );
      changed += result.changes;
    }
    if (latest) await setMeta(db, 'pulledUntil', latest);
  });

  return changed;
}

async function fetchChanged<T>(supabase: SupabaseClient, table: 'items' | 'movements', since: string | null) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table).select('*').order('updated_at').order('id').range(from, from + PAGE_SIZE - 1);
    if (since) query = query.gt('updated_at', since);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    rows.push(...(data as T[]));
    if (data.length < PAGE_SIZE) return rows;
  }
}
