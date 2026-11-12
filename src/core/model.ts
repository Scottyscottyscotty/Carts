/** Single versioned data model. Bump SCHEMA_VERSION and add a migration in migrations.ts when it changes. */
export const SCHEMA_VERSION = 2;

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
  /** True once this line has been seen on the site's cart page. */
  seenInCart: boolean;
  /** True when it was seen in the cart before but is no longer there (bought elsewhere, removed, checked out). */
  missingFromCart: boolean;
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

const norm = (s: string) => s.trim().toLowerCase();

/** Coarse identity of a line. Price and quantity are not part of it. */
export function identityKey(p: {
  site: string;
  name: string;
  set: string;
  seller: string;
  condition: string;
  finish: Finish;
  language?: string;
}): string {
  return [p.site, p.name, p.set, p.seller, p.condition, p.finish, p.language ?? ""].map(norm).join("|");
}

type Identity = Parameters<typeof identityKey>[0] & { collectorNumber?: string };

/**
 * Whether two lines are the same listing. Unknown (empty) fields match anything, because listing
 * pages know the collector number and cart pages don't, while two *known and different* collector
 * numbers (e.g. two printings in one set) are different cards.
 */
export function sameItem(a: Identity, b: Identity): boolean {
  if (a.site !== b.site) return false;
  const loose = (x: string | undefined, y: string | undefined) => !norm(x ?? "") || !norm(y ?? "") || norm(x!) === norm(y!);
  return (
    norm(a.name) === norm(b.name) &&
    loose(a.set, b.set) &&
    loose(a.seller, b.seller) &&
    loose(a.condition, b.condition) &&
    a.finish === b.finish &&
    loose(a.language, b.language) &&
    loose(a.collectorNumber, b.collectorNumber)
  );
}

export type ItemDraft = Omit<CartItem, "id" | "allocations" | "addedAt" | "seenInCart" | "missingFromCart">;

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

function exportLines(data: StoreData, commanderIds: string[] | null, opts: ExportOptions): string {
  const merged = new Map<string, number>();
  for (const item of Object.values(data.items)) {
    let qty = 0;
    for (const a of item.allocations) if (!commanderIds || commanderIds.includes(a.commanderId)) qty += a.qty;
    if (qty <= 0) continue;
    let label = item.name;
    if (opts.includeSet) {
      const set = setCodeFromUrl(item.listingUrl) || item.set;
      if (set) label += ` (${set})`;
      if (item.collectorNumber) label += ` ${item.collectorNumber}`;
    }
    merged.set(label, (merged.get(label) ?? 0) + qty);
  }
  return [...merged].map(([label, qty]) => `${qty} ${label}`).join("\n");
}

/** Plain lines for one commander: `<qty> <Card Name>`, one per line; same card from several sellers is merged. */
export function formatCommanderList(data: StoreData, commanderId: string, opts: ExportOptions = {}): string {
  return exportLines(data, [commanderId], opts);
}

/** Same format for every commander combined. */
export function formatAllList(data: StoreData, opts: ExportOptions = {}): string {
  return exportLines(data, null, opts);
}
