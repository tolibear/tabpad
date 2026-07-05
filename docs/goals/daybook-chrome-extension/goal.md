# Daybook Chrome Extension

## Objective

Build the Daybook Chrome extension from the supplied build pack and complete successive verified implementation packages until the local extension satisfies the v1 acceptance criteria.

## Request

Use GoalBuddy goal prep for `/Users/tonym/Downloads/daybook-build-pack-v1.md`.

## Intake

- Input shape: `existing_plan`
- Audience: Toli
- Authority: `requested`
- Proof type: `demo`
- Completion proof: all A1-A20 acceptance criteria pass against a local unpacked Chrome extension with no requested permissions and no network requests.
- Likely misfire: shipping a generic note app scaffold or editor demo while missing the new-tab extension behavior, zero-permissions constraint, timeline model, right-panel modes, mirror behavior, performance targets, or A1-A20 proof.
- Existing plan facts:
  - Source plan: `/Users/tonym/Downloads/daybook-build-pack-v1.md`
  - Daybook replaces the Chrome new tab page with a daily markdown notepad.
  - The center timeline is the product: today opens at the top with focus, future placeholders scroll upward, and past empty days are omitted unless jumped to.
  - The left rail stays visually quiet and provides calendar dots, noted-day jumps, today, and settings.
  - The right side supports scratchpad, master list, per-day margin, and hidden modes without destroying content during mode switches.
  - The editor is source-mode CodeMirror 6 with Obsidian-style live preview, real checkboxes, list continuation, and static-render parity.
  - Storage is local-first with Dexie, BroadcastChannel sync, JSON import/export, and an optional off-by-default one-way folder mirror.
  - Manifest V3 has only `chrome_url_overrides.newtab`, no background worker, no content scripts, no extension permissions, no telemetry, and no network requests.
  - The stack is Vite, React 18+, TypeScript strict, Tailwind v4, CodeMirror 6, Dexie, and markdown-it.
  - Milestones M1-M7 and acceptance criteria A1-A20 define the v1 finish line.
  - The v1.1 backlog is out of scope for v1.

## Oracle

`A local Daybook Chrome extension build passes its tests and checks, loads unpacked as the Chrome new tab page with zero permissions and zero network requests, and a final Judge or PM audit maps the verified behavior to acceptance criteria A1-A20 from /Users/tonym/Downloads/daybook-build-pack-v1.md with full_outcome_complete: true.`

Planning, discovery, a scaffold, or one green milestone is not enough. The goal finishes only when a final audit maps receipts and verification back to the oracle.

## Kind

`existing_plan`

## Tranche

Validate the supplied build pack against the current repo, choose the largest safe useful first implementation package, complete it with verification, then continue package by package through the v1 acceptance criteria until the full owner outcome is complete.

## Boundaries

- Preserve `/Users/tonym/Downloads/daybook-build-pack-v1.md` as source truth unless live repo evidence proves a correction is needed.
- Do not add accounts, cloud sync, telemetry, network calls, background workers, content scripts, or extension permissions.
- Keep the folder mirror optional, off by default, one-way from app to files, and non-destructive.
- Keep v1.1 backlog items out of v1 unless the user explicitly changes scope.
- Verify in Chrome as an unpacked new-tab extension; dev-server behavior alone is not enough.
- Favor coherent milestone packages over tiny helper-only tasks.
- Do not finish while required Worker work remains queued or active.

## Board

Machine truth lives at:

`docs/goals/daybook-chrome-extension/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Command

```text
/goal Follow docs/goals/daybook-chrome-extension/goal.md.
```

## PM Rules

Read this charter and `state.yaml`, then work only on the active task. Scout and Judge tasks are read-only. Worker tasks may write only inside their `allowed_files`. Every completed, blocked, or escalated task needs a compact receipt in `state.yaml`.

After each verified Worker package, continue to the next largest safe useful package unless a phase boundary, ambiguity, rejected verification, or final audit is due. Finish only with a Judge or PM audit receipt that maps the current receipts and verification back to the oracle and records `full_outcome_complete: true`.
