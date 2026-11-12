import { ext } from "../core/ext";
import { BACKUP_AUTO_KEY, MUTATORS, Store, chromeKV, loadSettings, type Mutator } from "../core/storage";
import {
  backupDataUrl,
  backupFilename,
  hashString,
  shouldAutoBackup,
  type AutoBackupState,
} from "../core/backup";
import type { StoreData } from "../core/model";

// Open the side panel when the toolbar icon is clicked.
// Guarded: not every browser (e.g. Safari) implements chrome.sidePanel.
(ext as any).sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  ?.catch?.((e: unknown) => console.error("sidePanel behavior failed", e));

// The one and only writer of the store (see core/client.ts).
const store = new Store();

/**
 * Save a dated JSON backup into Downloads/Commander Cart Tagger backups/, at most about once a day and only
 * when the data changed since the last one. Failures are recorded (and shown in the panel), never thrown.
 */
let backingUp = false;
async function maybeAutoBackup(data: StoreData) {
  if (backingUp) return;
  backingUp = true;
  try {
    const settings = await loadSettings();
    const json = JSON.stringify(data, null, 2);
    const hash = hashString(JSON.stringify(data));
    const last = (await chromeKV.get(BACKUP_AUTO_KEY)) as AutoBackupState | undefined;
    const hasData = data.commanderOrder.length > 0 || Object.keys(data.items).length > 0;
    const now = Date.now();
    if (!shouldAutoBackup({ now, enabled: settings.autoBackup, hasData, hash, last })) return;
    try {
      const downloads = (ext as any).downloads as typeof chrome.downloads | undefined;
      if (!downloads) throw new Error("downloads not available in this browser");
      await downloads.download({
        url: backupDataUrl(json),
        filename: backupFilename(new Date(now)),
        conflictAction: "overwrite",
        saveAs: false,
      });
      await chromeKV.set(BACKUP_AUTO_KEY, { at: now, hash } satisfies AutoBackupState);
    } catch (e) {
      await chromeKV.set(BACKUP_AUTO_KEY, {
        at: now,
        hash: last?.hash ?? "",
        error: e instanceof Error ? e.message : String(e),
      } satisfies AutoBackupState);
    }
  } finally {
    backingUp = false;
  }
}

ext.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type !== "cct-store") return;
  const method = msg.method as Mutator;
  if (!MUTATORS.includes(method) || !Array.isArray(msg.args)) {
    sendResponse({ error: `Unknown store method: ${String(msg.method)}` });
    return;
  }
  (store[method] as (...a: unknown[]) => Promise<StoreData>)
    .apply(store, msg.args)
    .then((data) => {
      sendResponse({ data });
      void maybeAutoBackup(data);
    })
    .catch((e: unknown) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
  return true; // async response
});

// Also check once when the worker starts, so existing data gets its first backup soon after an update.
void store.load().then(maybeAutoBackup).catch(() => {});
