/**
 * Free-tier limits for CUSTOM uploads.
 *
 * The free tier already caps evaluation to one round or one person. That cap
 * is trivially sidestepped by slicing a twenty-van fleet into twenty one-van
 * files and running them one after another, so the cap needs depth as well as
 * breadth, and repeated custom imports need a ceiling.
 *
 * ## What this is, and is not
 *
 * The DEPTH CAPS are real. They are applied to the data before evaluation, so
 * a free user genuinely does not receive verdicts for the rows beyond them —
 * the same discipline the round cap already follows.
 *
 * The IMPORT QUOTA is friction, not enforcement. It lives in the visitor's own
 * browser, and a private window, cleared site data or devtools defeats it in
 * seconds. Mirroring it across localStorage AND IndexedDB means clearing one
 * alone does not reset it, which stops the casual case; it stops nothing else,
 * and it is not meant to. What actually governs commercial use is the licence
 * and the AGPL, exactly as with the key check. Anything stronger would need an
 * account and a server, which would cost the product the one property it is
 * sold on.
 *
 * Built-in examples are never counted and never capped. A visitor who cannot
 * see the thing work will not buy it, and the demo is the marketing.
 */

export const LIMITS = Object.freeze({
  /** Free + custom, fleet mode: one round, and only its first few stops. */
  routeRounds: 1,
  routeStops: 6,
  /** Free + custom, rota mode: one person, and only their first few shifts. */
  rotaPeople: 1,
  rotaShifts: 4,
  /** Custom imports allowed per rolling window. */
  imports: 3,
  windowMs: 24 * 60 * 60 * 1000,
});

export const UPSELL =
  'Free tier checks 1 round (up to 6 stops). Subscribe to Standard (£29/mo) ' +
  'to verify full rounds and entire fleets.';
export const UPSELL_ROTA =
  'Free tier checks 1 staff member (up to 4 shifts). Subscribe to Standard ' +
  '(£29/mo) to verify your whole rota.';

/* ---- quota storage ------------------------------------------------------- */

const LS_KEY = 'lattice117.customImports';
const DB_NAME = 'lattice117', STORE = 'quota', DB_KEY = 'customImports';

const prune = (list, now) =>
  (Array.isArray(list) ? list : [])
    .filter((t) => Number.isFinite(t) && now - t < LIMITS.windowMs)
    .sort((a, b) => a - b);

function lsRead() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
function lsWrite(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* blocked */ }
}

function idbOpen() {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

async function idbRead() {
  const db = await idbOpen();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(DB_KEY);
      r.onsuccess = () => resolve(Array.isArray(r.result) ? r.result : []);
      r.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
}

async function idbWrite(list) {
  const db = await idbOpen();
  if (!db) return;
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put(list, DB_KEY); } catch { /* ignore */ }
}

/**
 * Current usage, as the union of both stores.
 *
 * The union is the point: clearing localStorage alone leaves the IndexedDB
 * copy, and the higher of the two wins.
 */
export async function importsUsed(now = Date.now()) {
  const merged = new Set([...prune(lsRead(), now), ...prune(await idbRead(), now)]);
  return [...merged].sort((a, b) => a - b);
}

export async function importsLeft(now = Date.now()) {
  return Math.max(0, LIMITS.imports - (await importsUsed(now)).length);
}

/** Records one custom import in both stores. Returns how many remain after it. */
export async function recordImport(now = Date.now()) {
  const list = [...(await importsUsed(now)), now];
  lsWrite(list);
  await idbWrite(list);
  return Math.max(0, LIMITS.imports - list.length);
}

/* ---- depth caps ---------------------------------------------------------- */

/**
 * Trims a fleet to the free-tier depth. Applied before evaluation, so the
 * rows beyond the cap are genuinely not checked.
 *
 * @param {{vehicle:string, stops:any[]}[]} routes
 * @returns {{routes:any[], hidden:{rounds:number, stops:number}}}
 */
export function capRoutes(routes) {
  const kept = routes.slice(0, LIMITS.routeRounds).map((r) => ({
    ...r, stops: r.stops.slice(0, LIMITS.routeStops),
  }));
  const stopsDropped = routes
    .slice(0, LIMITS.routeRounds)
    .reduce((n, r) => n + Math.max(0, r.stops.length - LIMITS.routeStops), 0);
  return {
    routes: kept,
    hidden: { rounds: Math.max(0, routes.length - LIMITS.routeRounds), stops: stopsDropped },
  };
}

/**
 * Trims rota rows to one person and their first few shifts, preserving the
 * original row order within that person so sheet row numbers stay meaningful.
 *
 * @param {{staff:string}[]} rows
 */
export function capRotaRows(rows) {
  const order = [];
  for (const r of rows) {
    const s = String(r.staff ?? '').trim();
    if (s && !order.includes(s)) order.push(s);
  }
  const keepStaff = new Set(order.slice(0, LIMITS.rotaPeople));
  const seen = new Map();
  const kept = [];
  let shiftsDropped = 0;
  for (const r of rows) {
    const s = String(r.staff ?? '').trim();
    if (!keepStaff.has(s)) continue;
    const n = (seen.get(s) ?? 0) + 1;
    seen.set(s, n);
    if (n <= LIMITS.rotaShifts) kept.push(r); else shiftsDropped++;
  }
  return {
    rows: kept,
    hidden: { people: Math.max(0, order.length - LIMITS.rotaPeople), shifts: shiftsDropped },
  };
}

/**
 * How many breaches to show in full on a capped custom run.
 *
 * One is deliberate. A single complete diagnostic proves the tool does the
 * thing; a count of the rest proves there is more to buy. Showing none would
 * read as broken, and showing all of them is the product.
 */
export function splitBreaches(breaches) {
  return { shown: breaches.slice(0, 1), hiddenCount: Math.max(0, breaches.length - 1) };
}
