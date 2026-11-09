# Changelog

## 0.2.4

### Fixed

- The cursor arrow inside the annotate glyph is now geometrically centred in the
  corner-bracket frame (its bounding box centre sits exactly on the 8,8 grid
  centre) and scaled up so it stays legible at 15px, instead of sitting in the
  bottom-right quadrant.
- Cursor stroke widened slightly (1.15) to keep its optical weight balanced with
  the filled corner brackets.

## 0.2.3

Sidebar icon aligned with DSH's own toolbar artwork.

### Changed

- The annotate glyph now reuses DSH's exact 16x16 corner-bracket artwork (filled,
  1 unit thick, 1.33 unit margins) and renders inside a 15px box, matching the
  size, optical weight and colour of the neighbouring right-sidebar icons; the
  cursor arrow is the only ChatGPT addition.
- The icon container is a block-level 15x15 grid inside a 28px inline-flex
  button, so the glyph is vertically/horizontally centered next to its 批注
  label instead of looking small and high.
- Active/has-batch tint now derives from `--dsw-alias-brand-primary`, so it
  follows the host theme (light/dark) instead of a hard-coded light blue.

## 0.2.2

ChatGPT-aligned annotation visuals and a clearer image intake.

### Changed

- Sidebar toggle now uses ChatGPT's annotate glyph (selection corners + cursor)
  and renders as a compact pill with the "批注" label; it tints ChatGPT blue when
  annotating or while a paused batch exists, and shows the marker count badge.
- Annotation markers restyled after ChatGPT: 2px `#0A5CF5` frame, 8px radius,
  very light blue tint, and `#3493F9` chat-tail number badges with hover lift.
- In-page bottom bar restyled as a ChatGPT-like dark pill (blue primary write
  button); hover feedback for its buttons.
- Inline annotation card restyled: 16px radius, softer elevation, roomier
  textarea, 52px image thumbnails with white-ring remove controls, and a
  ChatGPT-style footer with a labeled image button + blue "完成" button.
- Image intake is now explicit and discoverable inside the annotation bubble:
  labeled image picker, plus paste and drag-and-drop of images; all existing
  limits (4 per note, 8 MiB, png/jpeg/webp/gif) unchanged.
- Runtime version 7 (forces live pages to re-inject the restyled runtime).

## 0.2.1

ChatGPT-style persistent annotation markers.

### Changed

- Exiting annotation mode is now a **pause**, not a submit: numbered markers and
  translucent highlights stay visible on the page, pins stay clickable for
  editing, and the dock row above the composer keeps showing the live count.
- The batch is only converted to composer text when the user explicitly clicks
  "写入输入框" (in-page bottom bar or the dock row); it is then cleared from the
  page. A busy composer keeps the batch and markers alive for retry.
- New in-page bottom action bar while annotation mode is active
  (`正在批注 · N 条` / clear / write / `×` exit), following the ChatGPT
  annotation interaction.
- The sidebar toggle now shows the live marker count even while paused and its
  tooltip offers "继续批注（N 条标记）".
- Runtime version 6: `stop()` pauses and keeps records; pins editable while
  paused; `takeAction()` consumes the bottom bar's one-shot `commit` command.

### Fixed

- Exiting annotation mode no longer makes the whole annotation state invisible:
  previously the page was cleared on exit, so the user could not see or continue
  what they had annotated.
- Toggle-off immediately after creating a fresh annotation no longer loses that
  record from the dock (records are synced on pause).

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
