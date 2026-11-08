# 0.2 refactor — direct-composer annotation plugin

This document is the implementation contract for the TypeScript rewrite. It is
the shared source of truth for everyone working in this repository.

## Product decisions

1. **No Markdown/report middleware.** Delete `$DSH_HOME/annotations`, report
   files, screenshots-on-disk, `/dsh-annotate/*` Host routes, `agent/pre-step`
   message rewriting and the pending-batch host state. The plugin is a
   client-only bundle with a no-op Host entry.
2. **Notes go straight into the composer, but only on an explicit submit.**
   Annotations persist as numbered page markers across pause/resume (ChatGPT
   style); the explicit "写入输入框" action (in-page bottom bar or the dock row)
   inserts one compact text block into the composer draft through the public
   `inputActions.insertText` API, then clears the page batch. Exiting annotation
   mode is a pause, not a submit.
3. **Images are real composer attachments.** The inline annotation bubble can
   attach images (file picker or paste). On finish those images are registered
   as browser-owned draft attachments through the Conversation service
   (`createDrafts`) and attached with `inputActions.addAttachments`, so the
   model receives them as ordinary message images. No automatic screenshots:
   they were the biggest silent token/disk cost.
4. **Rewrite in TypeScript.** `src/shared` (pure data + text formatting),
   `src/client` (module-loader bundle, page runtime, controller, React UI),
   `src/host` (empty). esbuild builds `client/client.js`; `index.js` stays a
   hand-written no-op Host entry.
5. **Toggle lifecycle bug.** Opening, closing and reopening annotation mode must
   always end with a live runtime overlay. The controller serialises toggles
   with a busy guard, always re-arms the runtime on open (verified by
   `status().active`), and every exit path clears `sending`/`open` state.

## Package layout

```
index.js                     no-op Host entry (inject = [])
cordis.patch.yml             bundle insert entry
src/shared/types.ts          plain-data contract (no DOM)
src/shared/text.ts           batch -> composer text (pure, unit-tested)
src/shared/image.ts          data URL -> File helpers (unit-tested)
src/client/index.tsx         __ModuleLoader__ factory, slot/locale/CSS wiring
src/client/runtime.ts        function injected into the page; toString() source
src/client/controller.ts     per-session state machine (toggle/finish/poll)
src/client/target.ts         right-sidebar DOM discovery + webview handle
src/client/attachments.ts    conversation-service bridge for images
src/client/ui.tsx            chrome toggle button + transient composer chip
tests/runtime.test.ts        runtime harness with hand-rolled DOM stub
tests/text.test.ts           formatting tests
tests/controller.test.ts     toggle open/exit/reopen regression tests
```

## Runtime contract (`src/client/runtime.ts`)

`runtimeMain()` is a self-contained function (`window`/`document` only, no
module imports) whose `toString()` is passed to `webview.executeJavaScript`.
It installs `window.__DSH_WEB_ANNOTATE__` and must return an API object:

```ts
interface RuntimeApi {
  version: number                       // exported as RUNTIME_VERSION, bumped on contract change
  start(options: { hud: RuntimeHudTexts }): { ok: true }   // arm capture, keep records
  stop(): { ok: true }                  // PAUSE: capture off, records/markers stay visible
  status(): RuntimeStatus               // includes action: 'commit' | null
  pull(): RuntimeStatus                 // alias of status()
  collect(): CollectedBatch             // records without image bytes
  collectImages(): CollectedImages
  takeAction(): 'commit' | null         // consume the in-page bottom-bar command once
  openEditor(recordId): { ok: boolean }
  closeEditor(mode?: 'commit' | 'cancel'): { ok: boolean }
  remove(recordId: string): { ok: boolean }
  clear(): { ok: boolean }              // drop records + hide the marker layer
  setVisible(visible: boolean): { ok: boolean }
  dispose(): void
}
```

Runtime requirements:

- `stop()` pauses: the capture layer and bottom bar hide, the open editor
  commits, **records stay rendered** (translucent boxes + numbered pins) and
  pins remain clickable for editing. Only an empty record list hides the layer.
- `start()` re-arms capture and shows the in-page bottom bar without touching
  records.
- In-page bottom bar (fixed, bottom center, dark pill, only while active):
  localized title with `{count}`, buttons 清空 / 写入输入框 / ×. The write button
  queues `action = 'commit'`; `takeAction()` returns and clears it, and the bar
  must become usable again if the plugin's write fails. Bar interactions are
  never treated as annotation gestures.
- Clicking a pin works while paused and opens that annotation's inline editor;
  outside click commits, Escape cancels regardless of active state. Escape with
  no editor pauses the mode.
- `start()` is idempotent and restart-safe; `dispose()` removes every listener
  and re-injection restores a clean runtime.
- Inline editor footer: add-image button (hidden file input), confirm, delete;
  paste attaches images. Up to 4 images per annotation, each ≤ 8 MiB, only
  png/jpeg/webp/gif, localized errors, thumbnails with remove controls.
- Images live on the record; `collect()`/`status()` expose metadata only,
  `collectImages()` returns full data URLs.
- Keep the existing gestures: click element, click blank space (point), drag
  region, pin click edits, empty annotation (no comment and no images) is
  discarded.

## Controller rules

- `toggle()`: armed -> pause; paused -> arm. It never writes.
- `open()`: resolve the visible webview; `ensureRuntime` **reuses** a live
  compatible runtime so the batch/markers persist; otherwise inject then
  `start`. The runtime status is the source of truth for records.
- `pause()`: `stop()` only; keep records, keep polling so pin edits and page
  loss stay in sync.
- `write()` (explicit): close the page editor, `collect` + `collectImages`,
  build text, insert into the composer, attach images, then `clear` + `stop`
  and reset the dock state. A busy composer keeps the page batch for retry.
- The poll (250 ms) consumes a queued `'commit'` action once, mirrors the
  `active` flag (page-side Esc / bar exit pauses), and clears a stale batch
  when the guest was recreated/navigated.
- `discard()` clears the page markers without inserting anything.
- Toggle/write/pause transitions are serialised; no Host calls, no persistence.

## Verification

`npm run check` = typecheck + build + node tests. Controller tests fake the
webview (`executeJavaScript`), inputActions and attachment bridge to assert the
open → finish → reopen cycle arms the runtime every time.
