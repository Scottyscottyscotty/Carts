import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { manapool } from "../../src/adapters/manapool";

const dir = dirname(fileURLToPath(import.meta.url));
const cartHtml = readFileSync(join(dir, "../fixtures/manapool/cart.html"), "utf8");
const listingHtml = readFileSync(join(dir, "../fixtures/manapool/listing.html"), "utf8");

describe("manapool adapter", () => {
  it("matches cart and listing URLs", () => {
    expect(manapool.match("https://manapool.com/cart")).toBe(true);
    expect(manapool.isCart("https://manapool.com/cart")).toBe(true);
    expect(manapool.isListing("https://manapool.com/card/dmr/159/exploration")).toBe(true);
    expect(manapool.match("https://tcgplayer.com/cart")).toBe(false);
  });

  it("parses seller-grouped cart lines from the saved fixture", () => {
    const doc = new JSDOM(cartHtml).window.document;
    const lines = manapool.scanCart(doc, "https://manapool.com/cart").map((h) => h.line);
    expect(lines).toHaveLength(8);
    expect(lines.map((l) => l.name)).toEqual([
      "Flawless Maneuver",
      "Bow of Nylea",
      "Poison-Tip Archer",
      "Craterclaw Colossus",
      "Ohran Frostfang",
      "Underground River",
      "Vigorbloom Charm",
      "Pygmy Kavu",
    ]);
    expect(lines.map((l) => l.seller)).toEqual([
      "Hyperview Gaming",
      "Doffy'sShop",
      "SideQuestCards",
      "Lotus Games",
      "STG Cards",
      "Tolarian_Janitor",
      "Cephalopod Creations",
      "BrightSilverPlaneswalkerMonk",
    ]);
    expect(lines[0]).toMatchObject({
      site: "manapool",
      set: "Reality Fracture Commander",
      condition: "NM",
      unitPrice: 6.81,
      quantity: 1,
      finish: "nonfoil",
    });
    expect(lines[1]).toMatchObject({ name: "Bow of Nylea", condition: "LP", unitPrice: 3.2, set: "Theros" });
  });

  it("parses listing identity and seller rows", () => {
    const url = "https://manapool.com/card/dmr/159/exploration";
    const doc = new JSDOM(listingHtml).window.document;
    const rows = manapool.scanListing(doc, url);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows[0]?.line).toMatchObject({
      site: "manapool",
      name: "Exploration",
      collectorNumber: "159",
    });
    expect(rows[0]?.line.set.toLowerCase()).toContain("dominaria");
    expect(rows[0]?.line.seller.length).toBeGreaterThan(0);
    expect(rows[0]?.line.unitPrice).toBeGreaterThan(0);
  });
});
