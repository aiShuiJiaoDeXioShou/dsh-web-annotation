# 0.2 refactor — direct-composer annotation plugin

This document is the implementation contract for the TypeScript rewrite. It is
the shared source of truth for everyone working in this repository.

## Product decisions

1. **No Markdown/report middleware.** Delete `$DSH_HOME/annotations`, report
   files, screenshots-on-disk, `/dsh-annotate/*` Host routes, `agent/pre-step`
   message rewriting and the pending-batch host state. The plugin is a
   client-only bundle with a no-op Host entry.
2. **Notes go straight into the composer.** Finishing annotation mode inserts
   one compact text block into the current session's composer draft through the
   public `inputActions.insertText` API. The user reviews/edits/sends it like
   their own text. Multiple batches accumulate in the same draft.
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
  version: number
  start(options: { hud: RuntimeHudTexts }): { ok: true }
  stop(): { ok: true }
  status(): RuntimeStatus      // alive/active/editorOpen/revision/count/records/url/title/viewport/scroll
  pull(): RuntimeStatus        // alias of status()
  collect(): CollectedBatch    // records without image bytes
  collectImages(): CollectedImages
  openEditor(recordId: string): { ok: boolean }
  closeEditor(mode?: 'commit' | 'cancel'): { ok: boolean }
  remove(recordId: string): { ok: boolean }
  clear(): { ok: boolean }
  setVisible(visible: boolean): { ok: boolean }
  dispose(): void
}
```

Runtime requirements:

- `start()` is idempotent and always (re)arms gesture handling: overlay layer,
  capture layer, pointer listeners, hover box. It must work after any number of
  `stop()`/`start()` cycles and after `dispose()` re-injection.
- `stop()` deactivates gestures and hides the overlay but keeps records so the
  controller can `collect()` first.
- `clear()` removes all records, the inline editor and their image state.
- Inline editor footer has: add-image button (opens a hidden file input),
  confirm (✓) and delete (trash). Pasting an image into the textarea attaches
  it too. Up to 4 images per annotation, each ≤ 8 MiB, only
  png/jpeg/webp/gif. Thumbnails render inside the bubble with a remove control.
- Images live on the record (`record.images` full data URL + metadata); the
  lightweight `collect()`/`status()` only expose metadata.
- Locale strings for the new image controls come from `RuntimeHudTexts`.
- Keep the existing gestures: click element, click blank space (point), drag
  region, pin click to re-edit, Escape to exit, outside click commits, empty
  annotation (no comment and no images) is discarded. An explicit "cancel" on a
  draft that already carries images keeps it as an image-only record instead of
  throwing the bytes away; in-flight FileReader reads also count as images so
  pressing Enter right after picking a file does not lose it.

## Controller rules

- `open(sessionId)`: resolve the visible webview; ensure/inject runtime; call
  `start`; verify `status().active === true`; publish open state. On failure set
  a localised hint and leave state closed.
- `finish(sessionId)`: guard re-entry (`finishing`), close the page editor,
  `collect` + `collectImages`, build text, insert into composer, attach images,
  then `clear` + `stop`; always reset open/finishing state in `finally`.
- `toggle(sessionId)` chooses open/finish and ignores clicks while busy, so a
  rapid second click cannot race a half-finished transition.
- Polls (`250 ms`) only while open; they sync projection state to the UI and
  detect the page being gone. No Host network calls.
- No `localStorage` persistence; a closed batch lives in the composer draft.

## Verification

`npm run check` = typecheck + build + node tests. Controller tests fake the
webview (`executeJavaScript`), inputActions and attachment bridge to assert the
open → finish → reopen cycle arms the runtime every time.
