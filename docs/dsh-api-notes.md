# DSH 0.2.2-rc.1 client plugin / composer / attachment API notes

Evidence base: the extracted Desktop runtime at
`/tmp/dsh-app/dsh/node_modules/@deepseek-ai/` (all packages `0.2.2-rc.1`,
`@deepseek-ai/dsh-desktop-runtime` version confirmed in
`/tmp/dsh-app/dsh/package.json`). Paths below are relative to that
`node_modules/@deepseek-ai/` directory. Bundled `lib/client.js` files retain
JSDoc; no `.d.ts` files ship in this extraction.

## 1. Client bundle contract

- A browser bundle is a lazy factory registered into the shell's
  `window.__ModuleLoader__` table:
  `window.__ModuleLoader__.load({ id: '<package name>', factory(require) { ... return { inject, apply } } })`
  (`dsh-client-modules/lib/client.js:1`; template
  `dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js:1`).
  The factory runs once at materialization; the returned object is a Cordis
  plugin whose `apply(ctx)` receives the plugin context. `id` must equal the
  package name.
- `require()` resolves only against the shell's frozen platform seed table.
  In 0.2.2 that table is exactly:
  `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`,
  `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`,
  `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
  `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`
  (`dsh-web-frontend/dist/assets/index-BgUyXZcc.js:196`, function `YZ()`).
  Anything else must be declared in `dsh.client.external`; an unresolved
  `require` throws "missed the module table"
  (`dsh-client-modules/lib/client.js:842`).
- `apply(ctx)` is a plain Cordis plugin body. Available context surface:
  `ctx.slots`, `ctx.locale`, `ctx.effect(label)` (disposer registered on the
  plugin fiber), `ctx.get(name)` (read a provided service,
  `@deepseek-ai/cordis/src/reflect.ts:247`) and `ctx.inject(deps, callback)`
  (fork a child plugin that starts only when `deps` exist; it is unloaded and
  re-run when a dependency service changes — `@deepseek-ai/cordis/src/registry.ts:176,300`).
  The declarative object form `inject: ['slots', 'locale', ...]` returned from
  the factory is equivalent and is what shipped plugins use
  (`dsh-client-ui-goal/lib/client.js:648`; `dsh-client-ui-conversation/lib/client.js:19930`).
- Slot registration shape (list slots add `id`/`order`):
  `ctx.slots.inject('<slot>', () => ctx.slots.register({ name, id, order, locale, inject }, Component))`
  (`dsh-client-ui-conversation/lib/client.js:19937,22356`; template same call).
  `inject` may be a function `(sessionId) => props | { hooks, props }` that
  supplies slot-specific hooks/values. Session-scoped slot components also
  receive the standard props `sessionId`, `inputActions` and hooks such as
  `useSession`/`useInput`/`useConversation`/`renderSlot`
  (`dsh-client-ui-conversation/lib/client.js:22775`; real components at
  `dsh-client-ui-goal/lib/client.js:369`, `dsh-client-ui-sidebar-right/lib/client.js:709`).
- `conversation.input.dock` is a root-declared `list` slot with `scope: session`
  (`dsh-client-ui-conversation/lib/client.js:22816-22819`), rendered above the
  composer as `renderSlot("conversation.input.dock", { session, input })`
  (`:20516-20520,20579`). Both the plugin's own `TodoDock`/`QueueDock`
  (`:22356,19937`) and third-party docks register into it; ordering is
  ascending `order`.
- `shell.overlay` is a root-scoped `list` slot in the layout frame, rendered
  with no owner props (`dsh-client-ui-layout/lib/client.js:346,725-728`) and
  placed in `[data-shell-overlay]` covering the whole frame (`:403`).

## 2. The `conversation` service in 0.2.2

- `conversation` is a Cordis `Service` provided by `ConversationController`:
  `class ConversationController extends Service`, constructor calls
  `super(ctx, "conversation")` — service name is literally `conversation`
  (`dsh-client-ui-conversation/lib/client.js:4697,4718`). It is installed once
  by the conversation plugin's root `apply` via
  `ctx.plugin(ConversationController, ...)` (`:23118`), so it is available to
  any client plugin context that injects it.
- Correct access: declare `conversation` in your plugin `inject` list (or use
  `ctx.inject(['conversation'], cb)`); then `ctx.conversation` / `ctx.get('conversation')`
  returns the service. `ctx.get` alone returns `undefined` until the service is
  provided, so it is not a load-ordering guarantee. Shipped examples inject it:
  `inject: ["slots","conversation","sessions","uiConversation"]`
  (`dsh-client-ui-conversation/lib/client.js:19930-19942`) and
  `ctx.get("conversation")` at `:22540`.
- Session scoping: methods like `send`/`cancel` resolve the caller's session
  scope and throw on a root context (`scopedSession`/`scopeId`,
  `dsh-client-ui-conversation/lib/client.js:5090-5100`). Attachment methods used
  here (`createDrafts`, `releaseDraftAttachment(s)`) take an explicit
  `sessionId` and do **not** need a session-scoped context, so root
  `ctx.get('conversation')` is sufficient.
- `createDrafts(sessionId, files, uploadImages)` — exact 3-arg signature
  (`dsh-client-ui-conversation/lib/client.js:4852`); returns one descriptor per
  file, in input order:
  - accepted image MIME (`image/png`, `image/jpeg`, `image/webp`, `image/gif`;
    `isImageMediaType` at `:5140`, whitelist at `:5126-5135`) → an image draft
    `{ kind: 'image', id, file, previewUrl, width?, height? }`, preview object
    URL, optional upload started only when `uploadImages` is truthy (`:4854-4860`);
  - any other file → `{ kind: 'file', id, file }` and a background upload starts
    immediately (`:4862-4868`).
  Drafts are runtime-only (in-memory map `draftAttachments`) and survive
  Session navigation until sent or explicitly released (`:4840-4852`).
  An image draft created with `uploadImages: false` still sends its bytes inline
  with the prompt. The 3rd argument is new: the older 0.1.7-rc.2 runtime in
  `~/.npm/_npx/.../dsh-client-ui-conversation/lib/client.js:3477` had only
  `createDrafts(sessionId, files)`.
- `inputActions.addAttachments(ids)` appends ids to the draft's ordered
  `attachmentIds` and publishes state; it only fails when the phase is frozen
  (`adjudicating`/`submitting`/`sending`) and returns `true` for an empty list
  (`dsh-client-ui-conversation/lib/client.js:15552-15560`, `frozen` at `:15328`).
  It does **not** validate that ids resolve, and it does **not** insert file
  reference chips — so image ids returned by `createDrafts` can be attached
  directly; the private `addFiles(references, ids)` (`:15568`) is only needed
  when a file chip must also be inserted into the text.
- Composer rail rendering resolves the ids back through the same service:
  `InputBar` computes attachments with `resolveDraftAttachments(input.attachmentIds)`
  (`:21780`) and the wire supplies `resolveDraftAttachments: (ids) => conversation.resolveDraftAttachments(ids)`
  (`:23070`). So an added image descriptor renders with its preview/upload state.
- Cleanup: `releaseDraftAttachment(id)` deletes the registry entry, revokes a
  `blob:` preview URL and aborts/drops its upload (`:5031-5050`);
  `releaseDraftAttachments(attachments)` iterates descriptors (`:5055-5057`).
  The Conversation service also auto-releases on send settlement and on plugin
  disposal (`:4818,4836,5108`). The plugin must release any draft it created but
  never attached (e.g. failed insertion) or the File/`blob:` leak survives
  Session navigation. The service exposes no "image size limit" of its own here;
  size/format rejection happens in the upload path (`beginFileUpload` maps
  `session/attachment-invalid` to an error state, `:4930-4960`) — exact byte
  limits are enforced by `@deepseek-ai/dsh-client-file-upload` and were not
  verified line-by-line.

## 3. Composer insertion semantics

- `inputActions` is a stable per-session object provided through
  `ctx.uiSession.provide()` (`dsh-client-ui-conversation/lib/client.js:22775-22790`).
  Public members: `insertQuote`, `captureInsertion`, `insertText`, `setDraft`,
  `persistDraft`, `addAttachments`, `removeAttachment`, `pruneAttachments`,
  `submit` (`:15367-15390`).
- `captureInsertion()` returns `{ start, end, draftRev }`, the live selection
  as a half-open `[start,end)` span in **detect coordinates** (`caretSpan`,
  `:15090-15098`), plus the current draft revision. A collapsed caret yields
  `start === end`; no selection yields a collapsed span at the end of the
  detect text.
- `insertText(text, span)` is one atomic replacement of `[start,end)`:
  it returns `false` when (a) the input is `disposed`, (b) the phase is frozen
  (`adjudicating`/`submitting`/`sending`), (c) `span.draftRev !== current rev`,
  or (d) the range no longer maps (`insertAsyncText` → `$replaceDetectSpanWithText`,
  `:15370-15378,15119-15130`). Because of (c) each attempt must call
  `captureInsertion()` immediately before `insertText`; retrying with a stale
  span always fails. Composer busy is therefore a soft failure — the caller must
  keep the batch and offer retry rather than assuming insertion.
- Text is placeholder-sanitized (`REFERENCE_PLACEHOLDER_RE` removed) and applied
  as an **independent undo operation** (paste history tag), so one Ctrl+Z
  removes the inserted annotation block (`:15119-15127`; tags at `:15100-15105,
  15055-15065`). `setDraft(text)` replaces the whole draft, merges into history
  (not its own undo step) and leaves the caret at the end — prefer
  `insertText` for annotation batches so existing draft text is preserved.
- Detection coordinates, not plain text offsets, are used because reference
  chips contribute placeholder text; use the returned span verbatim, never
  compute offsets yourself (`projection.detectText`, `:14682,14776`).

## 4. Right-sidebar Browser DOM and lifecycle (0.2.2)

- Session panel root carries `data-sidebar-right-session="<sessionId>"`,
  `data-sidebar-right-panel="push|fullscreen"`, and
  `data-sidebar-right-open` (attribute present only while expanded) /
  `data-sidebar-right-opening` (`dsh-client-ui-sidebar-right/lib/client.js:1743-1746`).
  `.closest('[data-sidebar-right-session]')` is the supported way to find a
  session's panel; open check: `panel.hasAttribute('data-sidebar-right-open')`
  (`:96,725`).
- Dockkit markers still exist in 0.2.2 and are rendered by the bundled
  dockkit in the frontend: `[data-dockkit-strip]`, `[data-dockkit-strip-chrome]`,
  `[data-dockkit-split-control]`, `[data-dockkit-split-button]`,
  `[data-dockkit-tab]`, `[data-dockkit-pane]`/`[data-dockkit-float]`,
  `[data-dockkit-strip-fill]`, `[data-dockkit-add-tab]`
  (`dsh-web-frontend/dist/assets/index-BgUyXZcc.js:196`, the `ow()` tab-strip
  renderer; sidebar-right only consumes them, e.g. `:1451` CSS).
  The Browser tab id/body is `[data-sidebar-right-tab]` +
  `[data-sidebar-right-occurrence]` (`dsh-client-ui-sidebar-right/lib/client.js:1603-1609`).
- Browser carrier: Desktop creates a real Electron `<webview>` with
  `element.dataset.sidebarBrowserFrame = "webview"`, `name=<lease>`,
  `partition=<partition>`, `src="about:blank#<lease>"`
  (`dsh-client-ui-sidebar-browser/lib/client.js:1335-1341`); Web creates an
  `<iframe>` with `data-sidebar-browser-frame="iframe"` (`:973`). Annotation
  via `webview.executeJavaScript` / `capturePage` only applies to the Desktop
  webview; the Web iframe is cross-origin and cannot be scripted.
- Guest lifecycle is important for re-injection: the webview is created when a
  body is first mounted or when a lost guest is recreated; `attach()` says a
  physical mount may recreate a lost guest while "ordinary Sidebar hiding never
  calls this" (`:1046-1060`). `detach()`/`dropGuest()` remove the guest and
  release its lease (`:1069-1080,1289-1300`); a navigation keeps the same
  element. Tab changes, Session switches, collapse and floating retain the DOM
  because the Browser tab type sets `keepMounted: desktop !== void 0`
  (`:1783-1790`), and fullscreen/normal share one content tree
  (`dsh-client-ui-sidebar-right/README.md` "Presentations"). Consequently the
  webview element identity is stable across sidebar collapse/expand, but a
  remount, restore after plugin reload, renderer crash or explicit page reload
  replaces it and loads the checkpointed URL in a fresh page.
- Consequence: never cache "runtime injected" as a boolean for the plugin's
  lifetime. Resolve `webview[data-sidebar-browser-frame]` fresh on every open,
  test `window.__DSH_WEB_ANNOTATE__` via `executeJavaScript`, and re-inject +
  `start()` when absent. Skip `[hidden]` hosts (`:932-950`) and zero-size
  elements; dock drags set `pointer-events:none` on the webview
  (`html:has([data-dockkit-pointer])`, `:63`).

## 5. 0.2.1 → 0.2.2 differences and the reopen bug

- No 0.2.1-rc.2 package copy exists in this extraction or npm/npx caches (the
  only other copy found is 0.1.7-rc.2), so a line-by-line 0.2.1 diff is
  **unconfirmed**. What is confirmed in 0.2.2: `createDrafts` gained the
  `uploadImages` third argument (0.1.7 had two arguments), and the Browser tab
  type now sets `keepMounted` on Desktop, so tab/session/collapse switches keep
  the same `<webview>`; only remount/restore/reload recreates it.
- Most plausible runtime-side contributor to "open → exit → reopen, selection
  dead" is therefore not per-open DOM replacement but a stale handle inside the
  plugin: a cached webview reference or "already injected" flag survives
  `dropGuest()`/page reload, so the second open calls `start()` on a page where
  the runtime no longer exists (`executeJavaScript` returns `null`, no error).
  The correct contract is the REFACTOR one: re-resolve the element, re-inject if
  `window.__DSH_WEB_ANNOTATE__` is missing, call `start()`, and require
  `status().active === true`; otherwise show a localised failure.
- Sidebar presentation is not a remount source: normal/fullscreen share the same
  content tree, and panel open state is an attribute + CSS visibility change
  (`dsh-client-ui-sidebar-right/lib/client.js:1451,1743-1746`), not a rebuild.
  Hidden but mounted webviews can still report non-zero rects, so filter on
  `closest('[hidden]')`/`aria-hidden` and visibility, not rect alone.
- Secondary risk: `addAttachments` only appends ids; if `createDrafts` was called
  with `uploadImages: true` but the composer phase is frozen when attaching,
  the ids exist as drafts forever unless the plugin releases them. Always
  `releaseDraftAttachments(drafts)` when attachment or insertion fails.

## 6. Actionable contract for this plugin

1. Register with `inject: ['slots', 'locale', 'conversation']` (add
   `'sidebarRight'` only if the sidebar API is used; the DOM path needs none).
   Keep `dsh.client.inject` listing
   `@deepseek-ai/dsh-client-ui-conversation` and
   `@deepseek-ai/dsh-client-ui-sidebar-right` in `package.json`.
2. `ctx.conversation = ctx.get('conversation')` (root service, no session
   scope needed for `createDrafts`/`releaseDraftAttachments`).
3. On finish: `text = buildComposerText(batch)`; `files = images.map(toFile)`;
   `drafts = conversation.createDrafts(sessionId, files, true)`;
   `span = inputActions.captureInsertion()`; `ok = inputActions.insertText(text, span)`;
   if `ok` then `inputActions.addAttachments(drafts.map(d => d.id))` (adding
   before insert is fine too, but if insert fails release the drafts); on any
   failure call `conversation.releaseDraftAttachments(drafts)` and keep the
   page runtime alive for retry.
4. Attach images only after `createDrafts` succeeded; never call the internal
   `addFiles`, and never pass non-image files through `addAttachments` (they
   would render without a chip).
5. Open/exit cycle: resolve `[data-sidebar-right-session="<id>"]` +
   `webview[data-sidebar-browser-frame]`, skip `[hidden]`/zero-size, then
   always `ensureRuntime()` (check the window global, inject via
   `executeJavaScript` if absent), `start()`, assert `status().active`; on exit
   `stop()`/`dispose()` but do not remember injection state across opens.
6. Never assume `captureInsertion()` remains valid; recapture for every retry
   (draft edits, including the previous annotation insertion, bump `rev`).

Unconfirmed / blockers for the rewrite:
- byte-size limits and exact upload rejection codes for images (host-side
  `fileUpload`), and whether `uploadImages` may be omitted for ordinary
  sessions (it is required for images to be uploaded as attachments).
- `webview.executeJavaScript`/`capturePage` are Electron tag APIs, not a
  documented DSH plugin contract; the 0.2.2 Browser main process approves guest
  leases and the element must be attached/`dom-ready` before scripting works.
  Web (iframe) mode cannot be annotated at all.
- Direct 0.2.1-rc.2 → 0.2.2 diff could not be produced (no 0.2.1 artifacts
  available); the toggle-bug explanation above is a reasoned hypothesis, not a
  verified changelog entry.
