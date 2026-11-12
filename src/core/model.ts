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

export function formatCommanderList(data: StoreData, commanderId: string): string {
  const cmd = data.commanders[commanderId];
  const lines: string[] = cmd ? [`# ${cmd.name}`, ""] : [];
  for (const item of Object.values(data.items)) {
    const a = item.allocations.find((x) => x.commanderId === commanderId);
    if (!a) continue;
    const foil = item.finish === "nonfoil" || item.finish === "unknown" ? "" : ` ${item.finish}`;
    lines.push(
      `${a.qty}x ${item.name} (${item.set}) ${item.condition}${foil} — $${(a.qty * item.unitPrice).toFixed(2)} [${a.status.replaceAll("_", " ")}]`,
    );
  }
  const { count, subtotal } = commanderTotals(data, commanderId);
  lines.push("", `${count} items · $${subtotal.toFixed(2)}`);
  return lines.join("\n");
}
