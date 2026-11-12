import { describe, expect, it } from "vitest";
import {
  AUTO_BACKUP_MIN_INTERVAL_MS as DAY,
  STALE_BACKUP_MS,
  backupDataUrl,
  backupFilename,
  backupStatus,
  hashString,
  shouldAutoBackup,
} from "../../src/core/backup";
import { Store, UNDO_TTL_MS, loadUndo, type KV } from "../../src/core/storage";

const H = 60 * 60 * 1000;
const base = { now: 1_000_000_000_000, enabled: true, hasData: true, hash: "b", last: undefined as any };

describe("shouldAutoBackup", () => {
  it("backs up the first time there is data", () => expect(shouldAutoBackup(base)).toBe(true));
  it("never when disabled or empty", () => {
    expect(shouldAutoBackup({ ...base, enabled: false })).toBe(false);
    expect(shouldAutoBackup({ ...base, hasData: false })).toBe(false);
  });
  it("skips when nothing changed since the last backup, even after a day", () => {
    expect(shouldAutoBackup({ ...base, last: { at: base.now - 3 * DAY, hash: "b" } })).toBe(false);
  });
  it("waits out the minimum interval when data changed", () => {
    expect(shouldAutoBackup({ ...base, last: { at: base.now - 2 * H, hash: "a" } })).toBe(false);
    expect(shouldAutoBackup({ ...base, last: { at: base.now - DAY - H, hash: "a" } })).toBe(true);
  });
  it("retries a failed backup after an hour, not immediately", () => {
    const last = { at: base.now - 10 * 60 * 1000, hash: "a", error: "boom" };
    expect(shouldAutoBackup({ ...base, last })).toBe(false);
    expect(shouldAutoBackup({ ...base, last: { ...last, at: base.now - 2 * H } })).toBe(true);
  });
});

describe("backup helpers", () => {
  it("hash differs for different data and is stable", () => {
    expect(hashString('{"a":1}')).toBe(hashString('{"a":1}'));
    expect(hashString('{"a":1}')).not.toBe(hashString('{"a":2}'));
  });
  it("builds a dated filename inside the backups folder", () => {
    expect(backupFilename(new Date(2026, 10, 5))).toBe("Commander Cart Tagger backups/commander-cart-tagger-2026-11-05.json");
  });
  it("data url round-trips JSON with special characters", () => {
    const json = JSON.stringify({ name: "Atraxa, Praetors' Voice #1 100%" });
    const url = backupDataUrl(json);
    expect(decodeURIComponent(url.split(",").slice(1).join(","))).toBe(json);
  });
});

describe("backupStatus", () => {
  const now = 1_000_000_000_000;
  const common = { now, hasData: true, autoEnabled: true };
  it("nothing to back up", () => expect(backupStatus({ ...common, hasData: false }).level).toBe("ok"));
  it("warns when there is data and no backup at all", () => {
    expect(backupStatus(common)).toMatchObject({ level: "warn" });
    expect(backupStatus({ ...common, autoEnabled: false }).text).toMatch(/Export/);
  });
  it("ok when recent, warns when over a week old", () => {
    expect(backupStatus({ ...common, manualAt: now - 2 * H })).toMatchObject({ level: "ok" });
    const s = backupStatus({ ...common, manualAt: now - STALE_BACKUP_MS - H });
    expect(s.level).toBe("warn");
    expect(s.text).toMatch(/week/);
  });
  it("uses the newest of manual and auto, and surfaces auto failures", () => {
    const s = backupStatus({ ...common, manualAt: now - 30 * H, auto: { at: now - 2 * H, hash: "x" } });
    expect(s.text).toContain("auto 2 h ago");
    expect(s.level).toBe("ok");
    const f = backupStatus({ ...common, auto: { at: now, hash: "", error: "blocked" } });
    expect(f.level).toBe("warn");
    expect(f.text).toContain("blocked");
  });
});

function mem(): KV {
  const m = new Map<string, unknown>();
  return { get: async (k) => structuredClone(m.get(k)), set: async (k, v) => void m.set(k, structuredClone(v)) };
}
const cmd = (id: string, name: string) => ({ scryfallId: id, name, colorIdentity: [], imageUrl: "" });

describe("undo", () => {
  it("restores a deleted commander and its tagged items", async () => {
    const kv = mem();
    const s = new Store(kv);
    await s.addCommander(cmd("a", "Atraxa"));
    await s.addCommander(cmd("k", "Korvold"));
    let d = await s.load();
    const [A] = d.commanderOrder as [string, string];
    await s.tagToCommander(
      { site: "manapool", name: "Sol Ring", set: "X", collectorNumber: "", finish: "nonfoil", condition: "NM", language: "EN", seller: "s", unitPrice: 1, currency: "USD", listingUrl: "", quantity: 1 },
      A,
    );
    d = await s.removeCommander(A);
    expect(d.commanderOrder).toHaveLength(1);
    expect(Object.keys(d.items)).toHaveLength(0);
    expect((await loadUndo(kv))?.label).toBe("Deleted Atraxa");
    d = await s.undo();
    expect(d.commanderOrder).toHaveLength(2);
    expect(Object.values(d.items)[0]!.name).toBe("Sol Ring");
    expect(await loadUndo(kv)).toBeNull(); // single use
  });
  it("restores the previous data after an import", async () => {
    const s = new Store(mem());
    await s.addCommander(cmd("a", "Atraxa"));
    await s.replaceAll({ schemaVersion: 2, commanders: {}, commanderOrder: [], activeCommanderId: null, items: {} });
    expect((await s.load()).commanderOrder).toHaveLength(0);
    expect((await s.undo()).commanderOrder).toHaveLength(1);
  });
  it("expires after the time limit and does nothing when there is nothing to undo", async () => {
    const kv = mem();
    const s = new Store(kv);
    await s.addCommander(cmd("a", "Atraxa"));
    const id = (await s.load()).commanderOrder[0]!;
    await s.removeCommander(id);
    expect(await loadUndo(kv, Date.now() + UNDO_TTL_MS + 1000)).toBeNull();
    expect((await new Store(mem()).undo()).commanderOrder).toHaveLength(0);
  });
  it("doesn't snapshot when there was nothing to lose", async () => {
    const kv = mem();
    await new Store(kv).removeCommander("nope");
    expect(await loadUndo(kv)).toBeNull();
  });
});
