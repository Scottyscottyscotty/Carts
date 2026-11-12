import { describe, expect, it } from "vitest";
import { Store, lineToDraft, type KV } from "../../src/core/storage";
import { migrate, validateImport } from "../../src/core/migrations";
import { formatAllList, formatCommanderList, remainingQty, sameItem, SCHEMA_VERSION } from "../../src/core/model";
import { parseSyncChanges } from "../../src/adapters/manapool";
import type { ParsedLine } from "../../src/adapters/types";

function mem(): KV & { sets: number } {
  const m = new Map<string, unknown>();
  const o: any = {
    sets: 0,
    get: async (k: string) => structuredClone(m.get(k)),
    set: async (k: string, v: unknown) => {
      o.sets++;
      m.set(k, structuredClone(v));
    },
  };
  return o;
}
const cmd = (id: string, name: string) => ({ scryfallId: id, name, colorIdentity: [], imageUrl: "" });
const line = (over: Partial<ParsedLine> = {}): ParsedLine => ({
  site: "manapool", name: "Sol Ring", set: "Commander Masters", collectorNumber: "", finish: "nonfoil",
  condition: "NM", language: "EN", seller: "Shop A", unitPrice: 1.5, currency: "USD",
  listingUrl: "https://manapool.com/cart", quantity: 3, ...over,
});

async function twoCommanders() {
  const kv = mem();
  const s = new Store(kv);
  await s.addCommander(cmd("a", "Atraxa"));
  await s.addCommander(cmd("k", "Korvold"));
  await s.addCommander(cmd("m", "Muldrotha"));
  const [A, K, M] = (await s.load()).commanderOrder as [string, string, string];
  return { kv, s, A, K, M };
}

describe("overlap: one cart line split across commanders", () => {
  it("qty 3 = Atraxa 1, Korvold 1, Muldrotha 1", async () => {
    const { s, A, K, M } = await twoCommanders();
    await s.syncCart([line()], false); // nothing stored yet
    await s.tagToCommander(lineToDraft(line()), A, 1);
    await s.tagToCommander(lineToDraft(line()), K, 1);
    const d = await s.tagToCommander(lineToDraft(line()), M, 1);
    const items = Object.values(d.items);
    expect(items).toHaveLength(1);
    expect(items[0]!.allocations.map((a) => [a.commanderId, a.qty])).toEqual([[A, 1], [K, 1], [M, 1]]);
    expect(remainingQty(items[0]!)).toBe(0);
  });
  it("never allocates more than the line quantity", async () => {
    const { s, A, K } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line({ quantity: 2 })), A, 2);
    const d = await s.tagToCommander(lineToDraft(line({ quantity: 2 })), K, 5);
    expect(Object.values(d.items)[0]!.allocations.map((a) => a.qty)).toEqual([2]);
  });
  it("setAllocationQty clamps to the room left by other commanders and 0 removes", async () => {
    const { s, A, K } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 1);
    let d = await s.tagToCommander(lineToDraft(line()), K, 1);
    const id = Object.keys(d.items)[0]!;
    d = await s.setAllocationQty(id, A, 99);
    expect(d.items[id]!.allocations.find((a) => a.commanderId === A)!.qty).toBe(2); // 3 total - Korvold's 1
    d = await s.setAllocationQty(id, K, 0);
    expect(d.items[id]!.allocations.map((a) => a.commanderId)).toEqual([A]);
  });
  it("manual tag on a listing grows the quantity so each deck can get its own copy", async () => {
    const { s, A, K } = await twoCommanders();
    const l = line({ quantity: 1, listingUrl: "https://manapool.com/card/cmm/1/sol-ring" });
    await s.tagToCommander(lineToDraft(l), A, 1, true);
    const d = await s.tagToCommander(lineToDraft(l), K, 1, true);
    const it = Object.values(d.items)[0]!;
    expect(it.quantity).toBe(2);
    expect(it.allocations.map((a) => a.qty)).toEqual([1, 1]);
  });
});

describe("recordAdd (confirmed add-to-cart)", () => {
  it("creates the line with the added quantity and keeps growing on repeat adds", async () => {
    const { s, A } = await twoCommanders();
    const l = line({ quantity: 1 });
    await s.recordAdd(lineToDraft(l), A, 1);
    const d = await s.recordAdd(lineToDraft(l), A, 2);
    const it = Object.values(d.items)[0]!;
    expect(it.quantity).toBe(3);
    expect(it.allocations[0]!.qty).toBe(3);
  });
});

describe("identity", () => {
  it("two known, different collector numbers are different cards; unknown matches anything", () => {
    const a = line({ collectorNumber: "159" });
    expect(sameItem(a, line({ collectorNumber: "400" }))).toBe(false);
    expect(sameItem(a, line({ collectorNumber: "" }))).toBe(true);
    expect(sameItem(a, line({ finish: "foil", collectorNumber: "159" }))).toBe(false);
    expect(sameItem(a, line({ seller: "Shop B", collectorNumber: "159" }))).toBe(false);
  });
  it("different printings in the same set stay separate items", async () => {
    const { s, A } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line({ collectorNumber: "159", quantity: 1 })), A);
    const d = await s.tagToCommander(lineToDraft(line({ collectorNumber: "400", quantity: 1 })), A);
    expect(Object.keys(d.items)).toHaveLength(2);
  });
  it("a listing-tagged item (has number) matches the cart line (no number)", async () => {
    const { s, A } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line({ collectorNumber: "159", quantity: 1 })), A);
    const d = await s.syncCart([line({ collectorNumber: "", quantity: 1 })], false);
    const items = Object.values(d.items);
    expect(items).toHaveLength(1);
    expect(items[0]!.seenInCart).toBe(true);
  });
});

