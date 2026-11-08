# Changelog

## 0.2.0

TypeScript rewrite. This release changes the delivery model; read the README
before upgrading.

### Changed

- Annotations are inserted **directly into the composer draft** through the
  public `inputActions.insertText` API. The Markdown report middleware
  (`/dsh-annotate/save`, `/dsh-annotate/pending`, `agent/pre-step` message
  rewriting, `$DSH_HOME/annotations` files, screenshots on disk) is gone.
- The bundle is now written in TypeScript and built with esbuild:
  `src/shared` (pure data/formatting), `src/client` (runtime, controller, UI)
  and a no-op Host entry.
- The Host half is empty: no HTTP routes, no disk writes, no session-log
  rewriting.
- Reports are no longer generated; a finished batch becomes one compact text
  block (page + selector/label + your note) in the composer.

### Added

- Per-annotation image attachments: pick PNG/JPEG/WebP/GIF files (up to 4 per
  note, 8 MiB each) or paste images into the bubble. They are staged through
  the DSH Conversation attachment service and sent as ordinary message images.
- A live dock row above the composer with the current annotation count,
  "insert into composer" and "cancel" actions.
- Offline tests for the runtime, the toggle lifecycle, text formatting and
  image conversion (`npm test`).

### Fixed

- Re-entering annotation mode after exiting it no longer leaves element
  selection dead: every open re-injects and restarts the page runtime, verified
  by a regression test.
- Toggle transitions are serialised, so a fast double click cannot race a
  half-finished open/close.
- A busy composer no longer loses the batch: insertion failure keeps the page
  annotations alive for retry.

### Removed

- `capturePage` screenshots and `prepareCapture` runtime API.
- `localStorage` pending-batch persistence and the composer chip count.
