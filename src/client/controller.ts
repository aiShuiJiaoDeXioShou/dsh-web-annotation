/**
 * Per-session annotation state machine.
 *
 * Responsibilities:
 *  - serialise the toggle transition (open / finish / discard) so a fast
 *    second click can never race a half-finished transition (the old JS
 *    plugin's "reopen does nothing" bug lived in this lifecycle);
 *  - always re-inject and restart the page runtime on open, which makes the
 *    mode deterministic after any number of exits;
 *  - on finish, turn committed records into one composer text block and stage
 *    the attached images as real composer attachments;
 *  - poll the page runtime for projection state while the mode is open.
 *
 * There is no Host half, no report file and no session-log rewriting: the
 * composer draft is the single destination of a finished batch.
 */
import { buildComposerText } from '../shared/text.js'
import type {
  CollectedBatch,
  CollectedImages,
  RuntimeHudTexts,
  RuntimeRecord,
  RuntimeStatus,
} from '../shared/types.js'
import { createStore, type Store } from './store.js'
import type { AttachmentBridge, ComposerInputActions } from './attachments.js'
import { flattenCommittedImages } from './attachments.js'
import { callRuntime, type BrowserView, type ResolvedTarget } from './target.js'

export interface AnnotationHint {
  kind: 'info' | 'warn' | 'error'
  text: string
}

export interface LastInsert {
  count: number
  images: number
  at: number
}

export interface SessionState {
  sessionId: string
  /** Annotation mode is armed on the page. */
  open: boolean
  /** A toggle transition is in flight. */
  busy: boolean
  active: boolean
  editorOpen: boolean
  editingId: string | null
  records: RuntimeRecord[]
  revision: number
  pageUrl: string
  pageTitle: string
  hint: AnnotationHint | null
  lastInsert: LastInsert | null
}

export interface ControllerTimers {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface ControllerDeps {
  resolveTarget(sessionId: string): ResolvedTarget
  injectRuntime(view: BrowserView): Promise<boolean>
  startRuntime(view: BrowserView, hud: RuntimeHudTexts): Promise<RuntimeStatus | null>
  stopRuntime(view: BrowserView): Promise<void>
  clearRuntime(view: BrowserView): Promise<void>
  getInputActions(sessionId: string): ComposerInputActions | undefined
  attachments: AttachmentBridge
  t(key: string, params?: Record<string, string | number>): string
  timers: ControllerTimers
}

const POLL_MS = 250
const HINT_MS = 4500

export function initialState(sessionId: string): SessionState {
  return {
    sessionId,
    open: false,
    busy: false,
    active: false,
    editorOpen: false,
    editingId: null,
    records: [],
    revision: -1,
    pageUrl: '',
    pageTitle: '',
    hint: null,
    lastInsert: null,
  }
}

export class AnnotationController {
  private readonly deps: ControllerDeps
  private readonly stores = new Map<string, Store<SessionState>>()
  private readonly views = new Map<string, BrowserView>()
  private readonly actions = new Map<string, ComposerInputActions>()
  private readonly locks = new Set<string>()
  private readonly polls = new Map<string, unknown>()
  private readonly hintTimers = new Map<string, unknown>()
  private disposed = false

  constructor(deps: ControllerDeps) {
    this.deps = deps
  }

  /** Store for one session; created on first access so the slot can render anytime. */
  storeFor(sessionId: string): Store<SessionState> {
    let store = this.stores.get(sessionId)
    if (store === undefined) {
      store = createStore(initialState(sessionId))
      this.stores.set(sessionId, store)
    }
    return store
  }

  stateOf(sessionId: string): SessionState {
    return this.storeFor(sessionId).get()
  }

  /** The composer slot hands the real input actions over after mount. */
  setInputActions(sessionId: string, actions: ComposerInputActions | undefined): void {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (actions === undefined) this.actions.delete(sessionId)
    else this.actions.set(sessionId, actions)
  }

  getInputActions(sessionId: string): ComposerInputActions | undefined {
    return this.actions.get(sessionId)
  }

  /** Public entry point for the sidebar toggle and the dock buttons. */
  async toggle(sessionId: string): Promise<void> {
    const state = this.stateOf(sessionId)
    if (state.open) await this.finish(sessionId)
    else await this.open(sessionId)
  }

  async open(sessionId: string): Promise<void> {
    if (this.disposed) return
    await this.exclusive(sessionId, () => this.openInternal(sessionId))
  }

  async finish(sessionId: string): Promise<void> {
    if (this.disposed) return
    await this.exclusive(sessionId, () => this.finishInternal(sessionId))
  }

  /** Throw away the page-side batch without inserting anything. */
  async discard(sessionId: string): Promise<void> {
    if (this.disposed) return
    await this.exclusive(sessionId, async () => {
      const view = this.views.get(sessionId) ?? this.resolveView(sessionId)
      if (view !== undefined) {
        await this.deps.clearRuntime(view)
        await this.deps.stopRuntime(view)
      }
      this.resetClosed(sessionId, { kind: 'info', text: this.deps.t('hint.discarded') })
    })
  }