describe("cart reconciliation", () => {
  it("does not write when nothing changed", async () => {
    const { kv, s, A } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 1);
    await s.syncCart([line()], false);
    const before = kv.sets;
    await s.syncCart([line()], false);
    await s.syncCart([line()], false);
    expect(kv.sets).toBe(before);
  });
  it("flags items that were in the cart and then left it; clears the flag if they return", async () => {
    const { s, A } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 3);
    await s.syncCart([line()], false);
    let d = await s.syncCart([line({ name: "Other Card" })], false);
    expect(Object.values(d.items).find((i) => i.name === "Sol Ring")!.missingFromCart).toBe(true);
    d = await s.syncCart([line()], false);
    expect(Object.values(d.items).find((i) => i.name === "Sol Ring")!.missingFromCart).toBe(false);
  });
  it("items never seen in the cart are not flagged as missing", async () => {
    const { s, A } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 1);
    const d = await s.syncCart([line({ name: "Other Card" })], false);
    expect(Object.values(d.items)[0]!.missingFromCart).toBe(false);
  });
  it("an unreadable cart (complete=false) never flags anything", async () => {
    const { s, A } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 1);
    await s.syncCart([line()], false);
    const d = await s.syncCart([], false, false);
    expect(Object.values(d.items)[0]!.missingFromCart).toBe(false);
  });
  it("markMissingBought only touches items that left the cart", async () => {
    const { s, A } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 3);
    await s.tagToCommander(lineToDraft(line({ name: "Still Here", quantity: 1 })), A, 1);
    await s.syncCart([line(), line({ name: "Still Here", quantity: 1 })], false);
    await s.syncCart([line({ name: "Still Here", quantity: 1 })], false);
    const d = await s.markMissingBought(A);
    const by = Object.fromEntries(Object.values(d.items).map((i) => [i.name, i.allocations[0]!.status]));
    expect(by).toEqual({ "Sol Ring": "bought", "Still Here": "in_cart" });
  });
  it("shrinking cart quantity clamps allocations", async () => {
    const { s, A, K } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 2);
    await s.tagToCommander(lineToDraft(line()), K, 1);
    const d = await s.syncCart([line({ quantity: 1 })], false);
    expect(Object.values(d.items)[0]!.allocations.map((a) => a.qty)).toEqual([1]);
  });
  it("auto-tag assigns only the untagged remainder to the active commander", async () => {
    const { s, A, K } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), K, 1);
    await s.setActive(A);
    const d = await s.syncCart([line()], true);
    const it = Object.values(d.items)[0]!;
    expect(it.allocations.map((a) => [a.commanderId, a.qty])).toEqual([[K, 1], [A, 2]]);
  });
});

describe("export", () => {
  it("exports all commanders combined, merged by card", async () => {
    const { s, A, K } = await twoCommanders();
    await s.tagToCommander(lineToDraft(line()), A, 1);
    await s.tagToCommander(lineToDraft(line()), K, 2);
    const d = await s.load();
    expect(formatCommanderList(d, A)).toBe("1 Sol Ring");
    expect(formatAllList(d)).toBe("3 Sol Ring");
  });
});

describe("schema migration and import", () => {
  const v1 = {
    schemaVersion: 1, activeCommanderId: null, commanderOrder: ["c"],
    commanders: { c: { id: "c", name: "X" } },
    items: { i: { id: "i", name: "Sol Ring", allocations: [] } },
  };
  it("migrates v1 -> current, adding the cart-tracking fields", () => {
    const d = migrate(v1);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(d.items.i).toMatchObject({ seenInCart: false, missingFromCart: false });
  });
  it("import accepts old backups and rejects junk and newer data", () => {
    expect(validateImport(v1).schemaVersion).toBe(SCHEMA_VERSION);
    expect(() => validateImport({ hello: "world" })).toThrow();
    expect(() => validateImport("nope")).toThrow();
    expect(() => validateImport({ ...v1, schemaVersion: 999 })).toThrow();
  });
  it("replaceAll swaps in imported data", async () => {
    const s = new Store(mem());
    await s.addCommander(cmd("a", "Atraxa"));
    const d = await s.replaceAll(v1);
    expect(d.commanderOrder).toEqual(["c"]);
  });
});

describe("manapool add-to-cart request", () => {
  it("parses the changes body", () => {
    const body = JSON.stringify({ changes: [{ inventory_id: "abc", delta_quantity: 2, source: "x", optimizer_touched: false }] });
    expect(parseSyncChanges(body)).toEqual([{ listingId: "abc", delta: 2 }]);
  });
  it("never throws on junk", () => {
    for (const b of ["", "not json", "{}", '{"changes":5}', '{"changes":[null,{"inventory_id":1}]}']) {
      expect(parseSyncChanges(b)).toEqual([]);
    }
  });
});
