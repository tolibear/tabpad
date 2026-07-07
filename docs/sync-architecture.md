# Tab Pad Sync — architecture (v2, post-review)

> Plan drafted by Claude, adversarially reviewed by Codex (GPT-5.5, xhigh reasoning) on 2026-07-06. The review's patches below are accepted as the working design.


## Context: what Tab Pad is

Tab Pad is a Chrome new-tab extension (MV3, zero permissions, no network requests): a daily notepad, one markdown page per day on a continuous timeline, plus a persistent scratchpad panel and an optional per-day "margin" column. Local-first: IndexedDB is the store; every keystroke saves. Optionally the user connects a real folder (File System Access API) and every day becomes a plain `.md` file (`2026-07-06.md`, `margins/2026-07-06.md`, `scratchpad.md`) — two-way live sync with external editors and AI agents (an AGENTS.md contract in the folder tells agents how to write; agents' edits appear in the open tab within seconds).

## Existing data/merge model (already shipped and battle-tested)

- Day row: `{date, main, margin, createdAt, updatedAt, mainUpdatedAt, marginUpdatedAt}` — per-FIELD edit timestamps.
- Panel row: `{id: "scratchpad", content, updatedAt}`.
- Merge discipline: last-write-wins **per field**, judged by these stamps vs file mtimes. Future timestamps are clamped to `now` (clock-skew defense). Fields the user is actively typing in are deferred from sync entirely. Before the app overwrites/erases file content it didn't write itself, the losing version is copied to `.tabpad-trash/` (keep ~60).
- Settings: `{theme, accent, scratchpad, margins, weekStartsOn, editorSize, font}` in a meta table; theme/accent mirrored to localStorage for pre-React paint.

## The proposed Tab Pad Sync architecture (to be reviewed)

**Core: a dumb encrypted mailbox.** Server stores one row per `(user, key)` where key is e.g. `2026-07-06/main`, `2026-07-06/margin`, `panel/scratchpad`. Row = `{stamp, ciphertext, server_seq}`. One server rule: a write wins iff its stamp is newer than stored. All real merging stays client-side (the shipped LWW logic). Server keeps last ~10 versions per key → cheap version history feature.

**Protocol:** ~5 endpoints on one Cloudflare Worker + D1 (SQLite):
- `POST /pair` (device pairing), `POST /push` (batch of {key, stamp, ciphertext}), `GET /pull?since=<server_seq cursor>`, `GET /devices` + revoke, `POST /stripe-webhook`.
- Clients poll ~30s + on focus + push on save-debounce (mirrors the existing folder-sync rhythm). No websockets in v1; optionally a Durable Object per user later for instant push.

**E2E encryption:** user sets a sync passphrase; Argon2/PBKDF2 → AES-GCM key on device; server sees only ciphertext + stamps + key names. Lose passphrase → server copy unrecoverable, local + folder copies survive.
(Note: key names like `2026-07-06/main` leak which days have notes — acceptable? review.)

**Auth:** email magic link on tabpad.app; extension shows a 6-digit pairing code, site claims it after login, extension polls for its device token. No passwords.

**Billing:** Stripe Checkout ($4/mo, $40/yr) + Customer Portal for all management; one webhook flips `subscription_active`. Lapsed → sync pauses, nothing deleted, local keeps working.

**Tables:** users, devices, subscriptions, sync_items. Text-only payloads (KB scale); infra cost ≈ 0.

## NEW requirements to fold in (this is the main review focus)

1. **Multi-platform clients**: iPhone app (native Swift, including iOS home-screen widgets), Android app, possibly a PWA, CLI, menubar app. The Chrome extension is just one client. The sync layer must be a clean API any client can implement. Consider: what does the iOS client need that the plan lacks (push notifications? delta efficiency? partial sync? binary attachments someday? background fetch constraints)?
2. **Not just notes**: the synced surface may grow — the user mentions "the board can be synced to multiple places" — think boards/views, widget configurations, and other entity types beyond day/margin/scratchpad. How should the key/schema design anticipate new entity types without server changes?
3. **Widget sync**: the user is separately designing "widgets" (think: configurable panels/blocks — e.g. calendar embed, weather, trackers). Widget *configurations* (which widgets, their settings, layout/order) should sync across devices. Widgets may also have *data* (e.g. a habit tracker's checkmarks). How does this fit the key design and E2E model?
4. **Settings sync** across devices (currently per-browser).

## Review ask

Adversarially review this architecture as a senior systems designer. Specifically:
1. Does the dumb-mailbox LWW-per-key design hold up for multi-client (iOS/Android/extension/PWA) sync? Where does it break — offline queues, tombstones/deletes, key enumeration, pagination, huge histories, multi-entity transactions?
2. Propose the concrete generalized data model (key namespace / entity envelope) that covers days, margins, scratchpad, settings, widgets (config + data), and future "boards" — WITHOUT making the server smarter. Be specific: key formats, envelope fields, what's plaintext metadata vs ciphertext.
3. iOS specifics: background sync/push realities, widget timeline refresh (WidgetKit) implications for the API, keychain/passphrase UX, App Store rules relevant to a paid sync sub (IAP vs Stripe — the reader plan / external purchase rules).
4. What in the plan is over- or under-built for a solo developer? Name the 3 biggest risks and the simplest mitigation for each.
5. Anything about the E2E design that's wrong or naive (key rotation, multi-device passphrase entry, metadata leakage, versioning ciphertext).

Be direct, structured, and concrete. Do NOT rewrite the whole plan — critique and patch it. You may NOT modify any files; output your review as text only.

---

# Amendments (2026-07-06, final combined review)

- **`widgets/manifest` is dropped for v1.** Widget order syncs inside each `space/default/widget/<id>/config` envelope (order-in-row, matching the shipped widget-rail data model). Concurrent reorders on two devices may interleave; the client's clean-index rewrite heals them. A manifest key can be introduced later if layout grows beyond a flat order.
- **KDF v1 is PBKDF2-SHA256 via WebCrypto** (params + salt stored in the key-bundle metadata); Argon2id is a documented future upgrade, not a v1 dependency.
- **Tombstones are kept forever** — no device-ack protocol; rows are tiny.
- **Added to the frozen API surface:** `/devices` (list + revoke), and a client-side `sync_state` table holding per-key base revisions (`lastServerSeq`, `lastStamp`) for offline merge.
- **MV3/network disclosure:** enabling sync introduces the extension's first network traffic (still zero manifest permissions; CORS handled server-side). Store listing, privacy policy, and in-app copy change from "zero network requests" to "zero network requests unless you enable sync" in the same release.

# Codex review (accepted)

**Verdict**

The dumb mailbox is the right server shape, but the current plan is underspecified where data loss happens. Keep the server ignorant, but make the sync item model, tombstones, pagination, client merge contract, and iOS billing constraints explicit before writing the backend.

**Where It Breaks**

- Blind LWW by wall-clock `stamp` will lose offline edits. Use a deterministic hybrid logical clock stamp: `{physical_ms, logical, device_id}`. Each client should pull before flushing an offline queue, merge locally against its pending base version, then push.
- Deletes need first-class tombstones. A missing row is not a delete. Store tombstone rows forever, or until every active device has acknowledged a later `server_seq`; otherwise old devices can resurrect deleted notes.
- `/pull?since=` needs pagination from day one: `?since=<seq>&limit=<n>`, stable ordering by `server_seq`, and `has_more`. A fresh iPhone should not need one giant response.
- Normal pulls should return current changes, not the last 10 versions. Keep history in a separate table or mode; otherwise polling becomes wasteful and confusing.
- Multi-key transactions are not solved by a dumb server. For anything that must be atomic, make it one encrypted aggregate key, or use a manifest commit pattern: write child entities first, update the manifest last, and have clients treat the manifest as authoritative.
- Key enumeration is a product decision. Plain keys like `2026-07-06/main` are simple but leak exact activity. If that is not acceptable, store `key_id = HMAC(index_key, canonical_key)` plus a coarse plaintext bucket.

**Concrete Data Model**

Server plaintext columns:

```text
account_id
bucket              # coarse: global, days/2026-07, widgets, boards
key_id              # HMAC-SHA256(index_key, canonical_key), not raw key
stamp               # HLC tuple encoded for deterministic comparison
deleted             # plaintext tombstone flag
server_seq
device_id
schema_major
crypto_key_id
ciphertext
nonce
created_at
updated_at
```

Ciphertext envelope:

```json
{
  "v": 1,
  "key": "space/default/day/2026-07-06/main",
  "kind": "dayField",
  "entityId": "2026-07-06",
  "field": "main",
  "format": "text/markdown",
  "stamp": {"physicalMs": 1783370000000, "logical": 4, "deviceId": "dev_abc"},
  "base": {"serverSeq": 123, "stamp": "hlc..."},
  "deleted": false,
  "body": "...",
  "attrs": {}
}
```

Suggested canonical keys:

```text
space/default/day/2026-07-06/main
space/default/day/2026-07-06/margin
space/default/panel/scratchpad/body
space/default/settings/account
space/default/settings/editor
space/default/widgets/manifest
space/default/widget/<widgetId>/config
space/default/widget/<widgetId>/state
space/default/boards/manifest
space/default/board/<boardId>/doc
space/default/board/<boardId>/view/<viewId>
```

Do not sync every current setting blindly. Split portable settings from device-local settings. Theme, accent, scratchpad enabled, margin enabled, and widget layout can sync. Font size, editor density, folder handles, notification permissions, and mobile widget presentation should be device-local unless the user explicitly opts in.

For widgets, keep configuration and data separate. `widgets/manifest` owns order/layout. `widget/<id>/config` owns type and settings. `widget/<id>/state` owns user data such as tracker checkmarks. If a widget state grows, shard it by period later: `widget/<id>/state/2026-07`.

For attachments later, do not put blobs in D1. Add encrypted R2 objects referenced from an encrypted envelope: `{blobRef, size, mime, sha256}`. The server can stay dumb.

**API Patches**

- `POST /push` accepts a batch and returns per-item `{accepted, rejected, currentStamp, currentServerSeq}`.
- `GET /pull?since=&limit=&bucket=` returns ordered current rows, including tombstones.
- `GET /history?key_id=&before=&limit=` is optional and separate from sync.
- `GET /head` returns latest `server_seq` cheaply for focus/background checks.
- Device tokens should be hashed server-side, revocable, scoped, and rotated.

**iOS Reality**

A 30-second polling model does not exist on iOS. Sync on foreground, app focus, app resume, explicit user action, and opportunistic `BGAppRefreshTask`. Silent APNs can help notify “new seq available,” but it is not guaranteed delivery or timing.

WidgetKit cannot be treated as a live sync client. The app should decrypt synced data and write a small widget snapshot into an App Group container. The widget extension reads that snapshot and renders a timeline. After foreground sync, call `WidgetCenter.reloadTimelines`. Expect stale widgets; design copy and product behavior around that.

Store the device auth token and unwrapped workspace key in Keychain after passphrase entry. Prefer not to give the widget extension the raw sync key; give it decrypted snapshots. On a restored or new phone, require the sync passphrase again.

Billing is the largest iOS product trap. Current Apple guidance says unlocking app functionality with a digital subscription must use IAP, and multiplatform services may expose purchases made elsewhere only if those features are also available as IAP in the app. Tab Pad sync is not a reader app. Simplest compliant plan: Stripe for web/Android, StoreKit subscription for iOS, same backend entitlement. A free iOS companion with no purchase CTA may be possible, but it is review-risky for consumer paid sync.

**E2E Issues**

Do not derive the data encryption key directly from the passphrase forever. Generate random `data_key` and `index_key`; wrap them with a passphrase-derived key bundle. Passphrase changes then rewrap the bundle instead of reencrypting every note.

Use Argon2id where practical, but have a WebCrypto-compatible fallback story. Store KDF parameters and salt in the encrypted account key bundle metadata.

Include `crypto_version`, `crypto_key_id`, `nonce`, and AES-GCM AAD covering `account_id`, `key_id`, `stamp`, `deleted`, and `schema_major`. Never reuse nonces.

Key rotation needs a real answer. New writes can use a new `crypto_key_id`, but old history remains under old keys unless reencrypted or expired. That is fine if documented.

Even with encrypted bodies, metadata leaks remain: account, device count, timestamps, item counts, ciphertext sizes, coarse buckets, and possibly exact dates if raw keys are stored. The plan should name that plainly.

**Top 3 Risks**

1. Data loss from offline LWW and deletes.  
Mitigation: HLC stamps, pull-before-push, base revision tracking, permanent tombstones, and a visible conflict/version recovery surface.

2. iOS expectations exceeding platform reality.  
Mitigation: foreground-first sync, APNs only as a hint, WidgetKit snapshots, StoreKit entitlement from the start.

3. Scope creep from notes into boards/widgets/attachments.  
Mitigation: ship one generic encrypted item API with buckets, manifests, tombstones, pagination, and history; keep boards as aggregate documents until scale forces finer sharding.

The plan is not overbuilt on server tech; Worker + D1 is fine. It is underbuilt on sync semantics. The server can stay dumb, but the protocol cannot be vague.
