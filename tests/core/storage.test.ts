import { describe, it, expect } from "vitest";
import { Store, type KV } from "../../src/core/storage";
import { migrate } from "../../src/core/migrations";
import { SCHEMA_VERSION } from "../../src/core/model";

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
