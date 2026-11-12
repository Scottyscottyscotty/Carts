import { ext } from "./ext";
import { migrate } from "./migrations";
import {
  emptyStore,
  identityKey,
  remainingQty,
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

  /** Serialized read-modify-write so concurrent updates never clobber each other. */
  update(fn: (d: StoreData) => void): Promise<StoreData> {
    const run = async () => {
      const d = await this.load();
      fn(d);
      await this.kv.set(KEY, d);
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

  /** Create or refresh a line, then assign remaining (or `qty`) to a commander. */
  tagToCommander(draft: ItemDraft, commanderId: string, qty?: number) {
    return this.update((d) => {
      if (!d.commanders[commanderId]) return;
      const item = upsertDraft(d, draft);
      const already = item.allocations.find((a) => a.commanderId === commanderId);
      const want = qty ?? (remainingQty(item) || item.quantity);
      const take = Math.min(want, remainingQty(item) + (already?.qty ?? 0));
      if (take <= 0) return;
      if (already) already.qty = take;
      else item.allocations.push({ commanderId, qty: take, status: "in_cart", note: "" });
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
   * Refresh qty/price for lines still on the live cart. Optionally assign leftover
   * quantity to the active commander.
   */
  syncCart(lines: ParsedLine[], autoTagActive: boolean) {
    return this.update((d) => {
      const byKey = new Map(lines.map((l) => [identityKey(l), l]));
      for (const item of Object.values(d.items)) {
        const live = byKey.get(identityKey(item));
        if (!live || item.site !== live.site) continue;
        item.quantity = live.quantity;
        item.unitPrice = live.unitPrice;
        item.currency = live.currency;
        if (live.listingUrl) item.listingUrl = live.listingUrl;
        if (live.collectorNumber) item.collectorNumber = live.collectorNumber;
        let left = item.quantity;
        for (const a of item.allocations) {
          a.qty = Math.min(a.qty, left);
          left -= a.qty;
        }
      }
      if (!autoTagActive || !d.activeCommanderId || !d.commanders[d.activeCommanderId]) return;
      const active = d.activeCommanderId;
      for (const line of lines) {
        const item = upsertDraft(d, lineToDraft(line));
        const rem = remainingQty(item);
        if (rem <= 0) continue;
        const a = item.allocations.find((x) => x.commanderId === active);
        if (a) a.qty += rem;
        else item.allocations.push({ commanderId: active, qty: rem, status: "in_cart", note: "" });
      }
    });
  }
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

function upsertDraft(d: StoreData, draft: ItemDraft) {
  const key = identityKey(draft);
  let item = Object.values(d.items).find((i) => identityKey(i) === key);
  if (!item) {
    item = { ...draft, id: crypto.randomUUID(), allocations: [], addedAt: Date.now() };
    d.items[item.id] = item;
    return item;
  }
  item.quantity = Math.max(item.quantity, draft.quantity);
  item.unitPrice = draft.unitPrice;
  item.currency = draft.currency;
  if (draft.listingUrl) item.listingUrl = draft.listingUrl;
  if (draft.collectorNumber) item.collectorNumber = draft.collectorNumber;
  if (draft.seller) item.seller = draft.seller;
  return item;
}

export const SETTINGS_KEY = "settings";
export type Settings = { autoTag: boolean };

export async function loadSettings(kv: KV = chromeKV): Promise<Settings> {
  const raw = (await kv.get(SETTINGS_KEY)) as Settings | undefined;
  return { autoTag: Boolean(raw?.autoTag) };
}

export async function saveSettings(s: Settings, kv: KV = chromeKV): Promise<Settings> {
  await kv.set(SETTINGS_KEY, s);
  return s;
}

export const store = new Store();
export { emptyStore };
