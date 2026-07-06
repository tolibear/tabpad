# Tab Pad

Your daily notepad, one page per day, in every new tab.

Tab Pad is a Chrome extension that replaces the new-tab page with a local daily notepad. Open a tab, start typing — every keystroke saves instantly to your device. Yesterday is one scroll away.

**Website:** [tabpad.app](https://tabpad.app) · **Privacy:** [tabpad.app/privacy.html](https://tabpad.app/privacy.html)

## Features

- One page per day on a continuous, smooth-scrolling timeline
- Markdown as you type: headings, bold/italic, lists, checkboxes (`[] ` + space), links
- ⌘K natural-language date jumps: "friday", "nov 12", "two weeks ago"
- Scratchpad panel or per-day margins for side notes
- Light/dark themes, six accent colors, serif/sans/mono
- 100% local: no server, no account, zero permissions, works offline
- Your notes live as plain `.md` files in a folder you choose — readable and writable by other apps and AI agents (an `AGENTS.md` contract file is generated in the folder); JSON export/import for backups

## Development

```sh
npm install
npm run dev        # vite dev server
npm run build      # builds the extension into dist/
npm run typecheck
```

Load it in Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" → pick `dist/`.

The landing page lives in `site/` and is deployed to GitHub Pages.

## Privacy

Tab Pad collects nothing. All notes live in your browser's IndexedDB; the optional folder mirror and export write files only to locations you choose. See [the privacy policy](https://tabpad.app/privacy.html).

## License

[MIT](LICENSE)
