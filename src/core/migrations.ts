import { SCHEMA_VERSION, emptyStore, type StoreData } from "./model";

/** migrations[n] upgrades data from version n to n+1. */
const migrations: Record<number, (d: any) => any> = {
  // v1 -> v2: track whether items have been seen in the site cart.
  1: (d) => {
    const items: Record<string, any> = {};
    for (const [id, it] of Object.entries<any>(d.items ?? {})) {
      items[id] = { seenInCart: false, missingFromCart: false, language: "EN", ...it };
    }
    return { ...d, items, schemaVersion: 2 };
  },
};

/** Throws unless `raw` looks like store data from this or an older version. Used for imports. */
export function validateImport(raw: unknown): StoreData {
  const d = migrate(raw);
  const r = raw as any;
  if (!r || typeof r !== "object" || typeof r.commanders !== "object" || typeof r.items !== "object" || !Array.isArray(r.commanderOrder)) {
    throw new Error("That file doesn't look like Commander Cart Tagger data.");
  }
  return d;
}

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
