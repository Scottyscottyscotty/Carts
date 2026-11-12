import { ext } from "./ext";
import { migrate, validateImport } from "./migrations";
import {
  emptyStore,
  remainingQty,
  sameItem,
  type Color,
  type Commander,
  type ItemDraft,
  type ItemStatus,
  type StoreData,
} from "./model";
import type { ParsedLine } from "../adapters/types";

const KEY = "store";

/** Pluggable backend so tests can run without chrome. */
export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

export const chromeKV: KV = {
  async get(key) {
    const r = await ext.storage.local.get(key);
    return r[key];
  },
  async set(key, value) {
    await ext.storage.local.set({ [key]: value });
  },
};

export class Store {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private kv: KV = chromeKV) {}

  async load(): Promise<StoreData> {
    return migrate(await this.kv.get(KEY));
  }

  /**
   * Serialized read-modify-write. Skips the storage write when nothing changed, so idle syncs don't
   * trigger storage listeners. (Callers in other contexts go through the service worker; see client.ts.)
   */
  update(fn: (d: StoreData) => void): Promise<StoreData> {
    const run = async () => {
      const raw = await this.kv.get(KEY);
      const d = migrate(raw);
      const before = JSON.stringify(raw ?? null);
      fn(d);
      if (JSON.stringify(d) !== before) await this.kv.set(KEY, d);
      return d;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  addCommander(c: {
    scryfallId: string;
    name: string;
    colorIdentity: Color[];
    imageUrl: string;
  }) {
    return this.update((d) => {
      const existing = Object.values(d.commanders).find((x) => x.scryfallId === c.scryfallId);
      if (existing) {
        d.activeCommanderId = existing.id;
        return;
      }
      const id = crypto.randomUUID();
      const cmd: Commander = { ...c, id, createdAt: Date.now(), collapsed: false };
      d.commanders[id] = cmd;
      d.commanderOrder.push(id);
      if (!d.activeCommanderId) d.activeCommanderId = id;
    });
  }

  removeCommander(id: string) {
    return this.update((d) => {
      delete d.commanders[id];
      d.commanderOrder = d.commanderOrder.filter((x) => x !== id);
      if (d.activeCommanderId === id) d.activeCommanderId = d.commanderOrder[0] ?? null;
      for (const [itemId, item] of Object.entries(d.items)) {
        item.allocations = item.allocations.filter((a) => a.commanderId !== id);
        if (item.allocations.length === 0) delete d.items[itemId];
      }
    });
  }

  setActive(id: string | null) {
    return this.update((d) => {
      if (id === null || d.commanders[id]) d.activeCommanderId = id;
    });
  }

  setCollapsed(id: string, collapsed: boolean) {
    return this.update((d) => {
      const c = d.commanders[id];
      if (c) c.collapsed = collapsed;
    });
  }

  /**
   * Assign `qty` (default: everything not yet assigned) of a line to a commander.
   * `grow` is for lines that are not in the cart yet (tagging on a listing): the line's quantity grows by `qty`.
   */
  tagToCommander(draft: ItemDraft, commanderId: string, qty?: number, grow = false) {
    return this.update((d) => {
      if (!d.commanders[commanderId]) return;
      const item = upsertDraft(d, draft);
      if (grow) item.quantity = allocated(item) + Math.max(remainingQty(item), Math.max(1, qty ?? 1));
      const room = remainingQty(item);
      const add = Math.min(qty ?? room, room);
      if (add <= 0) return;
      const already = item.allocations.find((a) => a.commanderId === commanderId);
      if (already) already.qty += add;
      else item.allocations.push({ commanderId, qty: add, status: "in_cart", note: "" });
    });
  }

  /**
   * Record that `delta` copies of a line were just added to the cart on the site, and assign them to a commander.
   */
  recordAdd(draft: ItemDraft, commanderId: string, delta: number) {
    return this.update((d) => {
      if (!d.commanders[commanderId] || delta <= 0) return;
      const item = upsertDraft(d, draft, { zero: true });
      item.quantity = Math.max(allocated(item), item.quantity) + delta;
      const already = item.allocations.find((a) => a.commanderId === commanderId);
      if (already) already.qty += delta;
      else item.allocations.push({ commanderId, qty: delta, status: "in_cart", note: "" });
    });
  }

  /** Set a commander's share of a line (clamped so allocations never exceed the line quantity). 0 removes it. */
  setAllocationQty(itemId: string, commanderId: string, qty: number) {
    return this.update((d) => {
      const item = d.items[itemId];
      const a = item?.allocations.find((x) => x.commanderId === commanderId);
      if (!item || !a) return;
      const others = allocated(item) - a.qty;
      const next = Math.max(0, Math.min(Math.floor(qty), Math.max(item.quantity, allocated(item)) - others));
      if (next === 0) {
        item.allocations = item.allocations.filter((x) => x !== a);
        if (item.allocations.length === 0) delete d.items[itemId];
      } else {
        a.qty = next;
        item.quantity = Math.max(item.quantity, others + next);
      }
    });
  }

  /** Replace everything (used by import). Validates and migrates first. */
  replaceAll(raw: unknown) {
    const next = validateImport(raw);
    return this.update((d) => {
      Object.assign(d, next);
    });
  }

  untag(itemId: string, commanderId: string) {
    return this.update((d) => {
      const item = d.items[itemId];
      if (!item) return;
      item.allocations = item.allocations.filter((a) => a.commanderId !== commanderId);
      if (item.allocations.length === 0) delete d.items[itemId];
    });
  }

  setAllocationStatus(itemId: string, commanderId: string, status: ItemStatus) {
    return this.update((d) => {
      const a = d.items[itemId]?.allocations.find((x) => x.commanderId === commanderId);
      if (a) a.status = status;
    });
  }

  setAllocationNote(itemId: string, commanderId: string, note: string) {
    return this.update((d) => {
      const a = d.items[itemId]?.allocations.find((x) => x.commanderId === commanderId);
      if (a) a.note = note;
    });
  }

  /** Items that left the cart (flagged by syncCart) become "bought" for this commander. */
  markMissingBought(commanderId: string) {
    return this.update((d) => {
      for (const item of Object.values(d.items)) {
        if (!item.missingFromCart) continue;
        for (const a of item.allocations) if (a.commanderId === commanderId) a.status = "bought";
      }
    });
  }

  markCommanderBought(commanderId: string) {
    return this.update((d) => {
      for (const item of Object.values(d.items)) {
        for (const a of item.allocations) {
          if (a.commanderId === commanderId) a.status = "bought";
        }
      }
    });
  }

  /**
   * Reconcile stored items with the lines currently in the site cart.
   * - lines still in the cart: refresh qty/price, mark seen, clamp allocations;
   * - items seen in the cart before but absent now: flag `missingFromCart` (only when `complete`,
   *   i.e. the page was read successfully);
   * - optionally assign leftover quantity to the active commander.
   */
  syncCart(lines: ParsedLine[], autoTagActive: boolean, complete = true) {
    return this.update((d) => {
      const site = lines[0]?.site;
      for (const item of Object.values(d.items)) {
        const live = lines.find((l) => sameItem(l, item));
        if (live) {
          item.quantity = live.quantity;
          item.unitPrice = live.unitPrice;
          item.currency = live.currency;
          if (live.listingUrl && !item.listingUrl.includes("/card/")) item.listingUrl = live.listingUrl;
          if (live.collectorNumber) item.collectorNumber = live.collectorNumber;
          if (live.seller) item.seller = live.seller;
          item.seenInCart = true;
          item.missingFromCart = false;
          let left = item.quantity;
          for (const a of item.allocations) {
            a.qty = Math.min(a.qty, left);
            left -= a.qty;
          }
          item.allocations = item.allocations.filter((a) => a.qty > 0);
        } else if (complete && item.seenInCart && (!site || item.site === site)) {
          item.missingFromCart = true;
        }
      }
      if (!autoTagActive || !d.activeCommanderId || !d.commanders[d.activeCommanderId]) return;
      const active = d.activeCommanderId;
      for (const line of lines) {
        const item = upsertDraft(d, lineToDraft(line));
        item.seenInCart = true;
        item.missingFromCart = false;
        const rem = remainingQty(item);
        if (rem <= 0) continue;
        const a = item.allocations.find((x) => x.commanderId === active);
        if (a) a.qty += rem;
        else item.allocations.push({ commanderId: active, qty: rem, status: "in_cart", note: "" });
      }
    });
  }
}

/** Methods that change data. Everything outside the service worker calls these via client.ts. */
export const MUTATORS = [
  "addCommander",
  "removeCommander",
  "setActive",
  "setCollapsed",
  "tagToCommander",
  "recordAdd",
  "setAllocationQty",
  "untag",
  "setAllocationStatus",
  "setAllocationNote",
  "markCommanderBought",
  "markMissingBought",
  "syncCart",
  "replaceAll",
] as const;
export type Mutator = (typeof MUTATORS)[number];

function allocated(item: { allocations: { qty: number }[] }) {
  return item.allocations.reduce((n, a) => n + a.qty, 0);
}

export function lineToDraft(line: ParsedLine): ItemDraft {
  return {
    site: line.site,
    name: line.name,
    set: line.set,
    collectorNumber: line.collectorNumber,
    finish: line.finish,
    condition: line.condition,
    language: line.language,
    seller: line.seller,
    unitPrice: line.unitPrice,
    currency: line.currency,
    listingUrl: line.listingUrl,
    quantity: line.quantity,
  };
}

function upsertDraft(d: StoreData, draft: ItemDraft, opts: { zero?: boolean } = {}) {
  let item = Object.values(d.items).find((i) => sameItem(i, draft));
  if (!item) {
    item = {
      ...draft,
      id: crypto.randomUUID(),
      allocations: [],
      addedAt: Date.now(),
      seenInCart: false,
      missingFromCart: false,
    };
    // `zero`: the caller adds its own quantity on top.
    if (opts.zero) item.quantity = 0;
    d.items[item.id] = item;
    return item;
  }
  if (!opts.zero) item.quantity = Math.max(item.quantity, draft.quantity);
  item.unitPrice = draft.unitPrice;
  item.currency = draft.currency;
  if (draft.listingUrl && (draft.listingUrl.includes("/card/") || !item.listingUrl)) item.listingUrl = draft.listingUrl;
  if (draft.collectorNumber) item.collectorNumber = draft.collectorNumber;
  if (draft.seller) item.seller = draft.seller;
  return item;
}

export const SETTINGS_KEY = "settings";
export type Settings = {
  /** On the cart page, assign any untagged cart quantity to the Active commander. */
  autoTag: boolean;
  /** On a listing page, tag to the Active commander when Add succeeds. */
  autoTagOnAdd: boolean;
};

export async function loadSettings(kv: KV = chromeKV): Promise<Settings> {
  const raw = (await kv.get(SETTINGS_KEY)) as Partial<Settings> | undefined;
  return { autoTag: Boolean(raw?.autoTag), autoTagOnAdd: raw?.autoTagOnAdd ?? true };
}

export async function saveSettings(s: Partial<Settings>, kv: KV = chromeKV): Promise<Settings> {
  const next = { ...(await loadSettings(kv)), ...s };
  await kv.set(SETTINGS_KEY, next);
  return next;
}

/** Last page-read results per page type, for the "debug info" button. No card or personal data. */
export const HEALTH_KEY = "health";
export interface PageHealth {
  at: number;
  path: string;
  parsed: number;
  problems: string[];
}
export async function saveHealth(page: string, h: Omit<PageHealth, "at">, kv: KV = chromeKV) {
  const all = ((await kv.get(HEALTH_KEY)) as Record<string, PageHealth> | undefined) ?? {};
  const prev = all[page];
  if (prev && prev.parsed === h.parsed && prev.path === h.path && prev.problems.join("|") === h.problems.join("|")) return;
  all[page] = { ...h, at: Date.now() };
  await kv.set(HEALTH_KEY, all);
}
export async function loadHealth(kv: KV = chromeKV): Promise<Record<string, PageHealth>> {
  return ((await kv.get(HEALTH_KEY)) as Record<string, PageHealth> | undefined) ?? {};
}

export const store = new Store();
export { emptyStore };
