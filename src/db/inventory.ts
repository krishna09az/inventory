import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

export type Item = {
  id: string;
  name: string;
  sku: string;
  /** Current stock: total inbound minus total outbound (derived from `movements`). */
  quantity: number;
  lowStockAt: number;
  notes: string;
  updatedAt: number;
};

export type ItemInput = Pick<Item, 'name' | 'sku' | 'lowStockAt' | 'notes'>;

export type MovementType = 'in' | 'out';

/** One stock entry: an inbound purchase or an outbound dispatch to a client. */
export type Movement = {
  id: string;
  itemId: string;
  type: MovementType;
  quantity: number;
  /** Purchase price per unit (inbound only). */
  unitPrice: number | null;
  /** Supplier for inbound, client name for outbound. */
  party: string;
  /** Client city (outbound only). */
  city: string;
  /** Calendar date as `YYYY-MM-DD`. */
  date: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

export type MovementInput = Pick<Movement, 'quantity' | 'unitPrice' | 'party' | 'city' | 'date' | 'notes'>;

export type ItemTotals = {
  totalIn: number;
  totalOut: number;
  /** Sum of quantity × unitPrice over inbound entries that have a price. */
  purchaseValue: number;
  /** Units covered by `purchaseValue` (inbound entries that have a price). */
  pricedUnits: number;
};

const DATABASE_VERSION = 3;

/** SQLite expression producing a random v4 UUID (used by the v3 migration). */
const SQL_UUID = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2)
  || '-' || substr('89AB', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentVersion = result?.user_version ?? 0;
  if (currentVersion >= DATABASE_VERSION) {
    return;
  }

  if (currentVersion === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE items (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0,
        lowStockAt INTEGER NOT NULL DEFAULT 5,
        notes TEXT NOT NULL DEFAULT '',
        updatedAt INTEGER NOT NULL
      );
    `);
    currentVersion = 1;
  }

  if (currentVersion === 1) {
    // Stock now comes from movements; items.quantity is left in place but no longer read.
    // Existing quantities become an "Opening stock" inbound entry so nothing is lost.
    await db.execAsync(`
      CREATE TABLE movements (
        id INTEGER PRIMARY KEY NOT NULL,
        itemId INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('in', 'out')),
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unitPrice REAL,
        party TEXT NOT NULL DEFAULT '',
        city TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        createdAt INTEGER NOT NULL
      );
      CREATE INDEX movements_item_date ON movements (itemId, date);
      INSERT INTO movements (itemId, type, quantity, date, notes, createdAt)
        SELECT id, 'in', quantity, date(updatedAt / 1000, 'unixepoch', 'localtime'), 'Opening stock', updatedAt
        FROM items WHERE quantity > 0;
    `);
    currentVersion = 2;
  }

  if (currentVersion === 2) {
    // Cloud sync: UUID ids (unique across devices), soft deletes (`deleted`) so deletions
    // sync, and `dirty` = changed locally and not yet uploaded. Existing rows start dirty
    // so they upload on first sign-in. `meta` holds sync state (owner, pull cursor).
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TEMP TABLE item_ids AS SELECT id AS oldId, ${SQL_UUID} AS newId FROM items;

        CREATE TABLE items_v3 (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          sku TEXT NOT NULL DEFAULT '',
          lowStockAt INTEGER NOT NULL DEFAULT 5,
          notes TEXT NOT NULL DEFAULT '',
          updatedAt INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          dirty INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO items_v3 (id, name, sku, lowStockAt, notes, updatedAt)
          SELECT m.newId, i.name, i.sku, i.lowStockAt, i.notes, i.updatedAt
          FROM items i JOIN item_ids m ON m.oldId = i.id;

        CREATE TABLE movements_v3 (
          id TEXT PRIMARY KEY NOT NULL,
          itemId TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('in', 'out')),
          quantity INTEGER NOT NULL CHECK (quantity > 0),
          unitPrice REAL,
          party TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL DEFAULT '',
          date TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0,
          dirty INTEGER NOT NULL DEFAULT 1
        );
        INSERT INTO movements_v3 (id, itemId, type, quantity, unitPrice, party, city, date, notes, createdAt, updatedAt)
          SELECT ${SQL_UUID}, m.newId, mv.type, mv.quantity, mv.unitPrice, mv.party, mv.city, mv.date, mv.notes,
                 mv.createdAt, mv.createdAt
          FROM movements mv JOIN item_ids m ON m.oldId = mv.itemId;

        DROP TABLE movements;
        DROP TABLE items;
        DROP TABLE item_ids;
        ALTER TABLE items_v3 RENAME TO items;
        ALTER TABLE movements_v3 RENAME TO movements;
        CREATE INDEX movements_item_date ON movements (itemId, date);
        CREATE INDEX items_dirty ON items (dirty);
        CREATE INDEX movements_dirty ON movements (dirty);

        CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      `);
    });
    currentVersion = 3;
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

// --- Change notifications (the sync engine listens to upload local edits) ---

const changeListeners = new Set<() => void>();

