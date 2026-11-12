/** Thin shim so the rest of the code never touches `chrome` directly (eases a Safari port). */
export const ext: typeof chrome = (globalThis as any).browser ?? (globalThis as any).chrome;
