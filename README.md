# Commander Cart Tagger

Chrome (MV3) extension that tags cart items on card marketplaces to the Commander deck they're for,
and shows your shopping organized per commander. All data stays in `chrome.storage.local`; the only
external call is the Scryfall API (cached). It never automates checkout.

Status: **Phase 2** — Manapool cart/listing tagging is wired up. TCGplayer is not yet.

## Install (unpacked)

```bash
npm install
npm run build        # outputs dist/
```

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Click the extension's toolbar icon to open the side panel. After code changes, run `npm run build` and press the reload icon on the extension card.

## Use it

1. In the side panel, search Scryfall and add the commanders you're shopping for. Set one **Active**.
2. Shop on [Manapool](https://manapool.com) as usual.
3. On a **card listing**, each `+ Add` row gets a Tag control (assigns that listing to a commander).
4. On **Cart**, every line gets Tag / untag chips. Optionally enable **Auto-tag new lines to Active**, or **Tag remaining**.
5. The side panel groups tagged cards under each commander with status (`in cart` / `waiting on price` / `bought`), notes, copy-list, and mark-all-bought.

Reload the extension after rebuilding. Manapool must be refreshed once so the content script injects.

## Dev

`npm test` (Vitest), `npm run typecheck`, `npm run watch`.

Layout: `src/core` (model, storage, Scryfall), `src/sidepanel` (UI), `src/background` (service worker),
`src/content` (page injection), `src/adapters` (per-site parsers), `tests/fixtures` (saved site HTML).

Data is versioned (`schemaVersion` in `src/core/model.ts`); add a step in `src/core/migrations.ts` when it changes.

## Adding a site adapter

Implement `SiteAdapter` in `src/adapters/types.ts` (`match` / `isCart` / `isListing` / `scanCart` / `scanListing`),
register it in `src/adapters/index.ts`, add `content_scripts` + `host_permissions` in `manifest.json`,
and drop a saved HTML fixture under `tests/fixtures/<site>/`.
