import { manapool } from "./manapool";
import type { SiteAdapter } from "./types";

export const adapters: SiteAdapter[] = [manapool];

export function adapterFor(url: string): SiteAdapter | null {
  return adapters.find((a) => a.match(url)) ?? null;
}

export type { ParsedLine, SiteAdapter, CartLineHandle, ListingLineHandle } from "./types";
