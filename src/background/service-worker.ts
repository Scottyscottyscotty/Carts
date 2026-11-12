import { ext } from "../core/ext";
import { MUTATORS, Store, type Mutator } from "../core/storage";

// Open the side panel when the toolbar icon is clicked.
// Guarded: not every browser (e.g. Safari) implements chrome.sidePanel.
(ext as any).sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  ?.catch?.((e: unknown) => console.error("sidePanel behavior failed", e));

// The one and only writer of the store (see core/client.ts).
const store = new Store();

ext.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
  if (msg?.type !== "cct-store") return;
  const method = msg.method as Mutator;
  if (!MUTATORS.includes(method) || !Array.isArray(msg.args)) {
    sendResponse({ error: `Unknown store method: ${String(msg.method)}` });
    return;
  }
  (store[method] as (...a: unknown[]) => Promise<unknown>)
    .apply(store, msg.args)
    .then((data) => sendResponse({ data }))
    .catch((e: unknown) => sendResponse({ error: e instanceof Error ? e.message : String(e) }));
  return true; // async response
});
