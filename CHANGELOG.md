# Changelog

## 0.1.0 — 2026-10-21

First public release.

- Annotate any HTTP(S) page opened in the DSH right-Sidebar Browser tab: click an
  element, click a blank position, or drag a region.
- Inline comment bubble with Enter / Shift+Enter / Esc, numbered pins, edit and
  delete, screenshot capture per annotation.
- Save every batch under `$DSH_HOME/annotations/<sessionId>/<timestamp>/` as
  `report.md`, `annotations.json` and numbered `NN.png` files.
- Merge annotations from several pages/batches into one consolidated report
  grouped by page, with all report paths listed at the end.
- Attach the merged report to the user's next sent message through the Host
  `agent/pre-step` hook, so the annotation becomes part of the durable, visible
  user message (no session-log rewriting by the plugin).
- Sending while annotation mode is still open: the open batch is persisted in
  the background, included in the message, and the annotation session is closed
  automatically after the message is consumed, so the same batch is never
  attached twice.
- Full-page transparent capture layer: page hover popups and link/focus
  interactions are suppressed while annotating; cross-origin iframes can be
  annotated as a whole element/region.
- Supports the DSH plugin manager bundle format (`dsh.bundle.patch` +
  `dsh.client`), no build step and no runtime dependencies.
