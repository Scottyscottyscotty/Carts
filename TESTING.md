# Testing Commander Cart Tagger (for friends)

Thanks for helping! This extension lets you pick a Commander deck and tags the cards you add on
Manapool to it, then shows your shopping grouped per deck. It's an early test build.

## What it does and doesn't do
- Everything stays **in your browser** (`chrome.storage.local`). No accounts, no server of ours.
- The only outside request is to **Scryfall** (to search commanders).
- It reads the Manapool pages you open and adds small controls to them. It **never** checks out, buys or
  changes your cart for you. You press Manapool's own buttons.
- Not affiliated with Manapool or Scryfall.

## Install (2 minutes)
1. Download `commander-cart-tagger-vX.Y.Z.zip` from the Releases page and **unzip it somewhere permanent**
   (don't delete the folder afterwards).
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder (the one containing `manifest.json`).
4. Pin the extension, then click its icon to open the side panel.
5. **Updating:** unzip the new version over the old folder, then click the reload icon on the extension card
   and refresh your Manapool tab. Your data is kept.

## Things to try
1. Add two or three commanders (search by name). Switch the Active one.
2. Open a card page on Manapool (refresh it first). With **Auto-tag when I click + Add** on, click Manapool's
   **+ Add**. You should see a toast "Tagged 1× … to <commander>" and the item in the side panel.
3. Add the same card for a second commander. Does the quantity split correctly (the number box next to each item)?
4. Open your Manapool **cart**. Do the lines show tag controls? Tag some, remove one from the cart, come back:
   does the panel say **left cart**?
5. Try **Copy list**, **Copy names only** and **Copy all lists**, and paste somewhere.
6. **Export data**, then **Import data** it back.

## If something breaks
Click **Copy debug info** in the side panel and paste it into a bug report (or message), along with what you
clicked and a screenshot. The debug info contains the version, counts, and how many lines were read on the last
pages. It has no card names, account details or cookies. Please never send cookies, tokens or `Authorization`
headers.

If a page shows "Couldn't read any lines" the site layout probably changed or looks different for you (other
country, language, sealed products...). That is exactly what we want to hear about.
