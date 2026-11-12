import { SCHEMA_VERSION, emptyStore, type StoreData } from "./model";

/** migrations[n] upgrades data from version n to n+1. */
const migrations: Record<number, (d: any) => any> = {
  // 1: (d) => ({ ...d, schemaVersion: 2, ...newFields }),
};

export function migrate(raw: unknown): StoreData {
  if (!raw || typeof raw !== "object") return emptyStore();
  let data = raw as any;
  let v = typeof data.schemaVersion === "number" ? data.schemaVersion : 0;
  if (v > SCHEMA_VERSION) {
    throw new Error(`Stored data is from a newer version (${v}); update the extension.`);
  }
  if (v === 0) {
    data = { ...emptyStore(), ...data, schemaVersion: 1 };
    v = 1;
  }
  while (v < SCHEMA_VERSION) {
    const step = migrations[v];
    if (!step) throw new Error(`No migration from schema ${v}`);
    data = step(data);
    v = data.schemaVersion;
  }
  return data as StoreData;
}
