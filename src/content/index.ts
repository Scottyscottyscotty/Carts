import { adapterFor } from "../adapters";
import type { CartLineHandle, ListingLineHandle, ParsedLine } from "../adapters/types";
import { identityKey, remainingQty, type StoreData } from "../core/model";
import { lineToDraft, loadSettings, saveSettings, store, type Settings } from "../core/storage";

const BANNER_ID = "cct-banner";
let timer: number | undefined;
let ticking = false;
let queued = false;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: (Node | string)[]
) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props as { class?: string };
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

function findItem(data: StoreData, line: ParsedLine) {
  const key = identityKey(line);
  return Object.values(data.items).find((i) => identityKey(i) === key);
}

function fillSelect(sel: HTMLSelectElement, data: StoreData) {
  sel.replaceChildren();
  if (data.commanderOrder.length === 0) {
    sel.append(new Option("Add a commander in the side panel", "", true, true));
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const id of data.commanderOrder) {
    const c = data.commanders[id];
    if (!c) continue;
    const opt = new Option(c.name, id, false, id === data.activeCommanderId);
    sel.append(opt);
  }
}

function renderAllocations(host: HTMLElement, data: StoreData, line: ParsedLine) {
  const item = findItem(data, line);
  host.replaceChildren();
  if (!item) return;
  for (const a of item.allocations) {
    const cmd = data.commanders[a.commanderId];
    if (!cmd) continue;
    const chip = el("span", { class: "cct-chip" }, `${a.qty}× ${cmd.name}`);
    const x = el("button", { type: "button", title: "Untag" }, "×");
    x.onclick = () => store.untag(item.id, a.commanderId).then(tick).catch(console.error);
    chip.append(x);
    host.append(chip);
  }
}

function bindTag(btn: HTMLButtonElement, sel: HTMLSelectElement, line: ParsedLine, data: StoreData) {
  const item = findItem(data, line);
  const rem = item ? remainingQty(item) : line.quantity;
  btn.disabled = !sel.value || rem <= 0;
  btn.textContent = rem < line.quantity ? `Tag remaining (${rem})` : "Tag";
  btn.onclick = () => {
    if (!sel.value) return;
    store.tagToCommander(lineToDraft(line), sel.value).then(tick).catch(console.error);
  };
}

function injectCartLine(h: CartLineHandle, data: StoreData) {
  let root = h.element.querySelector<HTMLElement>(":scope > .cct-root");
  if (!root) {
    root = el("div", { class: "cct-root" });
    h.element.append(root);
  }
  root.replaceChildren();
  const chips = el("div", { class: "cct-row" });
  renderAllocations(chips, data, h.line);
  const sel = el("select", {});
  fillSelect(sel, data);
  const btn = el("button", { type: "button" }, "Tag");
  bindTag(btn, sel, h.line, data);
  sel.onchange = () => bindTag(btn, sel, h.line, data);
  root.append(chips, el("div", { class: "cct-row" }, sel, btn));
}

function injectListingLine(h: ListingLineHandle, data: StoreData) {
  // Place the controls as a sibling right after the row so we never reshape the site's own row layout.
  const next = h.element.nextElementSibling;
  let root = next instanceof HTMLElement && next.classList.contains("cct-root") ? next : null;
  if (!root) {
    root = el("div", { class: "cct-root cct-listing" });
    h.element.insertAdjacentElement("afterend", root);
  }
  root.replaceChildren();
  const chips = el("div", { class: "cct-row" });
  renderAllocations(chips, data, h.line);
  const sel = el("select", {});
  fillSelect(sel, data);
  const btn = el("button", { type: "button" }, "Tag");
  bindTag(btn, sel, h.line, data);
  sel.onchange = () => bindTag(btn, sel, h.line, data);
  root.append(chips, el("div", { class: "cct-row" }, sel, btn));
}

function ensureBanner(): HTMLElement {
  let b = document.getElementById(BANNER_ID);
  if (b instanceof HTMLElement) return b;
  b = el("div", { id: BANNER_ID, class: "cct-banner" });
  document.body.prepend(b);
  return b;
}

function renderBanner(data: StoreData, settings: Settings, cartLines: number, onAuto: (v: boolean) => void, onTagAll: () => void) {
  const b = ensureBanner();
  b.replaceChildren();
  const active = data.activeCommanderId ? data.commanders[data.activeCommanderId] : undefined;
  b.append(
    el(
      "span",
      {},
      "Commander Cart Tagger · tagging for ",
      el("strong", {}, active?.name ?? "none (set Active in the side panel)"),
    ),
  );
  if (cartLines > 0) {
    const auto = el("input", { type: "checkbox" }) as HTMLInputElement;
    auto.checked = settings.autoTag;
    auto.onchange = () => onAuto(auto.checked);
    b.append(el("label", {}, auto, " Auto-tag new lines to Active"));
    const all = el("button", { type: "button" }, `Tag remaining to ${active?.name ?? "Active"}`);
    all.disabled = !active;
    all.onclick = onTagAll;
    b.append(all);
  }
}

async function tick() {
  if (ticking) {
    queued = true;
    return;
  }
  ticking = true;
  try {
    do {
      queued = false;
      const adapter = adapterFor(location.href);
      if (!adapter) return;
      const settings = await loadSettings();
      if (adapter.isCart(location.href)) {
        const handles = adapter.scanCart(document, location.href);
        await store.syncCart(
          handles.map((h) => h.line),
          settings.autoTag,
        );
        const fresh = await store.load();
        renderBanner(
          fresh,
          settings,
          handles.length,
          (v) => saveSettings({ autoTag: v }).then(tick),
          async () => {
            if (!fresh.activeCommanderId) return;
            const id = fresh.activeCommanderId;
            for (const h of handles) await store.tagToCommander(lineToDraft(h.line), id);
            await tick();
          },
        );
        for (const h of handles) injectCartLine(h, fresh);
      } else if (adapter.isListing(location.href)) {
        const data = await store.load();
        const handles = adapter.scanListing(document, location.href);
        renderBanner(data, settings, 0, () => {}, () => {});
        for (const h of handles) injectListingLine(h, data);
      } else {
        document.getElementById(BANNER_ID)?.remove();
      }
    } while (queued);
  } catch (e) {
    console.error("Commander Cart Tagger", e);
  } finally {
    ticking = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = window.setTimeout(() => void tick(), 250);
}

const obs = new MutationObserver((muts) => {
  if (muts.every((m) => m.target instanceof Element && (m.target as Element).closest?.("#cct-banner, .cct-root"))) {
    return;
  }
  schedule();
});
obs.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
window.addEventListener("popstate", schedule);
chrome.storage.onChanged.addListener(() => schedule());
schedule();