  dispose(): void {
    this.disposed = true
    for (const handle of this.polls.values()) this.deps.timers.clearInterval(handle)
    this.polls.clear()
    for (const handle of this.hintTimers.values()) this.deps.timers.clearTimeout(handle)
    this.hintTimers.clear()
    for (const view of this.views.values()) {
      this.deps.stopRuntime(view).catch(() => undefined)
    }
    this.views.clear()
    this.actions.clear()
    this.stores.clear()
  }

  // ---------------------------------------------------------------- internal

  private async exclusive(sessionId: string, task: () => Promise<void>): Promise<void> {
    if (this.locks.has(sessionId)) return
    this.locks.add(sessionId)
    this.storeFor(sessionId).set({ busy: true })
    try {
      await task()
    } finally {
      this.locks.delete(sessionId)
      this.storeFor(sessionId).set({ busy: false })
    }
  }

  private resolveView(sessionId: string): BrowserView | undefined {
    const resolved = this.deps.resolveTarget(sessionId)
    if (resolved.ok !== true) return undefined
    this.views.set(sessionId, resolved.target.view)
    return resolved.target.view
  }

  private async openInternal(sessionId: string): Promise<void> {
    const store = this.storeFor(sessionId)
    const resolved = this.deps.resolveTarget(sessionId)
    if (resolved.ok !== true) {
      store.set({
        open: false,
        active: false,
        hint: {
          kind: 'warn',
          text: resolved.reason === 'collapsed' ? this.deps.t('hint.collapsed') : this.deps.t('hint.noBrowser'),
        },
      })
      return
    }
    const view = resolved.target.view
    const injected = await this.deps.injectRuntime(view)
    if (!injected) {
      store.set({ open: false, active: false, hint: { kind: 'error', text: this.deps.t('hint.injectFailed') } })
      return
    }
    // A fresh start is the fix for the reopen bug: never trust overlay state
    // left behind by a previous mode/session, always clear then arm.
    await this.deps.clearRuntime(view)
    const status = await this.deps.startRuntime(view, this.hudTexts())
    if (status === null) {
      store.set({ open: false, active: false, hint: { kind: 'error', text: this.deps.t('hint.injectFailed') } })
      return
    }
    this.views.set(sessionId, view)
    store.set({
      open: true,
      active: true,
      editorOpen: false,
      editingId: null,
      records: [],
      revision: status.revision,
      pageUrl: status.url || resolved.target.pageUrl,
      pageTitle: status.title || resolved.target.pageTitle,
      hint: null,
      lastInsert: null,
    })
    this.startPolling(sessionId)
  }

  private async finishInternal(sessionId: string): Promise<void> {
    const store = this.storeFor(sessionId)
    const view = this.views.get(sessionId) ?? this.resolveView(sessionId)
    if (view === undefined) {
      this.resetClosed(sessionId, { kind: 'warn', text: this.deps.t('hint.pageGone') })
      return
    }
    // Commit whatever is typed into the page bubble; that is what the user sees.
    await callRuntime(view, 'closeEditor()')
    const collected = await callRuntime<CollectedBatch>(view, 'collect()')
    if (collected === null) {
      this.resetClosed(sessionId, { kind: 'error', text: this.deps.t('hint.captureFailed') })
      return
    }
    const records = (Array.isArray(collected.records) ? collected.records : []).filter(
      (record) => record.comment.trim() !== '' || record.images.length > 0,
    )
    if (records.length === 0) {
      await this.cleanupRuntime(sessionId, view)
      this.resetClosed(sessionId, null)
      return
    }
    const imageBundle = await callRuntime<CollectedImages>(view, 'collectImages()')
    const images = imageBundle === null || !Array.isArray(imageBundle.records) ? [] : flattenCommittedImages(imageBundle.records)
    const text = buildComposerText(records, { imageCount: images.length })
    const actions = this.deps.getInputActions(sessionId)
    const inserted = insertComposerText(actions, text)
    if (!inserted) {
      // Keep the page batch alive so the user can retry once the composer is free.
      store.set({ hint: { kind: 'warn', text: this.deps.t('hint.insertFailed') } })
      return
    }
    let attached = 0
    let imageFailure = false
    if (images.length > 0) {
      const result = this.deps.attachments.attach(sessionId, actions, images)
      attached = result.attached
      if (result.ok !== true) {
        imageFailure = true
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          /* clipboard is optional */
        }
      }
    }
    await this.cleanupRuntime(sessionId, view)
    const hint: AnnotationHint = imageFailure
      ? { kind: 'warn', text: this.deps.t('hint.imageFailed') }
      : {
          kind: 'info',
          text:
            attached > 0
              ? this.deps.t('hint.insertedImages', { count: records.length, images: attached })
              : this.deps.t('hint.inserted', { count: records.length }),
        }
    this.resetClosed(sessionId, hint, {
      count: records.length,
      images: attached,
      at: Date.now(),
    })
  }

