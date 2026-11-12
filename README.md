# Commander Cart Tagger

Chrome (MV3) extension that tags cart items on card marketplaces to the Commander deck they're for,
and shows your shopping organized per commander. All data stays in `chrome.storage.local`; the only
external call is the Scryfall API (cached). It never automates checkout.

Status: **v0.2.0 (test build)**. Manapool only; TCGplayer is not implemented.

## Install (unpacked)

```bash
npm install
npm run build        # outputs dist/
```

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `dist/` folder.
3. Click the extension's toolbar icon to open the side panel. After code changes, run `npm run build`,
   press the reload icon on the extension card, then refresh the Manapool tab (content scripts only inject on load).

The extension ID is pinned by the `key` in `manifest.json` (`aljicogeefbhhfajalpdpmmhblepbamg`), so data survives
moving the folder. For testers: see [TESTING.md](TESTING.md). `npm run package` writes `release/commander-cart-tagger-v<version>.zip`
(attach it to a GitHub Release).

## Use it

1. In the side panel, search Scryfall and add the commanders you're shopping for. Set one **Active**.
2. On a Manapool **card page**, with *Auto-tag when I click + Add* on, clicking Manapool's own **+ Add** tags the
   addition to the Active commander once the site confirms it. If the add can't be confirmed you get a toast, and a
   **Tag (manual)** control sits under each listing as a fallback.
3. On the **cart**, every line has a commander picker, a quantity box and a Tag button, so one line can be split
   across decks (qty 3 = Atraxa 1 + Korvold 1 + Muldrotha 1). Optionally auto-tag untagged lines to Active.
4. The side panel groups items per commander: status (`in cart` / `waiting on price` / `bought`), a note, the
   commander's share of the line, and a **left cart** badge for items that were in your cart and no longer are.
5. **Copy list** copies `1 Card Name (SET) 123` lines, **Copy names only** copies `1 Card Name`, **Copy all lists**
   merges every commander. **Export data / Import data** make and restore a JSON backup.
6. **Safety net:** deleting a commander or importing can be undone for 5 minutes; a dated backup is saved to
   `Downloads/Commander Cart Tagger backups/` after changes (at most about once a day, toggle in the panel footer,
   uses the `downloads` permission); the panel footer shows when you last backed up and warns after a week.

## How it works

- `src/core`: model (versioned, `schemaVersion` 2), storage, migrations, Scryfall client. Site-agnostic.
- All writes go through the service worker (`src/background`) via `src/core/client.ts`, so tabs and the panel can't overwrite each other.
- `src/adapters/<site>.ts`: everything site-specific (selectors, how to recognise the add-to-cart request).
- `src/content/page-hook.ts` runs in the page's own JS world and only watches the adapter's add-to-cart request, reporting
  `{listingId, delta}` after the server accepted it. It never reads headers, cookies or tokens.
- Failures are visible: if a page yields no lines, or lines are missing seller/price/condition, a banner says so,
  and **Copy debug info** includes what the last page read produced.

## Dev

`npm test` (Vitest), `npm run typecheck`, `npm run watch`.

Layout: `src/core` (model, storage, Scryfall), `src/sidepanel` (UI), `src/background` (service worker),
`src/content` (page injection), `src/adapters` (per-site parsers), `tests/fixtures` (saved site HTML).

Data is versioned (`schemaVersion` in `src/core/model.ts`); add a step in `src/core/migrations.ts` when it changes.

## Adding a site adapter

1. Create `src/adapters/<site>.ts` exporting a `SiteAdapter` (see `src/adapters/types.ts`): `match`, `isCart`, `isListing`,
   `scanCart`, `scanListing`, and optionally `addRequest` (URL substring + body parser for the site's add-to-cart call).
   Keep every selector in that file.
2. Register it in `src/adapters/index.ts`.
3. Add its origin to `host_permissions` and to **both** `content_scripts` entries in `manifest.json`.
4. Save the site's real pages under `tests/fixtures/<site>/` (redact personal data) and write parser tests against them.

## Privacy

All data stays in `chrome.storage.local`. The only external call is to the Scryfall API (commander search, cached).
No analytics, no accounts. The extension never automates checkout or purchasing. Not affiliated with Manapool or Scryfall.
