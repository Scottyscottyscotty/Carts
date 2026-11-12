import { adapterFor } from "../adapters";
import type { CartLineHandle, ListingLineHandle, ParsedLine } from "../adapters/types";
import { remainingQty, sameItem, type StoreData } from "../core/model";
import { lineToDraft, loadSettings, saveHealth, saveSettings, type Settings } from "../core/storage";
import { store } from "../core/client";

const BANNER_ID = "cct-banner";
const SIGNATURE = "cct-page";
const CONFIRM_WAIT_MS = 3500;

let timer: number | undefined;
let ticking = false;
let queued = false;
let listingHandles: ListingLineHandle[] = [];

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

function fail(e: unknown) {
  console.error("Commander Cart Tagger", e);
  toast(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`, true);
}

// ---------- toast ----------
function toast(msg: string, isError = false, actions: { label: string; run: () => void }[] = []) {
  document.getElementById("cct-toast")?.remove();
  const t = el("div", { id: "cct-toast", class: "cct-toast" + (isError ? " cct-toast-err" : "") }, msg);
  for (const a of actions) {
    const b = el("button", { type: "button" }, a.label);
    b.onclick = () => {
      t.remove();
      a.run();
    };
    t.append(b);
  }
  document.body.append(t);
  window.setTimeout(() => t.remove(), actions.length ? 9000 : 4500);
}

// ---------- tag controls ----------
function findItem(data: StoreData, line: ParsedLine) {
  return Object.values(data.items).find((i) => sameItem(i, line));
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
    if (c) sel.append(new Option(c.name, id, false, id === data.activeCommanderId));
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
    x.onclick = () => store.untag(item.id, a.commanderId).then(tick).catch(fail);
    chip.append(x);
    host.append(chip);
  }
}

/** True when the user is interacting with a control inside `root`; we must not rebuild it under them. */
function busy(root: HTMLElement) {
  const a = document.activeElement;
  return !!a && root.contains(a) && /^(SELECT|INPUT)$/.test(a.tagName);
}

function buildControls(root: HTMLElement, data: StoreData, line: ParsedLine, onSite: "cart" | "listing") {
  const chips = el("div", { class: "cct-row" });
  renderAllocations(chips, data, line);
  const sel = el("select", {});
  fillSelect(sel, data);
  const item = findItem(data, line);
  const rem = onSite === "cart" ? (item ? remainingQty(item) : line.quantity) : 99;
  const qty = el("input", { type: "number", min: "1", max: String(Math.max(rem, 1)), value: String(onSite === "cart" ? Math.max(rem, 1) : 1), title: "How many copies for this commander" }) as HTMLInputElement;
  qty.className = "cct-qty";
  const btn = el("button", { type: "button" }, onSite === "cart" ? "Tag" : "Tag (manual)");
  btn.disabled = !sel.value || rem <= 0;
  if (rem <= 0) btn.textContent = "All tagged";
  btn.onclick = () => {
    const n = Math.max(1, Math.min(Number(qty.value) || 1, Math.max(rem, 1)));
    if (!sel.value) return;
    store.tagToCommander(lineToDraft(line), sel.value, n, onSite === "listing").then(tick).catch(fail);
  };
  const controls = el("div", { class: "cct-row" }, sel);
  if (rem > 0) controls.append(qty);
  controls.append(btn);
  root.replaceChildren(chips, controls);
}

function injectCartLine(h: CartLineHandle, data: StoreData) {
  let root = h.element.querySelector<HTMLElement>(":scope > .cct-root");
  if (!root) {
    root = el("div", { class: "cct-root" });
    h.element.append(root);
  }
  if (busy(root)) return;
  buildControls(root, data, h.line, "cart");
}

function injectListingLine(h: ListingLineHandle, data: StoreData) {
  // Sibling block after the row so the site's own row layout is never reshaped.
  const next = h.element.nextElementSibling;
  let root = next instanceof HTMLElement && next.classList.contains("cct-root") ? next : null;
  if (!root) {
    root = el("div", { class: "cct-root cct-listing" });
    h.element.insertAdjacentElement("afterend", root);
  }
  if (busy(root)) return;
  buildControls(root, data, h.line, "listing");
}

// ---------- banner ----------
function ensureBanner(): HTMLElement {
  let b = document.getElementById(BANNER_ID);
  if (b) return b;
  b = el("div", { id: BANNER_ID, class: "cct-banner" });
  document.body.prepend(b);
  return b;
}

function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void) {
  const box = el("input", { type: "checkbox" }) as HTMLInputElement;
  box.checked = checked;
  box.onchange = () => onChange(box.checked);
  return el("label", {}, box, ` ${label}`);
}

interface BannerOpts {
  data: StoreData;
  settings: Settings;
  page: "cart" | "listing";
  parsed: number;
  problems: string[];
  onSettings: (s: Partial<Settings>) => void;
  onTagAll?: () => void;
  onCartEmpty?: () => void;
}

function renderBanner(o: BannerOpts) {
  const b = ensureBanner();
  const active = o.data.activeCommanderId ? o.data.commanders[o.data.activeCommanderId] : undefined;
  const nodes: (Node | string)[] = [
    el("span", {}, "Commander Cart Tagger · tagging for ", el("strong", {}, active?.name ?? "none (set Active in the side panel)")),
  ];
  if (o.page === "listing") {
    nodes.push(checkbox("Auto-tag when I click + Add", o.settings.autoTagOnAdd, (v) => o.onSettings({ autoTagOnAdd: v })));
  } else if (o.parsed > 0) {
    nodes.push(checkbox("Auto-tag untagged cart lines to Active", o.settings.autoTag, (v) => o.onSettings({ autoTag: v })));
    const all = el("button", { type: "button" }, `Tag remaining to ${active?.name ?? "Active"}`);
    all.disabled = !active;
    all.onclick = o.onTagAll ?? (() => {});
    nodes.push(all);
  }
  b.replaceChildren(...nodes);

  if (o.page === "cart" && o.parsed === 0) {
    const warn = el(
      "div",
      { class: "cct-warn" },
      "Couldn't read any lines from this cart. If your cart is empty that's fine; if not, Manapool may have changed its layout. Use “Copy debug info” in the side panel and send it along. ",
    );
    const empty = el("button", { type: "button" }, "My cart is empty: flag tagged items as left the cart");
    empty.onclick = o.onCartEmpty ?? (() => {});
    warn.append(empty);
    b.append(warn);
  } else if (o.page === "listing" && o.parsed === 0) {
    b.append(el("div", { class: "cct-warn" }, "Couldn't find any seller listings on this page (sold out, or Manapool changed its layout). Tagging isn't available here."));
  } else if (o.problems.length) {
    b.append(el("div", { class: "cct-warn" }, `Some lines couldn't be fully read (${o.problems.join("; ")}). Tags still work, but details may be blank.`));
  }
}

