import type { ParsedLine, SiteAdapter, CartLineHandle, ListingLineHandle } from "./types";
import { badges, classifyFinish, parseMoney, parseQty, pickCondition, pickLanguage, text } from "./parse";

const SITE = "manapool";

function pageUrl(url: string, fallbackPath: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return fallbackPath;
  }
}

function listingMeta(url: string): { setCode: string; collectorNumber: string } {
  try {
    const m = new URL(url).pathname.match(/^\/card\/([^/]+)\/([^/]+)/);
    if (m) return { setCode: m[1] ?? "", collectorNumber: m[2] ?? "" };
  } catch {
    /* ignore */
  }
  return { setCode: "", collectorNumber: "" };
}

const SHOP_HREF = /\/shop\/[^/?#]+\/?$/;

/** Distinct seller shop links under `root` (a seller can be linked several times). */
function shopLinks(root: Element): Map<string, Element[]> {
  const byHref = new Map<string, Element[]>();
  for (const a of root.querySelectorAll('a[href*="/shop/"]')) {
    const href = (a.getAttribute("href") ?? "").split(/[?#]/)[0] ?? "";
    if (!SHOP_HREF.test(href)) continue;
    byHref.set(href, [...(byHref.get(href) ?? []), a]);
  }
  return byHref;
}

/** Seller display name = first anchor for the shop that has visible text (some are image-only). */
function sellerName(anchors: Element[]): string {
  for (const a of anchors) {
    const t = text(a);
    if (t && t.toLowerCase() !== "verified seller") return t;
  }
  return "";
}

/** Walk up from `el` to the nearest ancestor that contains exactly one distinct seller. */
function sellerNear(el: Element): string {
  let n: Element | null = el.parentElement;
  let found = "";
  while (n) {
    const shops = shopLinks(n);
    if (shops.size === 1) found = sellerName([...shops.values()][0]!);
    if (shops.size > 1) break;
    n = n.parentElement;
  }
  return found;
}

function lineFromCartLi(li: HTMLElement, url: string): ParsedLine | null {
  const name = text(li.querySelector("h3"));
  if (!name) return null;
  const set = text(li.querySelector("p.mb-1, p.text-gray-500"));
  const qtyBtn = li.querySelector<HTMLElement>('button[aria-label="Update Quantity"]');
  const qty = parseQty(text(qtyBtn) || "1");
  let unitPrice = 0;
  let currency = "USD";
  for (const p of li.querySelectorAll("p")) {
    if (!p.className.includes("font-medium")) continue;
    const m = parseMoney(text(p));
    if (m) {
      unitPrice = m.amount;
      currency = m.currency;
      break;
    }
  }
  const b = badges(li);
  return {
    site: SITE,
    name,
    set,
    collectorNumber: "",
    finish: classifyFinish(b),
    condition: pickCondition(b),
    language: pickLanguage(b),
    seller: sellerNear(li),
    unitPrice,
    currency,
    listingUrl: pageUrl(url, "https://manapool.com/cart"),
    quantity: qty,
  };
}

function listingName(doc: Document): string {
  return text(doc.querySelector("h1")) || text(doc.querySelector("title")).split(" - ")[0] || "";
}

function listingSet(doc: Document, setCode: string): string {
  const t = text(doc.querySelector("title"));
  const parts = t.split(" - ");
  if (parts.length >= 2) return parts.slice(1).join(" - ").replace(/\s*[|·].*$/, "").trim();
  return setCode.toUpperCase();
}

function listingRow(addBtn: HTMLElement, page: string, name: string, set: string, num: string): ParsedLine | null {
  let row: Element | null = addBtn;
  let n: Element | null = addBtn.parentElement;
  while (n) {
    const addCount = [...n.querySelectorAll("button")].filter((b) => /\+\s*Add/i.test(text(b))).length;
    if (addCount > 1) break;
    const hasShop = n.querySelector('a[href*="/shop/"]');
    if (hasShop) row = n;
    n = n.parentElement;
  }
  if (!row) return null;
  const seller = sellerName([...shopLinks(row).values()][0] ?? []);
  const b = badges(row);
  let unitPrice = 0;
  let currency = "USD";
  for (const el of row.querySelectorAll("div, span, p")) {
    const raw = text(el);
    if (!/^\$\d/.test(raw) || raw.length > 12) continue;
    const m = parseMoney(raw);
    if (m) {
      unitPrice = m.amount;
      currency = m.currency;
      break;
    }
  }
  return {
    site: SITE,
    name,
    set,
    collectorNumber: num,
    finish: classifyFinish(b),
    condition: pickCondition(b),
    language: pickLanguage(b),
    seller,
    unitPrice,
    currency,
    listingUrl: pageUrl(page, page),
    quantity: 1,
  };
}

export const manapool: SiteAdapter = {
  id: SITE,
  match(url) {
    try {
      const h = new URL(url).hostname;
      return h === "manapool.com" || h.endsWith(".manapool.com");
    } catch {
      return false;
    }
  },
  isCart(url) {
    try {
      return new URL(url).pathname === "/cart" || new URL(url).pathname.startsWith("/cart/");
    } catch {
      return false;
    }
  },
  isListing(url) {
    try {
      return /^\/card\/[^/]+\/[^/]+/.test(new URL(url).pathname);
    } catch {
      return false;
    }
  },
  scanCart(doc, pageUrlStr) {
    const out: CartLineHandle[] = [];
    for (const btn of doc.querySelectorAll<HTMLElement>('button[aria-label="Update Quantity"]')) {
      const li = btn.closest<HTMLElement>("li");
      if (!li) continue;
      const line = lineFromCartLi(li, pageUrlStr);
      if (!line) continue;
      out.push({ element: li, line });
    }
    return out;
  },
  scanListing(doc, pageUrlStr) {
    const { collectorNumber, setCode } = listingMeta(pageUrlStr);
    const name = listingName(doc);
    const set = listingSet(doc, setCode);
    const out: ListingLineHandle[] = [];
    for (const btn of doc.querySelectorAll<HTMLElement>("button")) {
      if (!/\+\s*Add/i.test(text(btn))) continue;
      const line = listingRow(btn, pageUrlStr, name, set, collectorNumber);
      if (!line || !line.seller) continue;
      out.push({ element: btn.parentElement ?? btn, addButton: btn, line });
    }
    return out;
  },
};
