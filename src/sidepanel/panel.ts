import { store } from "../core/client";
import { loadHealth, loadSettings } from "../core/storage";
import { searchCommanders, type CommanderResult } from "../core/scryfall";
import {
  allocatedQty,
  commanderTotals,
  formatAllList,
  formatCommanderList,
  type Color,
  type ItemStatus,
  type StoreData,
} from "../core/model";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const searchEl = $<HTMLInputElement>("search");
const resultsEl = $<HTMLUListElement>("results");
const msgEl = $<HTMLParagraphElement>("search-msg");
const listEl = $<HTMLElement>("commanders");
const errEl = $<HTMLParagraphElement>("error");

function showError(e: unknown) {
  console.error(e);
  errEl.textContent = `Something went wrong: ${e instanceof Error ? e.message : String(e)}`;
  errEl.hidden = false;
}

function pips(ci: Color[]): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "pips";
  wrap.title = ci.length ? ci.join("") : "Colorless";
  for (const c of ci.length ? ci : (["C"] as const)) {
    const p = document.createElement("span");
    p.className = `pip ${c}`;
    p.textContent = c;
    wrap.append(p);
  }
  return wrap;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: (Node | string)[]
) {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props as any;
  if (cls) e.className = cls;
  Object.assign(e, rest);
  e.append(...kids);
  return e;
}

// ---------- render ----------
let pendingRender = false;
/** Don't rebuild the list while the user is typing/choosing in it (another tab's sync would wipe their input). */
function render(data: StoreData) {
  const a = document.activeElement;
  if (a && listEl.contains(a) && /^(INPUT|SELECT)$/.test(a.tagName)) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  paint(data);
}
listEl.addEventListener("focusout", () => {
  if (pendingRender) setTimeout(() => store.load().then(render).catch(showError), 0);
});

function paint(data: StoreData) {
  listEl.replaceChildren();
  if (data.commanderOrder.length === 0) {
    listEl.append(el("p", { class: "empty" }, "No commanders yet. Search above to add one."));
    return;
  }
  for (const id of data.commanderOrder) {
    const c = data.commanders[id];
    if (!c) continue;
    const isActive = data.activeCommanderId === id;
    const { count, subtotal } = commanderTotals(data, id);

    const activate = el("button", { class: "activate" + (isActive ? " on" : "") }, isActive ? "Active" : "Set active");
    activate.disabled = isActive;
    activate.onclick = () => store.setActive(id).then(render).catch(showError);

    const del = el("button", { class: "del", title: "Delete commander" }, "✕");
    del.onclick = () => {
      if (confirm(`Delete ${c.name} and its tagged items?`)) store.removeCommander(id).then(render).catch(showError);
    };

    const info = el(
      "div",
      { class: "cmd-info" },
      el("div", { class: "cmd-name" }, (c.collapsed ? "▸ " : "▾ ") + c.name),
      el("div", {}, pips(c.colorIdentity), ` ${count} item${count === 1 ? "" : "s"} · $${subtotal.toFixed(2)}`),
    );
    info.onclick = () => store.setCollapsed(id, !c.collapsed).then(render).catch(showError);

    const head = el("div", { class: "cmd-head" }, el("img", { src: c.imageUrl, alt: "" }), info, activate, del);
    const section = el("section", { class: "cmd" + (isActive ? " active" : "") }, head);

    if (!c.collapsed) {
      const tools = el("div", { class: "cmd-tools" });
      const makeCopy = (label: string, opts: { includeSet?: boolean }) => {
        const btn = el("button", {}, label);
        btn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(formatCommanderList(data, id, opts));
            btn.textContent = "Copied";
            setTimeout(() => (btn.textContent = label), 1200);
          } catch (e) {
            showError(e);
          }
        };
        return btn;
      };
      const copy = makeCopy("Copy list", { includeSet: true });
      const copyNames = makeCopy("Copy names only", {});
      const bought = el("button", {}, "Mark all bought");
      bought.onclick = () => store.markCommanderBought(id).then(render).catch(showError);
      tools.append(copy, copyNames, bought);

      const ul = el("ul", { class: "items" });
      let missing = 0;
      for (const item of Object.values(data.items)) {
        const a = item.allocations.find((x) => x.commanderId === id);
        if (!a) continue;
        const left = item.missingFromCart && a.status !== "bought";
        if (left) missing++;
        const status = el("select", {}) as HTMLSelectElement;
        for (const s of ["in_cart", "waiting_on_price", "bought"] as ItemStatus[]) {
          status.append(new Option(s.replaceAll("_", " "), s, false, a.status === s));
        }
        status.onchange = () =>
          store.setAllocationStatus(item.id, id, status.value as ItemStatus).then(render).catch(showError);

        const maxQty = Math.max(item.quantity, allocatedQty(item));
        const qty = el("input", {
          type: "number",
          min: "0",
          max: String(maxQty),
          value: String(a.qty),
          class: "qty",
          title: "Copies of this line for this commander (0 removes it)",
        }) as HTMLInputElement;
        qty.onchange = () => store.setAllocationQty(item.id, id, Number(qty.value)).then(render).catch(showError);

        const note = el("input", {
          type: "text",
          placeholder: "Note",
          value: a.note,
        }) as HTMLInputElement;
        note.onchange = () => store.setAllocationNote(item.id, id, note.value).catch(showError);

        const untag = el("button", { class: "del" }, "Untag");
        untag.onclick = () => store.untag(item.id, id).then(render).catch(showError);

        const finish = item.finish === "nonfoil" || item.finish === "unknown" ? "" : ` · ${item.finish}`;
        const badge: Node | string = left
          ? el("span", { class: "badge warn", title: "Seen in your cart before, but not there now" }, "left cart")
          : !item.seenInCart && a.status === "in_cart"
            ? el("span", { class: "badge", title: "Tagged, but not seen in your cart yet" }, "not in cart yet")
            : "";
        const shared = allocatedQty(item) > a.qty ? ` · line of ${item.quantity} shared` : "";
        const li = el(
          "li",
          { class: a.status === "bought" ? "bought" : "" },
          el(
            "div",
            { class: "item-top" },
            el("span", {}, `${a.qty}× ${item.name}`, badge),
            el("span", {}, `$${(a.qty * item.unitPrice).toFixed(2)}`),
          ),
          el(
            "div",
            { class: "item-meta" },
            `${item.set || "unknown set"} · ${item.seller || "unknown seller"} · ${item.condition || "?"}${finish}${shared}`,
          ),
          el("div", { class: "item-actions" }, qty, status, note, untag),
        );
        ul.append(li);
      }
      if (missing > 0) {
        const fix = el("button", {}, `Mark ${missing} left-cart item${missing === 1 ? "" : "s"} bought`);
        fix.onclick = () => store.markMissingBought(id).then(render).catch(showError);
        tools.append(fix);
      }
      section.append(
        el(
          "div",
          { class: "cmd-body" },
          tools,
          ul.children.length ? ul : el("p", { class: "muted" }, "No items tagged yet. Tag them on Manapool."),
        ),
      );
    }
    listEl.append(section);
  }
}

