# Commander Cart Tagger

Chrome (MV3) extension that tags cart items on card marketplaces to the Commander deck they're for,
and shows your shopping organized per commander. All data stays in `chrome.storage.local`; the only
external call is the Scryfall API (cached). It never automates checkout.

Status: **Phase 1** (skeleton, side panel, commander CRUD, Scryfall search, active switching, storage).
Sites planned: Manapool first (TCGplayer later).

## Install (unpacked)

```bash
npm install
npm run build        # outputs dist/
```

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Click the extension's toolbar icon to open the side panel. After code changes, run `npm run build` and press the reload icon on the extension card.

## Verify Phase 1

1. In the side panel, type e.g. `atraxa` → pick **Atraxa, Praetors' Voice** (shows color pips WUBG).
2. Add a second commander (`korvold`). The first one added is Active; click **Set active** on the other and confirm the highlight moves.
3. Click a commander's name to collapse/expand. Close and reopen the panel: everything persists.
4. Repeat the same search; it should return instantly (cached). ✕ deletes a commander.

## Dev

`npm test` (Vitest), `npm run typecheck`, `npm run watch`.

Layout: `src/core` (site-agnostic model, storage, migrations, Scryfall), `src/sidepanel` (UI),
`src/background` (service worker), `src/adapters` (per-site, Phase 2+), `tests/fixtures` (saved site HTML).

Data is versioned (`schemaVersion` in `src/core/model.ts`); add a step in `src/core/migrations.ts` when it changes.

## Adding a site adapter

Coming with the adapter interface in Phase 3.
