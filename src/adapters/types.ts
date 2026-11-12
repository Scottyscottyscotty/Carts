import type { Finish } from "../core/model";

/** One sellable line as it appears on a marketplace page. */
export interface ParsedLine {
  site: string;
  name: string;
  set: string;
  collectorNumber: string;
  finish: Finish;
  condition: string;
  language: string;
  seller: string;
  unitPrice: number;
  currency: string;
  listingUrl: string;
  quantity: number;
}

export interface CartLineHandle {
  element: HTMLElement;
  line: ParsedLine;
}

export interface ListingLineHandle {
  element: HTMLElement;
  addButton: HTMLElement;
  line: ParsedLine;
}

/** One item the site is being asked to add to (or remove from) the cart. */
export interface CartChange {
  /** The site's own listing id. */
  listingId: string;
  /** Quantity delta (positive = add). */
  delta: number;
}

/** How to recognize the site's own add-to-cart request, so tagging can confirm an add actually happened. */
export interface AddRequestSpec {
  /** Substring of the request URL. */
  urlIncludes: string;
  /** Parse the request body; return [] if it isn't an add. Must never throw. */
  parseBody(body: string): CartChange[];
}

export interface SiteAdapter {
  id: string;
  match(url: string): boolean;
  isCart(url: string): boolean;
  isListing(url: string): boolean;
  scanCart(doc: Document, pageUrl: string): CartLineHandle[];
  scanListing(doc: Document, pageUrl: string): ListingLineHandle[];
  /** Optional: lets the extension confirm a click on the site's Add button really added to the cart. */
  addRequest?: AddRequestSpec;
}
