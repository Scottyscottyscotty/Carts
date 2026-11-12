/**
 * Runs in the page's own JavaScript world (manifest `world: "MAIN"`) so it can see the site's fetch calls.
 * It only watches for the adapter's add-to-cart request and reports {listingId, delta} after the server
 * accepted it. It never reads headers, cookies or tokens, and never changes or replays requests.
 */
import { adapters } from "../adapters";

const SIGNATURE = "cct-page";
const specs = adapters.map((a) => a.addRequest).filter((s): s is NonNullable<typeof s> => !!s);
const realFetch = window.fetch;

if (specs.length) {
  window.fetch = async function (this: unknown, ...args: Parameters<typeof fetch>) {
    let spec: (typeof specs)[number] | undefined;
    let body = "";
    try {
      const input = args[0];
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      spec = specs.find((s) => url.includes(s.urlIncludes));
      if (spec) {
        const init = args[1];
        if (typeof init?.body === "string") body = init.body;
        else if (typeof Request !== "undefined" && input instanceof Request) body = await input.clone().text();
      }
    } catch {
      /* never interfere with the site */
    }
    const res = await realFetch.apply(this, args);
    try {
      if (spec && res.ok) {
        const changes = spec.parseBody(body);
        if (changes.length) window.postMessage({ source: SIGNATURE, type: "cart-change", changes }, location.origin);
      }
    } catch {
      /* ignore */
    }
    return res;
  } as typeof fetch;
}
