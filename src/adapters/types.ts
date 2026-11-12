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

export interface SiteAdapter {
  id: string;
  match(url: string): boolean;
  isCart(url: string): boolean;
  isListing(url: string): boolean;
  scanCart(doc: Document, pageUrl: string): CartLineHandle[];
  scanListing(doc: Document, pageUrl: string): ListingLineHandle[];
}
