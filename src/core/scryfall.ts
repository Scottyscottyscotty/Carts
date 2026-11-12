import type { Color } from "./model";
import { ext } from "./ext";

export interface CommanderResult {
  scryfallId: string;
  name: string;
  colorIdentity: Color[];
  imageUrl: string;
}

const CACHE_KEY = "scryfallCache";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

type Cache = Record<string, { at: number; results: CommanderResult[] }>;

function toResult(card: any): CommanderResult {
  const img =
    card.image_uris?.small ??
    card.card_faces?.[0]?.image_uris?.small ??
    "";
  return {
    scryfallId: card.id,
    name: card.name,
    colorIdentity: (card.color_identity ?? []) as Color[],
    imageUrl: img,
  };
}

async function readCache(): Promise<Cache> {
  const r = await ext.storage.local.get(CACHE_KEY);
  return (r[CACHE_KEY] as Cache) ?? {};
}

/**
 * Search legal commanders by name. Uses Scryfall search with `is:commander`,
 * which also covers partner/background/"can be your commander" cards.
 * Results are cached in chrome.storage.local.
 */
export async function searchCommanders(
  query: string,
  signal?: AbortSignal,
): Promise<CommanderResult[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const cache = await readCache();
  const hit = cache[q];
  if (hit && Date.now() - hit.at < TTL_MS) return hit.results;

  const url =
    "https://api.scryfall.com/cards/search?" +
    new URLSearchParams({ q: `${q} is:commander`, unique: "cards", order: "edhrec" });
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });

  let results: CommanderResult[] = [];
  if (res.status === 404) {
    results = []; // no matches
  } else if (!res.ok) {
    throw new Error(`Scryfall error ${res.status}`);
  } else {
    const json = await res.json();
    results = (json.data as any[]).slice(0, 10).map(toResult);
  }

  cache[q] = { at: Date.now(), results };
  const keys = Object.keys(cache);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => cache[a]!.at - cache[b]!.at)
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => delete cache[k]);
  }
  await ext.storage.local.set({ [CACHE_KEY]: cache });
  return results;
}
