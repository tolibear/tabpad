# Tab Pad — Chrome Web Store submission kit

Everything needed to publish. The packaged extension is `tab-pad-1.1.0.zip` at the repo root (rebuilt from `dist/` — run `npm run build` then re-zip if you change code).

---

## Store listing

**Name:** Tab Pad

**Short description** (max 132 chars — this shows in search results):
> Your daily notepad in every new tab. One page per day, instant saving, 100% on your device. Markdown, focus mode, AI-agent ready.

**Category:** Productivity → Workflow & Planning (or "Tools")

**Language:** English

**Detailed description:**

> Every new tab is today's page.
>
> Tab Pad replaces your new tab with a simple daily notepad. Open a tab, start typing — no clicks, no loading, no account. Yesterday is one scroll away, and every day you've ever written lives on one continuous timeline. Future days are already there, waiting for plans.
>
> WRITE WITHOUT THINKING ABOUT IT
> • The cursor is ready the moment the tab opens — just type
> • Every keystroke saves instantly to your device
> • Markdown as you type: headings, **bold**, *italic*, ~~strikethrough~~, lists, quotes, dividers, code
> • Tri-state to-dos you click through — to-do, in progress, done ([] + space makes one)
> • Cmd/Ctrl+click opens links in a new tab
>
> YOUR WHOLE HISTORY, ONE SCROLL
> • Continuous timeline — scroll up into coming days, down through everything you've written
> • Mini calendar with dots on noted days; jump anywhere with one click
> • ⌘K jumps by natural language: "friday", "nov 12", "two weeks ago", "next monday"
>
> FOCUS MODE & PRIVACY MODE
> • Focus: one click expands the day you're working on to fill the screen — no other days, no panels
> • Privacy: one click scrambles every note into unreadable text — for screen sharing and streaming. Click again to restore.
>
> MAKE IT YOURS
> • Widget sidebars: arrange a calendar, a list of your noted days, live scratchpads (one or several), counters (streaks, open to-dos, word counts), a to-do rollup, or pinned notes — on the left and right, in any order
> • A quiet per-day margin beside each day for side notes
> • Light, dark, or system theme; six accent colors; serif, sans, or monospace
>
> YOUR DATA IS YOURS
> • 100% local — notes never leave your computer; no account, no server, no tracking, no analytics, no network requests
> • Zero permissions requested
> • Optional notes folder: your days live as plain Markdown (.md) files in a folder you choose — works with Obsidian, git, iCloud/Dropbox, any text tooling
> • Built-in safety net: before Tab Pad ever overwrites or erases file content it didn't write, the previous version is saved to a trash folder inside your notes folder
> • One-click backup — export everything as a single file (and a backup downloads automatically before "erase all")
>
> AI-AGENT READY
> • Agents can read and write the same markdown files; their edits appear in your open tab within seconds
> • A generated AGENTS.md in your folder tells any agent exactly how to behave (append, sign your edits, never clobber the human)
> • One-click connect prompt in settings wires up Claude Code or any coding agent
>
> Tab Pad is for people who think in days: a running log, meeting scraps, todos, ideas — whatever today needs to hold.

**Single-purpose statement** (asked in the dashboard):
> Tab Pad replaces the browser's new-tab page with a local, per-day notepad.

**Permissions justification** (asked per-permission; Tab Pad requests none):
> The extension requests no permissions. It only overrides the new-tab page (`chrome_url_overrides.newtab`). All data is stored locally via IndexedDB. The optional notes-folder feature uses the File System Access API, which prompts the user to pick a folder at time of use — no manifest permission is involved.

**Remote code:** None. All scripts are bundled in the package (declare "No, I am not using remote code").

---

## Privacy tab (Chrome dashboard data-usage disclosures)

- Does the extension collect user data? **No** for every category (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity, website content).
- Notes typed by the user are stored **only** in the browser's local IndexedDB and, if the user opts in, mirrored to a local folder they explicitly choose. Nothing is transmitted anywhere.
- Certify: data is not sold, not used for unrelated purposes, not used for creditworthiness.

**Privacy policy URL:** https://tabpad.app/privacy.html (live via GitHub Pages from `site/privacy.html`).

---

## Assets (produced — see ~/Desktop/tab-pad-screenshots/)

**Store icon (128×128):** `store-icon-128.png` — anti-aliased paper + accent dot, same file as the packaged `icons/128.png`.

**Screenshots (1280×800, up to 5 shown in this order):** resized store-ready copies live in `store/`. Suggested order:
1. `01-base-light` — today's page mid-use, full markdown, calendar + scratchpad
2. `05-focus-mode` — one day filling the screen
3. `06-privacy-mode` — everything scrambled for screen sharing
4. `02-dark` — dark theme
5. `07-command-k` — ⌘K with "next friday" typed

(Full-resolution 3360×2100 originals are alongside for stylized/marketing use.)

**Small promo tile (440×280):** `promo-tile-440x280.png`.
**Marquee (1400×560):** `marquee-1400x560.png`.

---

## Publishing steps

1. Create a developer account at https://chrome.google.com/webstore/devconsole ($5 one-time fee).
2. "New item" (or a new version on the existing item) → upload `tab-pad-1.1.0.zip`.
3. Fill the Store Listing tab with the texts above + screenshots.
4. Privacy tab: single-purpose statement, "no permissions", data disclosures as above, privacy policy URL.
5. Distribution: Public, all regions (or your pick). Pricing: free.
6. Submit for review. New-tab-override extensions get standard review; expect a few days. Common rejection to pre-empt: the listing must clearly say it replaces the new tab (the description above does, twice).

**After the listing is live:** replace the placeholder store links in `site/index.html` and the review link in `src/db/onboarding.ts` with the real Chrome Web Store URL, rebuild, re-zip, and push an update.

**Versioning for updates:** bump `version` in `manifest.json` (and package.json), `npm run build`, re-zip `dist/`, upload. Existing users' data is untouched by updates (it lives in IndexedDB under the extension's ID).

**Note on internal names:** storage was renamed `daybook` → `tabpad` (IndexedDB "tabpad", `tabpad:*` localStorage keys, "tabpad" broadcast channel) with a one-time automatic migration from the old names in `src/db/db.ts`. Keep the migration in place until well after launch.
