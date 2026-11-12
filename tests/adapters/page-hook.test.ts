// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

const sent: any[] = [];
let calls: { url: string; init?: RequestInit }[] = [];

beforeAll(async () => {
  window.postMessage = ((msg: unknown) => void sent.push(msg)) as typeof window.postMessage;
  let ok = true;
  (window as any).__setOk = (v: boolean) => (ok = v);
  window.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    calls.push({ url: typeof input === "string" ? input : input.url, init });
    return { ok, status: ok ? 200 : 500 } as Response;
  }) as any;
  await import("../../src/content/page-hook");
});

const ADD = "https://sb-api.manapool.com/rest/v1/rpc/synchronize_cart_items?select=x";
const body = JSON.stringify({ changes: [{ inventory_id: "abc", delta_quantity: 1, source: "listing", optimizer_touched: false }] });

describe("page hook", () => {
  it("reports a successful add and passes the request through untouched", async () => {
    sent.length = 0;
    calls = [];
    const res = await window.fetch(ADD, { method: "POST", body, headers: { authorization: "secret" } });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.body).toBe(body);
    expect(sent).toEqual([{ source: "cct-page", type: "cart-change", changes: [{ listingId: "abc", delta: 1 }] }]);
    expect(JSON.stringify(sent)).not.toContain("secret"); // never leaks headers
  });
  it("reports nothing when the server rejected the add", async () => {
    sent.length = 0;
    (window as any).__setOk(false);
    await window.fetch(ADD, { method: "POST", body });
    (window as any).__setOk(true);
    expect(sent).toEqual([]);
  });
  it("ignores unrelated requests", async () => {
    sent.length = 0;
    await window.fetch("https://sb-api.manapool.com/rest/v1/inventory?id=in.(abc)");
    expect(sent).toEqual([]);
  });
  it("still returns the response when the body isn't JSON", async () => {
    sent.length = 0;
    const res = await window.fetch(ADD, { method: "POST", body: "garbage" });
    expect(res.ok).toBe(true);
    expect(sent).toEqual([]);
  });
});