function problemsFor(lines: ParsedLine[]): string[] {
  const out: string[] = [];
  const n = (pred: (l: ParsedLine) => boolean) => lines.filter(pred).length;
  const noSeller = n((l) => !l.seller);
  const noPrice = n((l) => !l.unitPrice);
  const noCond = n((l) => !l.condition);
  if (noSeller) out.push(`${noSeller} without seller`);
  if (noPrice) out.push(`${noPrice} without price`);
  if (noCond) out.push(`${noCond} without condition`);
  return out;
}

// ---------- main loop ----------
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
      const onSettings = (s: Partial<Settings>) => void saveSettings(s).then(tick);

      if (adapter.isCart(location.href)) {
        const handles = adapter.scanCart(document, location.href);
        const lines = handles.map((h) => h.line);
        const problems = problemsFor(lines);
        void saveHealth("cart", { path: location.pathname, parsed: lines.length, problems });
        // With zero lines we can't tell "empty cart" from "couldn't read it", so never flag items as missing.
        await store.syncCart(lines, settings.autoTag, lines.length > 0);
        const fresh = await store.load();
        renderBanner({
          data: fresh,
          settings,
          page: "cart",
          parsed: lines.length,
          problems,
          onSettings,
          onTagAll: async () => {
            const id = fresh.activeCommanderId;
            if (!id) return;
            for (const h of handles) await store.tagToCommander(lineToDraft(h.line), id);
            await tick();
          },
          onCartEmpty: () => void store.syncCart([], false, true).then(tick).catch(fail),
        });
        for (const h of handles) injectCartLine(h, fresh);
      } else if (adapter.isListing(location.href)) {
        const data = await store.load();
        listingHandles = adapter.scanListing(document, location.href);
        const lines = listingHandles.map((h) => h.line);
        const problems = problemsFor(lines);
        void saveHealth("listing", { path: location.pathname.split("/").slice(0, 3).join("/"), parsed: lines.length, problems });
        renderBanner({ data, settings, page: "listing", parsed: lines.length, problems, onSettings });
        for (const h of listingHandles) injectListingLine(h, data);
      } else {
        document.getElementById(BANNER_ID)?.remove();
        listingHandles = [];
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

// ---------- auto-tag on a confirmed add ----------
interface PendingAdd {
  line: ParsedLine;
  at: number;
  timeout: number;
}
let pending: PendingAdd | null = null;

/** The user clicked a site Add button: remember which row, and wait for the site's own request to succeed. */
document.addEventListener(
  "click",
  (ev) => {
    const adapter = adapterFor(location.href);
    if (!adapter?.isListing(location.href) || !(ev.target instanceof Element)) return;
    const hit = listingHandles.find((h) => h.addButton.contains(ev.target as Element));
    if (!hit) return;
    if (pending) window.clearTimeout(pending.timeout);
    const line = hit.line;
    pending = {
      line,
      at: Date.now(),
      timeout: window.setTimeout(() => {
        pending = null;
        toast("Couldn't confirm that add, so it wasn't tagged. Use Tag (manual) under the listing, or tag it from the cart.", true);
      }, CONFIRM_WAIT_MS),
    };
  },
  true,
);

window.addEventListener("message", async (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  const msg = ev.data;
  if (!msg || msg.source !== SIGNATURE || msg.type !== "cart-change" || !Array.isArray(msg.changes)) return;
  const p = pending;
  if (!p || Date.now() - p.at > CONFIRM_WAIT_MS + 500) return; // an add we didn't click (recommendations etc.): cart sync handles it
  window.clearTimeout(p.timeout);
  pending = null;
  const delta = (msg.changes as { delta?: number }[]).reduce((n, c) => n + (Number(c.delta) > 0 ? Number(c.delta) : 0), 0);
  if (delta <= 0) return;
  try {
    const settings = await loadSettings();
    if (!settings.autoTagOnAdd) return;
    const data = await store.load();
    const id = data.activeCommanderId;
    const cmd = id ? data.commanders[id] : undefined;
    if (!id || !cmd) {
      toast("Added to cart, but no Active commander is set, so it wasn't tagged.", true);
      return;
    }
    await store.recordAdd(lineToDraft(p.line), id, delta);
    toast(`Tagged ${delta}× ${p.line.name} to ${cmd.name}`);
    schedule();
  } catch (e) {
    fail(e);
  }
});

const obs = new MutationObserver((muts) => {
  const own = (m: MutationRecord) =>
    m.target instanceof Element && !!m.target.closest?.("#cct-banner, #cct-toast, .cct-root");
  if (muts.every(own)) return;
  schedule();
});
obs.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
window.addEventListener("popstate", schedule);
chrome.storage.onChanged.addListener(() => schedule());
schedule();