// ---------- search ----------
let timer: number | undefined;
let abort: AbortController | undefined;

function hideResults() {
  resultsEl.hidden = true;
  resultsEl.replaceChildren();
}

async function pick(r: CommanderResult) {
  hideResults();
  msgEl.hidden = true;
  searchEl.value = "";
  try {
    render(await store.addCommander(r));
  } catch (e) {
    showError(e);
  }
}

async function runSearch(q: string) {
  abort?.abort();
  abort = new AbortController();
  msgEl.hidden = true;
  try {
    const results = await searchCommanders(q, abort.signal);
    resultsEl.replaceChildren();
    if (results.length === 0) {
      if (q.trim().length >= 2) {
        msgEl.textContent = "No commanders found.";
        msgEl.hidden = false;
      }
      resultsEl.hidden = true;
      return;
    }
    for (const r of results) {
      const li = el("li", {}, el("img", { src: r.imageUrl, alt: "" }), el("div", {}, el("div", {}, r.name), pips(r.colorIdentity)));
      li.onclick = () => pick(r);
      resultsEl.append(li);
    }
    resultsEl.hidden = false;
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    msgEl.textContent = `Search failed: ${(e as Error).message}`;
    msgEl.hidden = false;
  }
}

searchEl.addEventListener("input", () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => runSearch(searchEl.value), 150); // debounced; results are cached
  if (searchEl.value.trim().length < 2) hideResults();
});
searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") (resultsEl.firstElementChild as HTMLElement | null)?.click();
  if (e.key === "Escape") hideResults();
});

// ---------- footer: copy all, backup, debug ----------
const version = chrome.runtime.getManifest().version;
$<HTMLElement>("version").textContent = `v${version}`;

function flash(btn: HTMLElement, label: string) {
  const old = btn.textContent;
  btn.textContent = label;
  setTimeout(() => (btn.textContent = old), 1400);
}

$<HTMLButtonElement>("copy-all").onclick = async (ev) => {
  try {
    const data = await store.load();
    await navigator.clipboard.writeText(formatAllList(data, { includeSet: true }));
    flash(ev.target as HTMLElement, "Copied");
  } catch (e) {
    showError(e);
  }
};

$<HTMLButtonElement>("export-data").onclick = async () => {
  try {
    const data = await store.load();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = el("a", {
      href: URL.createObjectURL(blob),
      download: `commander-cart-tagger-${new Date().toISOString().slice(0, 10)}.json`,
    });
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  } catch (e) {
    showError(e);
  }
};

const importInput = $<HTMLInputElement>("import-file");
$<HTMLButtonElement>("import-data").onclick = () => importInput.click();
importInput.onchange = async () => {
  const file = importInput.files?.[0];
  importInput.value = "";
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    if (!window.confirm("Replace ALL current commanders and tags with the contents of this file? (Export first if unsure.)")) return;
    render(await store.replaceAll(raw));
  } catch (e) {
    showError(e instanceof SyntaxError ? new Error("That file isn't valid JSON.") : e);
  }
};

$<HTMLButtonElement>("debug-info").onclick = async (ev) => {
  try {
    const [data, health, settings] = await Promise.all([store.load(), loadHealth(), loadSettings()]);
    const lines = [
      `Commander Cart Tagger v${version}`,
      `Data schema v${data.schemaVersion}: ${data.commanderOrder.length} commanders, ${Object.keys(data.items).length} items`,
      `Settings: ${JSON.stringify(settings)}`,
      `Browser: ${navigator.userAgent}`,
      "Last page reads:",
      ...Object.entries(health).map(
        ([page, h]) =>
          `  ${page}: ${h.parsed} lines parsed at ${new Date(h.at).toISOString()} on ${h.path}${h.problems.length ? ` | ${h.problems.join("; ")}` : ""}`,
      ),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    flash(ev.target as HTMLElement, "Copied");
  } catch (e) {
    showError(e);
  }
};

// ---------- init ----------
store.load().then(render).catch(showError);
chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "local") store.load().then(render).catch(showError);
});
