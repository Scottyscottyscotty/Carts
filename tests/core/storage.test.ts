import { describe, it, expect } from "vitest";
import { Store, type KV } from "../../src/core/storage";
import { migrate } from "../../src/core/migrations";
import { identityKey, SCHEMA_VERSION } from "../../src/core/model";
import type { ItemDraft } from "../../src/core/model";

function memKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => structuredClone(m.get(k)),
    set: async (k, v) => void m.set(k, structuredClone(v)),
  };
}
const atraxa = { scryfallId: "a", name: "Atraxa", colorIdentity: ["W", "U", "B", "G"] as const, imageUrl: "" };
const korvold = { scryfallId: "k", name: "Korvold", colorIdentity: ["B", "R", "G"] as const, imageUrl: "" };

describe("Store", () => {
  it("first commander becomes active; switching works", async () => {
    const s = new Store(memKV());
    await s.addCommander({ ...atraxa, colorIdentity: [...atraxa.colorIdentity] });
    let d = await s.addCommander({ ...korvold, colorIdentity: [...korvold.colorIdentity] });
    const [a, k] = d.commanderOrder as [string, string];
    expect(d.activeCommanderId).toBe(a);
    d = await s.setActive(k);
    expect(d.activeCommanderId).toBe(k);
  });
  it("does not duplicate the same scryfall card", async () => {
    const s = new Store(memKV());
    await s.addCommander({ ...atraxa, colorIdentity: [] });
    const d = await s.addCommander({ ...atraxa, colorIdentity: [] });
    expect(d.commanderOrder).toHaveLength(1);
  });
  it("removing the active commander falls back to another", async () => {
    const s = new Store(memKV());
    await s.addCommander({ ...atraxa, colorIdentity: [] });
    let d = await s.addCommander({ ...korvold, colorIdentity: [] });
    d = await s.removeCommander(d.activeCommanderId!);
    expect(d.commanderOrder).toHaveLength(1);
    expect(d.activeCommanderId).toBe(d.commanderOrder[0]);
  });
  it("tags remaining qty to a commander and can untag", async () => {
    const s = new Store(memKV());
    const d0 = await s.addCommander({ ...atraxa, colorIdentity: [] });
    const id = d0.commanderOrder[0]!;
    const draft: ItemDraft = {
      site: "manapool",
      name: "Sol Ring",
      set: "C21",
      collectorNumber: "1",
      finish: "nonfoil",
      condition: "NM",
      language: "EN",
      seller: "Shop",
      unitPrice: 1.5,
      currency: "USD",
      listingUrl: "https://manapool.com/cart",
      quantity: 2,
    };
    let d = await s.tagToCommander(draft, id);
    const item = Object.values(d.items)[0]!;
    expect(item.allocations[0]).toMatchObject({ commanderId: id, qty: 2, status: "in_cart" });
    d = await s.setAllocationStatus(item.id, id, "bought");
    expect(d.items[item.id]?.allocations[0]?.status).toBe("bought");
    d = await s.untag(item.id, id);
    expect(Object.keys(d.items)).toHaveLength(0);
  });

  it("auto-tags leftover cart qty to the active commander", async () => {
    const s = new Store(memKV());
    const d0 = await s.addCommander({ ...atraxa, colorIdentity: [] });
    const line = {
      site: "manapool",
      name: "Forest",
      set: "DMR",
      collectorNumber: "",
      finish: "nonfoil" as const,
      condition: "NM",
      language: "EN",
      seller: "Shop",
      unitPrice: 0.1,
      currency: "USD",
      listingUrl: "https://manapool.com/cart",
      quantity: 3,
    };
    const d = await s.syncCart([line], true);
    const item = Object.values(d.items)[0]!;
    expect(identityKey(item)).toBe(identityKey(line));
    expect(item.allocations[0]?.commanderId).toBe(d0.activeCommanderId);
    expect(item.allocations[0]?.qty).toBe(3);
  });

  it("serializes concurrent updates", async () => {
    const s = new Store(memKV());
    await Promise.all([
      s.addCommander({ ...atraxa, colorIdentity: [] }),
      s.addCommander({ ...korvold, colorIdentity: [] }),
    ]);
    expect((await s.load()).commanderOrder).toHaveLength(2);
  });
});

describe("migrate", () => {
  it("handles empty/unversioned data", () => {
    expect(migrate(undefined).schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrate({ commanders: {} }).schemaVersion).toBe(SCHEMA_VERSION);
  });
  it("refuses data from a newer version", () => {
    expect(() => migrate({ schemaVersion: 999 })).toThrow();
  });
});

import { formatCommanderList, emptyStore, type CartItem } from "../../src/core/model";

describe("formatCommanderList", () => {
  const item = (over: Partial<CartItem>): CartItem => ({
    id: "i", site: "manapool", name: "Exploration", set: "Dominaria Remastered", collectorNumber: "159",
    finish: "nonfoil", condition: "NM", language: "EN", seller: "x", unitPrice: 27.55, currency: "USD",
    listingUrl: "https://manapool.com/card/dmr/159/exploration", quantity: 1, addedAt: 0, seenInCart: false, missingFromCart: false,
    allocations: [{ commanderId: "c", qty: 1, status: "in_cart", note: "" }], ...over,
  });
  const data = () => {
    const d = emptyStore();
    d.items.a = item({ id: "a" });
    d.items.b = item({ id: "b", seller: "y", allocations: [{ commanderId: "c", qty: 2, status: "bought", note: "" }] });
    d.items.o = item({ id: "o", name: "Sol Ring", allocations: [{ commanderId: "other", qty: 1, status: "in_cart", note: "" }] });
    return d;
  };
  it("is `qty name` only, merging duplicate cards and ignoring other commanders", () => {
    expect(formatCommanderList(data(), "c")).toBe("3 Exploration");
  });
  it("can include set code and number", () => {
    expect(formatCommanderList(data(), "c", { includeSet: true })).toBe("3 Exploration (DMR) 159");
  });
});
