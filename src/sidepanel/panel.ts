import { store } from "../core/storage";
import { searchCommanders, type CommanderResult } from "../core/scryfall";
import { commanderTotals, type Color, type StoreData } from "../core/model";

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
function render(data: StoreData) {
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
      const ul = el("ul", { class: "items" });
      for (const item of Object.values(data.items)) {
        const a = item.allocations.find((x) => x.commanderId === id);
        if (!a) continue;
        ul.append(el("li", {}, `${a.qty} ${item.name}`, `$${(a.qty * item.unitPrice).toFixed(2)}`));
      }
      section.append(
        el("div", { class: "cmd-body" }, ul.children.length ? ul : el("p", { class: "muted" }, "No items tagged yet.")),
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
  timer = window.setTimeout(() => runSearch(searchEl.value), 250); // be polite to Scryfall
  if (searchEl.value.trim().length < 2) hideResults();
});
searchEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") (resultsEl.firstElementChild as HTMLElement | null)?.click();
  if (e.key === "Escape") hideResults();
});

// ---------- init ----------
store.load().then(render).catch(showError);
chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "local") store.load().then(render).catch(showError);
});
