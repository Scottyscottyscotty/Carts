import type { Finish } from "../core/model";

const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG", "SP", "PO"];
const LANGS = ["EN", "JP", "JA", "PH", "KO", "ZH", "FR", "DE", "IT", "ES", "PT", "RU"];

export function parseMoney(text: string): { amount: number; currency: string } | null {
  const m = text.replace(/,/g, "").match(/\$(\d+(?:\.\d{1,2})?)/);
  if (!m) return null;
  return { amount: Number(m[1]), currency: "USD" };
}

export function classifyFinish(badges: string[]): Finish {
  const t = badges.map((b) => b.toLowerCase());
  if (t.some((b) => b.includes("etch"))) return "etched";
  if (t.some((b) => b === "foil" || b.includes("foil"))) return "foil";
  return "nonfoil";
}

export function pickCondition(badges: string[]): string {
  return badges.find((b) => CONDITIONS.includes(b.toUpperCase())) ?? "";
}

export function pickLanguage(badges: string[]): string {
  const hit = badges.find((b) => LANGS.includes(b.toUpperCase()));
  return hit ? hit.toUpperCase() : "EN";
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Badge-like short labels inside a line (NM, Foil, EN, …). */
export function badges(root: Element): string[] {
  const out: string[] = [];
  for (const span of root.querySelectorAll("span")) {
    const t = text(span);
    if (!t || t.length > 12) continue;
    if (CONDITIONS.includes(t.toUpperCase()) || LANGS.includes(t.toUpperCase())) out.push(t);
    else if (/^(foil|etched|non-?foil)$/i.test(t)) out.push(t);
  }
  return out;
}

export function parseQty(raw: string): number {
  const m = raw.replace(/,/g, "").match(/(\d+)/);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}
