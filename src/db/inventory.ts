import type { SQLiteDatabase } from 'expo-sqlite';

export type Item = {
  id: number;
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
  id: number;
  itemId: number;
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
};

export type MovementInput = Omit<Movement, 'id' | 'itemId' | 'type' | 'createdAt'>;

export type ItemTotals = {
  totalIn: number;
  totalOut: number;
  /** Sum of quantity × unitPrice over inbound entries that have a price. */
  purchaseValue: number;
  /** Units covered by `purchaseValue` (inbound entries that have a price). */
  pricedUnits: number;
};

const DATABASE_VERSION = 2;

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

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

const STOCK_SQL = `COALESCE((SELECT SUM(CASE WHEN m.type = 'in' THEN m.quantity ELSE -m.quantity END)
  FROM movements m WHERE m.itemId = items.id), 0)`;

const ITEM_COLUMNS = `id, name, sku, lowStockAt, notes, updatedAt, ${STOCK_SQL} AS quantity`;

export function listItems(db: SQLiteDatabase) {
  return db.getAllAsync<Item>(`SELECT ${ITEM_COLUMNS} FROM items ORDER BY name COLLATE NOCASE`);
}

export function getItem(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Item>(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, id);
}

/** Creates a product, optionally with its first inbound entry. Returns the new item id. */
export async function createItem(
  db: SQLiteDatabase,
  input: ItemInput,
  opening?: MovementInput
) {
  let id = 0;
  await db.withTransactionAsync(async () => {
    const result = await db.runAsync(
      'INSERT INTO items (name, sku, lowStockAt, notes, updatedAt) VALUES (?, ?, ?, ?, ?)',
      input.name,
      input.sku,
      input.lowStockAt,
      input.notes,
      Date.now()
    );
    id = result.lastInsertRowId;
    if (opening) {
      await insertMovement(db, id, 'in', opening);
    }
  });
  return id;
}

export async function updateItem(db: SQLiteDatabase, id: number, input: ItemInput) {
  await db.runAsync(
    'UPDATE items SET name = ?, sku = ?, lowStockAt = ?, notes = ?, updatedAt = ? WHERE id = ?',
    input.name,
    input.sku,
    input.lowStockAt,
    input.notes,
    Date.now(),
    id
  );
}

export async function deleteItem(db: SQLiteDatabase, id: number) {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM movements WHERE itemId = ?', id);
    await db.runAsync('DELETE FROM items WHERE id = ?', id);
  });
}

export function isLowStock(item: Pick<Item, 'quantity' | 'lowStockAt'>) {
  return item.quantity <= item.lowStockAt;
}

// --- Movements ---

/** Newest first. */
export function listMovements(db: SQLiteDatabase, itemId: number) {
  return db.getAllAsync<Movement>(
    'SELECT * FROM movements WHERE itemId = ? ORDER BY date DESC, id DESC',
    itemId
  );
}

export function getMovement(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Movement>('SELECT * FROM movements WHERE id = ?', id);
}

export async function getItemTotals(db: SQLiteDatabase, itemId: number): Promise<ItemTotals> {
  const row = await db.getFirstAsync<ItemTotals>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'in' THEN quantity END), 0) AS totalIn,
       COALESCE(SUM(CASE WHEN type = 'out' THEN quantity END), 0) AS totalOut,
       COALESCE(SUM(CASE WHEN type = 'in' AND unitPrice IS NOT NULL THEN quantity * unitPrice END), 0) AS purchaseValue,
       COALESCE(SUM(CASE WHEN type = 'in' AND unitPrice IS NOT NULL THEN quantity END), 0) AS pricedUnits
     FROM movements WHERE itemId = ?`,
    itemId
  );
  return row ?? { totalIn: 0, totalOut: 0, purchaseValue: 0, pricedUnits: 0 };
}

/** Stock for an item, ignoring one movement (so an edit can be checked before saving). */
export async function stockExcluding(db: SQLiteDatabase, itemId: number, movementId?: number) {
  const row = await db.getFirstAsync<{ stock: number }>(
    `SELECT COALESCE(SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END), 0) AS stock
     FROM movements WHERE itemId = ? AND id != ?`,
    itemId,
    movementId ?? -1
  );
  return row?.stock ?? 0;
}

async function insertMovement(
  db: SQLiteDatabase,
  itemId: number,
  type: MovementType,
  input: MovementInput
) {
  await db.runAsync(
    `INSERT INTO movements (itemId, type, quantity, unitPrice, party, city, date, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    itemId,
    type,
    input.quantity,
    input.unitPrice,
    input.party,
    input.city,
    input.date,
    input.notes,
    Date.now()
  );
}

export async function createMovement(
  db: SQLiteDatabase,
  itemId: number,
  type: MovementType,
  input: MovementInput
) {
  await insertMovement(db, itemId, type, input);
}

export async function updateMovement(db: SQLiteDatabase, id: number, input: MovementInput) {
  await db.runAsync(
    'UPDATE movements SET quantity = ?, unitPrice = ?, party = ?, city = ?, date = ?, notes = ? WHERE id = ?',
    input.quantity,
    input.unitPrice,
    input.party,
    input.city,
    input.date,
    input.notes,
    id
  );
}

export async function deleteMovement(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM movements WHERE id = ?', id);
}
