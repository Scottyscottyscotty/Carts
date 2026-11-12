import { ext } from "../core/ext";

// Open the side panel when the toolbar icon is clicked.
// Guarded: not every browser (e.g. Safari) implements chrome.sidePanel.
(ext as any).sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  ?.catch?.((e: unknown) => console.error("sidePanel behavior failed", e));
