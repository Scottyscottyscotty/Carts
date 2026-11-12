/** Single versioned data model. Bump SCHEMA_VERSION and add a migration in migrations.ts when it changes. */
export const SCHEMA_VERSION = 1;

export type Color = "W" | "U" | "B" | "R" | "G";

export interface Commander {
  id: string; // local uuid
  scryfallId: string;
  name: string;
  colorIdentity: Color[]; // empty = colorless
  imageUrl: string;
  createdAt: number;
  collapsed: boolean; // side-panel UI state
  /** Reserved for the future "target decklist" feature. Not used in v1. */
  targetDecklist?: TargetDecklistEntry[];
}

export interface TargetDecklistEntry {
  name: string;
  qty: number;
}

export type ItemStatus = "in_cart" | "waiting_on_price" | "bought";
export type Finish = "foil" | "nonfoil" | "etched" | "unknown";

export interface Allocation {
  commanderId: string;
  qty: number;
  status: ItemStatus;
  note: string;
}

export interface CartItem {
  id: string;
  /** Site adapter id, e.g. "manapool". */
  site: string;
  // card identity
  name: string;
  set: string;
  collectorNumber: string;
  finish: Finish;
  // listing details
  condition: string;
  language: string;
  seller: string;
  unitPrice: number; // in `currency`
  currency: string;
  listingUrl: string;
  /** Total qty of this line in the cart; allocations should sum to <= this. */
  quantity: number;
  allocations: Allocation[];
  addedAt: number;
}

export interface StoreData {
  schemaVersion: number;
  commanders: Record<string, Commander>;
  commanderOrder: string[];
  activeCommanderId: string | null;
  items: Record<string, CartItem>;
}

export function emptyStore(): StoreData {
  return {
    schemaVersion: SCHEMA_VERSION,
    commanders: {},
    commanderOrder: [],
    activeCommanderId: null,
    items: {},
  };
}

/** Identity used to match a live cart/listing row to a stored item. Price is not part of it. */
export function identityKey(p: {
  site: string;
  name: string;
  set: string;
  seller: string;
  condition: string;
  finish: Finish;
}): string {
  return [p.site, p.name, p.set, p.seller, p.condition, p.finish]
    .map((s) => s.trim().toLowerCase())
    .join("|");
}

export type ItemDraft = Omit<CartItem, "id" | "allocations" | "addedAt">;

export function allocatedQty(item: CartItem): number {
  return item.allocations.reduce((n, a) => n + a.qty, 0);
}

export function remainingQty(item: CartItem): number {
  return Math.max(0, item.quantity - allocatedQty(item));
}

/** Subtotal and count for one commander across all item allocations. */
export function commanderTotals(data: StoreData, commanderId: string) {
  let count = 0;
  let subtotal = 0;
  for (const item of Object.values(data.items)) {
    for (const a of item.allocations) {
      if (a.commanderId !== commanderId) continue;
      count += a.qty;
      subtotal += a.qty * item.unitPrice;
    }
  }
  return { count, subtotal };
}

/** Set code from a Manapool-style listing URL (/card/<set>/<number>/...), if present. */
function setCodeFromUrl(url: string): string {
  const m = url.match(/\/card\/([^/]+)\/[^/]+/);
  return m?.[1]?.toUpperCase() ?? "";
}

export interface ExportOptions {
  /** Append the set and collector number, e.g. `1 Exploration (DMR) 159`. Off = names only. */
  includeSet?: boolean;
}

/**
 * Plain decklist lines for one commander: `<qty> <Card Name>`, one per line.
 * Lines for the same card (e.g. from different sellers) are merged.
 */
export function formatCommanderList(data: StoreData, commanderId: string, opts: ExportOptions = {}): string {
  const merged = new Map<string, { qty: number; label: string }>();
  for (const item of Object.values(data.items)) {
    const a = item.allocations.find((x) => x.commanderId === commanderId);
    if (!a) continue;
    let label = item.name;
    if (opts.includeSet) {
      const set = setCodeFromUrl(item.listingUrl) || item.set;
      if (set) label += ` (${set})`;
      if (item.collectorNumber) label += ` ${item.collectorNumber}`;
    }
    const cur = merged.get(label);
    if (cur) cur.qty += a.qty;
    else merged.set(label, { qty: a.qty, label });
  }
  return [...merged.values()].map((m) => `${m.qty} ${m.label}`).join("\n");
}