export function onLocalChange(listener: () => void) {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

function notifyLocalChange() {
  changeListeners.forEach((listener) => listener());
}

// --- Items ---

const STOCK_SQL = `COALESCE((SELECT SUM(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END)
  FROM movements m WHERE m.itemId = items.id AND m.deleted = 0), 0)`;

const ITEM_COLUMNS = `id, name, sku, lowStockAt, notes, updatedAt, ${STOCK_SQL} AS quantity`;

export function listItems(db: SQLiteDatabase) {
  return db.getAllAsync<Item>(
    `SELECT ${ITEM_COLUMNS} FROM items WHERE deleted = 0 ORDER BY name COLLATE NOCASE`
  );
}

export function getItem(db: SQLiteDatabase, id: string) {
  return db.getFirstAsync<Item>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ? AND deleted = 0`, id);
}

/** Creates a product, optionally with its first inbound entry. Returns the new item id. */
export async function createItem(db: SQLiteDatabase, input: ItemInput, opening?: MovementInput) {
  const id = randomUUID();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO items (id, name, sku, lowStockAt, notes, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      input.name,
      input.sku,
      input.lowStockAt,
      input.notes,
      Date.now()
    );
    if (opening) {
      await insertMovement(db, id, 'in', opening);
    }
  });
  notifyLocalChange();
  return id;
}

export async function updateItem(db: SQLiteDatabase, id: string, input: ItemInput) {
  await db.runAsync(
    'UPDATE items SET name = ?, sku = ?, lowStockAt = ?, notes = ?, updatedAt = ?, dirty = 1 WHERE id = ?',
    input.name,
    input.sku,
    input.lowStockAt,
    input.notes,
    Date.now(),
    id
  );
  notifyLocalChange();
}

export async function deleteItem(db: SQLiteDatabase, id: string) {
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE movements SET deleted = 1, dirty = 1, updatedAt = ? WHERE itemId = ? AND deleted = 0',
      now,
      id
    );
    await db.runAsync('UPDATE items SET deleted = 1, dirty = 1, updatedAt = ? WHERE id = ?', now, id);
  });
  notifyLocalChange();
}

export function isLowStock(item: Pick<Item, 'quantity' | 'lowStockAt'>) {
  return item.quantity <= item.lowStockAt;
}

// --- Movements ---

const MOVEMENT_COLUMNS =
  'id, itemId, type, quantity, unitPrice, party, city, date, notes, createdAt, updatedAt';

/** Newest first. */
export function listMovements(db: SQLiteDatabase, itemId: string) {
  return db.getAllAsync<Movement>(
    `SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE itemId = ? AND deleted = 0
     ORDER BY date DESC, createdAt DESC`,
    itemId
  );
}

export function getMovement(db: SQLiteDatabase, id: string) {
  return db.getFirstAsync<Movement>(
    `SELECT ${MOVEMENT_COLUMNS} FROM movements WHERE id = ? AND deleted = 0`,
    id
  );
}

export async function getItemTotals(db: SQLiteDatabase, itemId: string): Promise<ItemTotals> {
  const row = await db.getFirstAsync<ItemTotals>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'in' THEN quantity END), 0) AS totalIn,
       COALESCE(SUM(CASE WHEN type = 'out' THEN quantity END), 0) AS totalOut,
       COALESCE(SUM(CASE WHEN type = 'in' AND unitPrice IS NOT NULL THEN quantity * unitPrice END), 0) AS purchaseValue,
       COALESCE(SUM(CASE WHEN type = 'in' AND unitPrice IS NOT NULL THEN quantity END), 0) AS pricedUnits
     FROM movements WHERE itemId = ? AND deleted = 0`,
    itemId
  );
  return row ?? { totalIn: 0, totalOut: 0, purchaseValue: 0, pricedUnits: 0 };
}

/** Stock for an item, ignoring one movement (so an edit can be checked before saving). */
export async function stockExcluding(db: SQLiteDatabase, itemId: string, movementId?: string) {
  const row = await db.getFirstAsync<{ stock: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) AS stock
     FROM movements WHERE itemId = ? AND id != ? AND deleted = 0`,
    itemId,
    movementId ?? ''
  );
  return row?.stock ?? 0;
}

async function insertMovement(db: SQLiteDatabase, itemId: string, type: MovementType, input: MovementInput) {
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO movements (id, itemId, type, quantity, unitPrice, party, city, date, notes, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    itemId,
    type,
    input.quantity,
    input.unitPrice,
    input.party,
    input.city,
    input.date,
    input.notes,
    now,
    now
  );
}

export async function createMovement(db: SQLiteDatabase, itemId: string, type: MovementType, input: MovementInput) {
  await insertMovement(db, itemId, type, input);
  notifyLocalChange();
}

export async function updateMovement(db: SQLiteDatabase, id: string, input: MovementInput) {
  await db.runAsync(
    `UPDATE movements SET quantity = ?, unitPrice = ?, party = ?, city = ?, date = ?, notes = ?,
       updatedAt = ?, dirty = 1 WHERE id = ?`,
    input.quantity,
    input.unitPrice,
    input.party,
    input.city,
    input.date,
    input.notes,
    Date.now(),
    id
  );
  notifyLocalChange();
}

export async function deleteMovement(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE movements SET deleted = 1, dirty = 1, updatedAt = ? WHERE id = ?', Date.now(), id);
  notifyLocalChange();
}
