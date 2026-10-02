const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's local date as `YYYY-MM-DD`. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `2026-09-30` → `30 Sep 2026` */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1] ?? '?'} ${y}`;
}

/** `2026-09-30` → `30/09/2026` (the format the date field is typed in). */
export function isoToInput(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Parses `DD/MM/YYYY` (also accepts `-` or `.` separators) into `YYYY-MM-DD`, or null if invalid. */
export function inputToIso(value: string) {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, d, m, y] = match.map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Indian-style grouping: 125000.5 → `₹1,25,000.50` */
export function formatMoney(amount: number) {
  const fixed = Math.abs(amount).toFixed(2).replace(/\.00$/, '');
  const [whole, fraction] = fixed.split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${lastThree}` : lastThree;
  return `${amount < 0 ? '−' : ''}₹${grouped}${fraction ? `.${fraction}` : ''}`;
}

/** Whole number ≥ 0, or null. */
export function parseCount(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** Price ≥ 0 with up to 2 decimals. Empty → undefined (no price); invalid → null. */
export function parsePrice(value: string) {
  const trimmed = value.trim().replace(/,/g, '');
  if (trimmed === '') return undefined;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Number(trimmed);
}
