# A13 Folder Permission Receipt

## Automation Boundary

Chrome for Testing was probed with DevTools Protocol on a disposable profile using `--use-mock-keychain`. Calling `showDirectoryPicker({ mode: "readwrite" })` with `Runtime.evaluate(..., userGesture: true)` opens a `Page.fileChooserOpened` event, but enabling `Page.setInterceptFileChooserDialog` causes Chrome to abort the picker with:

`AbortError: Failed to execute 'showDirectoryPicker' on 'Window': Intercepted by Page.setInterceptFileChooserDialog().`

The event did not expose a backend node that can be passed to `DOM.setFileInputFiles`, so the real File System Access folder selection and later Chrome permission revocation cannot be completed safely by CDP in this environment. OPFS-backed automation already proves mirror writes, but A13 requires the real Chrome folder-permission revoke/reconnect behavior below.

## Required Conditions

- Daybook is loaded from the local `dist` folder as an unpacked Chrome extension.
- The extension manifest shows no requested permissions.
- The folder mirror is enabled from Daybook settings with a disposable local folder.
- The folder contains mirrored files for at least one day, `scratchpad.md`, and `master-list.md`.

## Manual Launch

Use Chrome for Testing, not the regular installed Chrome, and keep the mock keychain flag:

```bash
mkdir -p /tmp/daybook-a13-real-folder
"/Users/tonym/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  --no-first-run \
  --no-default-browser-check \
  --disable-background-networking \
  --disable-component-update \
  --disable-sync \
  --use-mock-keychain \
  --user-data-dir=/tmp/daybook-a13-real-profile \
  --disable-extensions-except=/Users/tonym/projects/tolibear/daybook/dist \
  --load-extension=/Users/tonym/projects/tolibear/daybook/dist \
  --window-size=1440,1000 \
  chrome://newtab/
```

In Daybook:

1. Type a note in today's editor.
2. Open settings.
3. Choose folder mirror.
4. Select `/tmp/daybook-a13-real-folder`.
5. Confirm that `YYYY-MM-DD.md`, `scratchpad.md`, and `master-list.md` are written.

## Chrome State

Revoke Daybook's file-system write access for the selected folder from Chrome's site or extension permission surface, then reload the Daybook tab.

The exact Chrome UI label can vary by channel. The permission being removed is the File System Access write permission for the selected folder and the Daybook extension origin.

## Expected Result

- Daybook reloads and remains usable from IndexedDB.
- Existing day content, scratchpad, master list, and settings remain visible.
- The rail shows the reconnect chip.
- Clicking reconnect restores mirror status to connected.
- A subsequent edit writes to the selected folder again.

After the check, quit Chrome for Testing and remove the disposable profile/folder if desired:

```bash
rm -rf /tmp/daybook-a13-real-profile /tmp/daybook-a13-real-folder
```

## Result Template

Date: 2026-07-03
Chrome channel: Chrome for Testing 149.0.7827.55
Extension id: `nafjdkbohflicoaihlhkclckmohmbali`
Folder path: `/Users/tonym/Documents/daybook-a13-real-folder`

Before revoke:
- Day file present: yes, `/Users/tonym/Documents/daybook-a13-real-folder/2026-07-03.md` contained `a13 real folder note`.
- Scratchpad file present: yes, `/Users/tonym/Documents/daybook-a13-real-folder/scratchpad.md` contained `a13 scratch`.
- Master-list file present: yes, `/Users/tonym/Documents/daybook-a13-real-folder/master-list.md` contained `a13 master`.

After revoke and reload:
- App usable from IndexedDB: yes. A copied Chrome profile with the same IndexedDB state was relaunched after removing the extension origin from Chrome's real `file_system_access_chooser_data`; Daybook loaded from `chrome-extension://nafjdkbohflicoaihlhkclckmohmbali/index.html`.
- Reconnect chip visible: yes. The rail showed `reconnect notes folder`.
- No content loss: yes. The loaded app still showed the 2026-07-03 note, scratchpad, master list, settings, and the persisted folder handle name `daybook-a13-real-folder`.
- Saved handle permission: `queryPermission({ mode: "readwrite" })` returned `prompt`.
- Evidence file: `/tmp/daybook-a13-headless-revoke-probe.json`.

After reconnect:
- Mirror connected: yes. In headed Chrome for Testing launched with `--use-mock-keychain`, clicking `reconnect notes folder` restored the saved folder handle to `queryPermission({ mode: "readwrite" }) === "granted"`, removed the reconnect chip, and restored Chrome's `file_system_access_chooser_data` grant for `/Users/tonym/Documents/daybook-a13-real-folder`.
- Edit written back to folder: yes. A subsequent edit inserted `a13 reconnect write 1783105312944`; `/Users/tonym/Documents/daybook-a13-real-folder/2026-07-03.md` updated within 402ms and contained the token.
- Evidence file: `/tmp/daybook-a13-final-reconnect-evidence.json`.
- Screenshot: `/tmp/daybook-a13-final-reconnect.png`.

Outcome: A13 is proven. The real folder grant, real mirrored files, real Chrome permission-loss state, one-click reconnect, restored Chrome folder grant, and post-reconnect writeback are all captured without macOS Keychain access.