  private async cleanupRuntime(sessionId: string, view: BrowserView): Promise<void> {
    await this.deps.clearRuntime(view)
    await this.deps.stopRuntime(view)
    this.stopPolling(sessionId)
  }

  private resetClosed(sessionId: string, hint: AnnotationHint | null, lastInsert?: LastInsert): void {
    this.stopPolling(sessionId)
    this.views.delete(sessionId)
    const patch: Partial<SessionState> = {
      open: false,
      active: false,
      editorOpen: false,
      editingId: null,
      records: [],
      revision: -1,
      hint,
    }
    if (lastInsert !== undefined) patch.lastInsert = lastInsert
    this.storeFor(sessionId).set(patch)
    this.scheduleHintClear(sessionId)
  }

  private scheduleHintClear(sessionId: string): void {
    const previous = this.hintTimers.get(sessionId)
    if (previous !== undefined) this.deps.timers.clearTimeout(previous)
    const handle = this.deps.timers.setTimeout(() => {
      this.hintTimers.delete(sessionId)
      const store = this.stores.get(sessionId)
      if (store === undefined) return
      if (store.get().open) return
      store.set({ hint: null, lastInsert: null })
    }, HINT_MS)
    this.hintTimers.set(sessionId, handle)
  }

  private startPolling(sessionId: string): void {
    this.stopPolling(sessionId)
    const handle = this.deps.timers.setInterval(() => {
      this.poll(sessionId).catch(() => undefined)
    }, POLL_MS)
    this.polls.set(sessionId, handle)
  }

  private stopPolling(sessionId: string): void {
    const handle = this.polls.get(sessionId)
    if (handle === undefined) return
    this.deps.timers.clearInterval(handle)
    this.polls.delete(sessionId)
  }

  /** Projection poll: keep the dock UI current and notice page-side exits. */
  private async poll(sessionId: string): Promise<void> {
    const store = this.storeFor(sessionId)
    const state = store.get()
    if (this.disposed || state.open !== true || state.busy) return
    const view = this.views.get(sessionId)
    if (view === undefined) return
    let status = await callRuntime<RuntimeStatus>(view, 'pull()')
    if (status === null) {
      const reinjected = await this.deps.injectRuntime(view)
      if (!reinjected) {
        this.resetClosed(sessionId, { kind: 'warn', text: this.deps.t('hint.pageGone') })
        return
      }
      const restarted = await this.deps.startRuntime(view, this.hudTexts())
      if (restarted === null) {
        this.resetClosed(sessionId, { kind: 'warn', text: this.deps.t('hint.pageGone') })
        return
      }
      status = restarted
    }
    if (status.active === false) {
      // The page-side runtime left annotation mode (Esc, page teardown, ...).
      await this.finish(sessionId)
      return
    }
    const patch: Partial<SessionState> = {
      active: true,
      editorOpen: status.editorOpen === true,
      editingId: typeof status.editingId === 'string' ? status.editingId : null,
    }
    if (typeof status.url === 'string' && status.url !== '' && status.url !== state.pageUrl) patch.pageUrl = status.url
    if (typeof status.title === 'string' && status.title !== '' && status.title !== state.pageTitle) patch.pageTitle = status.title
    if (status.revision !== state.revision || status.count !== state.records.length) {
      const collected = await callRuntime<CollectedBatch>(view, 'collect()')
      if (collected !== null && Array.isArray(collected.records)) {
        patch.records = collected.records
        patch.revision = status.revision
      }
    }
    if (Object.keys(patch).length > 0) store.set(patch)
  }

  private hudTexts(): RuntimeHudTexts {
    return {
      editorPlaceholder: this.deps.t('editor.placeholder'),
      editorDelete: this.deps.t('editor.delete'),
      editorConfirm: this.deps.t('editor.confirm'),
      editorAddImage: this.deps.t('editor.addImage'),
      editorImageRemove: this.deps.t('editor.imageRemove'),
      editorImageTooLarge: this.deps.t('editor.imageTooLarge'),
      editorImageLimit: this.deps.t('editor.imageLimit'),
      editorImageUnsupported: this.deps.t('editor.imageUnsupported'),
    }
  }
}

/**
 * Insert one block into the composer at the caret. A stale span retries once;
 * a frozen/busy composer reports failure so the controller can keep the page
 * batch intact instead of losing it.
 */
export function insertComposerText(actions: ComposerInputActions | undefined, text: string): boolean {
  if (actions === undefined || typeof actions.insertText !== 'function') return false
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const span = typeof actions.captureInsertion === 'function' ? actions.captureInsertion() : undefined
      const start = span !== null && typeof span === 'object' ? Number((span as { start?: unknown }).start) : 0
      const prefix = Number.isFinite(start) && start > 0 ? '\n\n' : ''
      if (actions.insertText(prefix + text, span) === true) return true
    } catch {
      /* retry once, then report failure */
    }
  }
  return false
}
