import { ext } from "./ext";
import { MUTATORS, chromeKV, type Mutator, type Store } from "./storage";
import { migrate } from "./migrations";
import type { StoreData } from "./model";

/**
 * Store handle for the side panel and content scripts. Reads go straight to chrome.storage;
 * every write is sent to the service worker, which is the single writer. That avoids lost updates
 * when several tabs and the panel write at once.
 */
type Client = Pick<Store, Mutator> & { load(): Promise<StoreData> };

async function send(method: Mutator, args: unknown[]): Promise<StoreData> {
  const res = await ext.runtime.sendMessage({ type: "cct-store", method, args });
  if (!res) throw new Error("The extension background worker didn't answer. Try reloading the extension.");
  if (res.error) throw new Error(res.error);
  return res.data as StoreData;
}

export const store = Object.fromEntries([
  ["load", async () => migrate(await chromeKV.get("store"))],
  ...MUTATORS.map((m) => [m, (...args: unknown[]) => send(m, args)]),
]) as unknown as Client;
