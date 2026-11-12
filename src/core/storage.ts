import { ext } from "./ext";
import { migrate } from "./migrations";
import {
  emptyStore,
  type Color,
  type Commander,
  type StoreData,
} from "./model";

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
}

export const store = new Store();
export { emptyStore };
