# Tab Pad — Chrome Web Store submission kit

Everything needed to publish. The packaged extension is `tab-pad-1.0.0.zip` at the repo root (rebuilt from `dist/` — run `npm run build` then re-zip if you change code).

---

## Store listing

**Name:** Tab Pad

**Short description** (max 132 chars — this shows in search results):
> Your daily notepad in every new tab. One page per day, instant saving, everything stays on your device.

**Category:** Productivity → Workflow & Planning (or "Tools")

**Language:** English

**Detailed description:**

> Every new tab is today's page.
>
> Tab Pad replaces your new tab with a simple daily notepad. Open a tab, start typing — no clicks, no loading, no account. Yesterday's notes are one scroll away, and every day you've ever written is right there in one continuous timeline.
>
> WRITE WITHOUT THINKING ABOUT IT
> • The cursor is ready the moment the tab opens — just type
> • Every keystroke saves instantly to your device
> • Markdown as you type: headings, **bold**, *italic*, lists, checkboxes ([] + space), links, quotes
> • Tasks with real checkboxes you can tick off on any day
>
> YOUR WHOLE HISTORY, ONE SCROLL
> • Smooth continuous timeline — scroll up for coming days, down through everything you've written
> • Mini calendar with dots on noted days; jump anywhere with one click
> • ⌘K jumps by natural language: "friday", "nov 12", "two weeks ago", "next monday"
> • Shift+↑ / Shift+↓ steps between days
>
> MAKE IT YOURS
> • Scratchpad panel or a per-day margin for side notes
> • Light, dark, or system theme; six accent colors; serif, sans, or monospace
>
> YOUR DATA IS YOURS
> • 100% local — notes never leave your computer; no account, no server, no tracking, no analytics
> • Zero permissions requested
> • One-click JSON export/import for backups
> • Optional folder mirror: writes each day as a plain Markdown (.md) file to a folder you choose — plays nicely with Obsidian or any text tooling
>
> Tab Pad is for people who think in days: a running log, meeting scraps, todos, gratitude lines, ideas — whatever today needs to hold.

**Single-purpose statement** (asked in the dashboard):
> Tab Pad replaces the browser's new-tab page with a local, per-day notepad.

**Permissions justification** (asked per-permission; Tab Pad requests none):
> The extension requests no permissions. It only overrides the new-tab page (`chrome_url_overrides.newtab`). All data is stored locally via IndexedDB. The optional folder-mirror feature uses the File System Access API, which prompts the user to pick a folder at time of use — no manifest permission is involved.

**Remote code:** None. All scripts are bundled in the package (declare "No, I am not using remote code").

---

## Privacy tab (Chrome dashboard data-usage disclosures)

- Does the extension collect user data? **No** for every category (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity, website content).
- Notes typed by the user are stored **only** in the browser's local IndexedDB and, if the user opts in, mirrored to a local folder they explicitly choose. Nothing is transmitted anywhere.
- Certify: data is not sold, not used for unrelated purposes, not used for creditworthiness.

**Privacy policy URL:** https://tabpad.app/privacy.html (live via GitHub Pages from `site/privacy.html`).

---

## Assets to prepare

**Icons** — already in the package (16/48/128 px). The 128px store icon should read at small sizes: consider the accent-blue dot + a rounded page glyph on the paper background color (#fafaf7 light).

**Screenshots** — 1280×800 PNG (up to 5). Take them with a seeded profile so the notes look real but tidy. Suggested set, in order (first one matters most):

1. **Hero — "today, ready to write."** Fresh tab, today's page focused with a believable half-written day: a heading, two ticked + one unticked checkbox, a bold word. Calendar on the left with a few noted dots. Light theme, blue accent.
2. **The timeline.** Mid-scroll showing 3–4 past days flowing continuously, cursor hovering a past day. Caption overlay: "Every day you've written. One scroll."
3. **⌘K natural-language jump.** Palette open with "two weeks ago" typed. Caption: "Jump anywhere: friday, nov 12, two weeks ago."
4. **Dark theme + accent + margin layout.** Dark mode, purple accent, per-day margin visible with side notes. Shows customization in one shot.
5. **Privacy/data card.** Settings sheet open on the storage section (folder mirror + export), with a caption: "100% local. Export anytime. Mirror to plain .md files."

Tip for consistent shots: set the window to exactly 1280×800 (or 2560×1600 and let the store downscale), hide bookmarks bar, use the same seeded data for all shots.

**Small promo tile (440×280, optional but recommended):** wordmark "tab pad" + brand dot on the paper background, tagline "your day, in every new tab."

**Marquee (1400×560, optional):** hero screenshot on the right half, tagline + "100% local" badge on the left.

---

## Publishing steps

1. Create a developer account at https://chrome.google.com/webstore/devconsole ($5 one-time fee).
2. "New item" → upload `tab-pad-1.0.0.zip`.
3. Fill the Store Listing tab with the texts above + screenshots.
4. Privacy tab: single-purpose statement, "no permissions", data disclosures as above, privacy policy URL.
5. Distribution: Public, all regions (or your pick). Pricing: free.
6. Submit for review. New-tab-override extensions get standard review; expect a few days. Common rejection to pre-empt: the listing must clearly say it replaces the new tab (the description above does, twice).

**Versioning for updates:** bump `version` in `manifest.json` (and package.json), `npm run build`, re-zip `dist/`, upload. Existing users' data is untouched by updates (it lives in IndexedDB under the extension's ID).

**Note on internal names:** the IndexedDB database, localStorage keys, and cross-tab channel are still named `daybook` internally. This is deliberate — renaming them would orphan existing users' notes. Never change them.
