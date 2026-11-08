/**
 * Per-session annotation state machine.
 *
 * The interaction follows the ChatGPT annotation model:
 *  - the sidebar toggle arms/disarms the page gesture overlay (capture mode);
 *  - disarming is a PAUSE, not a submit: numbered markers stay visible on the
 *    page and their pins stay clickable for editing;
 *  - the batch lives until the user explicitly asks to insert it into the
 *    composer ("写入输入框", from the in-page bar or the dock row) and is only
 *    then turned into composer text + attachments and cleared from the page.
 *
 * Toggle transitions are serialised so a fast second click cannot race a
 * half-finished change. The page runtime is reused while it is alive (that is
 * what keeps the markers across pause/resume); it is re-injected only when
 * missing, stale, or when the page navigated away.
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
import { callRuntime, takeRuntimeAction, type BrowserView, type ResolvedTarget } from './target.js'

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
  /** Capture mode is armed on the page (the toggle is on). */
  open: boolean
  /** A toggle transition is in flight. */
  busy: boolean
  /** Page runtime reports itself active. */
  active: boolean
  editorOpen: boolean
  editingId: string | null
  /** Committed annotations, kept across pause so pins stay editable. */
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
  /** Reuse a live compatible runtime (persistent batch) or inject a fresh one. */
  ensureRuntime(view: BrowserView): Promise<boolean>
  startRuntime(view: BrowserView, hud: RuntimeHudTexts): Promise<RuntimeStatus | null>
  stopRuntime(view: BrowserView): Promise<void>
  clearRuntime(view: BrowserView): Promise<void>
  /** Consume the one-shot 'commit' command queued by the in-page bar. */
  takeRuntimeAction(view: BrowserView): Promise<'commit' | null>
  getInputActions(sessionId: string): ComposerInputActions | undefined
  attachments: AttachmentBridge
  t(key: string, params?: Record<string, string | number>): string
  timers: ControllerTimers
}

const POLL_MS = 250
const HINT_MS = 5200

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

  /** Sidebar toggle: arm capture when paused, pause when armed. Never writes. */
  async toggle(sessionId: string): Promise<void> {
    const state = this.stateOf(sessionId)
    if (state.open) await this.pause(sessionId)
    else await this.open(sessionId)
  }

  async open(sessionId: string): Promise<void> {
    if (this.disposed) return
    await this.exclusive(sessionId, () => this.openInternal(sessionId))
  }

  async pause(sessionId: string): Promise<void> {
    if (this.disposed) return
    await this.exclusive(sessionId, () => this.pauseInternal(sessionId))
  }

  /** Explicit submit: insert the batch into the composer, then clear the page. */
  async write(sessionId: string): Promise<void> {
    if (this.disposed) return
    await this.exclusive(sessionId, () => this.writeInternal(sessionId))
  }

  /** Throw the batch away and remove every marker from the page. */
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
    const state = store.get()
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
    const ensured = await this.deps.ensureRuntime(view)
    if (!ensured) {
      store.set({ open: false, active: false, hint: { kind: 'error', text: this.deps.t('hint.injectFailed') } })
      return
    }
    const status = await this.deps.startRuntime(view, this.hudTexts())
    if (status === null) {
      store.set({ open: false, active: false, hint: { kind: 'error', text: this.deps.t('hint.injectFailed') } })
      return
    }
    this.views.set(sessionId, view)
    const records = Array.isArray(status.records) ? status.records : []
    // The runtime is the source of truth: if it lost a previously stored batch
    // (page reload/navigation), say so instead of showing a stale count.
    const lost = state.records.length > 0 && records.length === 0
    store.set({
      open: true,
      active: true,
      editorOpen: status.editorOpen === true,
      editingId: typeof status.editingId === 'string' ? status.editingId : null,
      records,
      revision: status.revision,
      pageUrl: status.url || resolved.target.pageUrl,
      pageTitle: status.title || resolved.target.pageTitle,
      hint: lost ? { kind: 'warn', text: this.deps.t('hint.pageGone') } : null,
      lastInsert: null,
    })
    this.startPolling(sessionId)
  }

  private async pauseInternal(sessionId: string): Promise<void> {
    const store = this.storeFor(sessionId)
    const state = store.get()
    if (state.open !== true && state.records.length === 0) return
    const view = this.views.get(sessionId) ?? this.resolveView(sessionId)
    if (view !== undefined) await this.deps.stopRuntime(view)
    // Sync first: a quick toggle-off right after creating a note must not lose
    // the fresh record (the 250 ms poll may not have run yet).
    const status = view === undefined ? null : await callRuntime<RuntimeStatus>(view, 'pull()').catch(() => null)
    const records = status !== null && Array.isArray(status.records) ? status.records : state.records
    const patch: Partial<SessionState> = {
      open: false,
      active: false,
      editorOpen: false,
      editingId: null,
      records,
    }
    if (status !== null) {
      patch.revision = status.revision
      if (typeof status.url === 'string' && status.url !== '') patch.pageUrl = status.url
      if (typeof status.title === 'string' && status.title !== '') patch.pageTitle = status.title
    }
    store.set(patch)
    if (records.length > 0) this.startPolling(sessionId)
    else this.stopPolling(sessionId)
  }

  private async writeInternal(sessionId: string): Promise<void> {
    const store = this.storeFor(sessionId)
    const state = store.get()
    const view = this.views.get(sessionId) ?? this.resolveView(sessionId)
    if (view === undefined) {
      this.resetClosed(sessionId, { kind: 'warn', text: this.deps.t('hint.pageGone') })
      return
    }
    // Commit whatever is typed into the page bubble; that is what the user sees.
    await callRuntime(view, 'closeEditor()')
    const collected = await callRuntime<CollectedBatch>(view, 'collect()')
    if (collected === null) {
      store.set({ hint: { kind: 'error', text: this.deps.t('hint.captureFailed') } })
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
      if (store.get().records.length > 0 || store.get().open) return
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

  /** Projection poll: sync markers/editor state and consume in-page commands. */
  private async poll(sessionId: string): Promise<void> {
    const store = this.storeFor(sessionId)
    const state = store.get()
    if (this.disposed) return
    if (state.open !== true && state.records.length === 0) {
      this.stopPolling(sessionId)
      return
    }
    const view = this.views.get(sessionId)
    if (view === undefined) return
    if (state.busy) return
    const status = await callRuntime<RuntimeStatus>(view, 'pull()')
    if (status === null) {
      // The guest was recreated or navigated: the batch markers are gone.
      const ensured = await this.deps.ensureRuntime(view)
      if (!ensured) {
        this.resetClosed(sessionId, { kind: 'warn', text: this.deps.t('hint.pageGone') })
        return
      }
      if (state.records.length > 0 || state.open) {
        this.resetClosed(sessionId, { kind: 'warn', text: this.deps.t('hint.pageGone') })
      }
      return
    }
    if (status.action === 'commit') {
      await this.exclusive(sessionId, async () => {
        await this.deps.takeRuntimeAction(view)
        await this.writeInternal(sessionId)
      })
      return
    }
    if (status.active === false && state.open === true) {
      // Esc / bottom-bar exit: pause, keeping the markers.
      await this.exclusive(sessionId, () => this.pauseInternal(sessionId))
      return
    }
    const patch: Partial<SessionState> = {
      active: status.active === true,
      editorOpen: status.editorOpen === true,
      editingId: typeof status.editingId === 'string' ? status.editingId : null,
    }
    if (typeof status.url === 'string' && status.url !== '' && status.url !== state.pageUrl) patch.pageUrl = status.url
    if (typeof status.title === 'string' && status.title !== '' && status.title !== state.pageTitle) patch.pageTitle = status.title
    const serverRecords = Array.isArray(status.records) ? status.records : []
    if (status.revision !== state.revision || serverRecords.length !== state.records.length) {
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
      editorImageLabel: this.deps.t('editor.imageLabel'),
      editorDone: this.deps.t('editor.done'),
      editorImageRemove: this.deps.t('editor.imageRemove'),
      editorImageTooLarge: this.deps.t('editor.imageTooLarge'),
      editorImageLimit: this.deps.t('editor.imageLimit'),
      editorImageUnsupported: this.deps.t('editor.imageUnsupported'),
      barTitle: this.deps.t('bar.title'),
      barWrite: this.deps.t('bar.write'),
      barWriting: this.deps.t('bar.writing'),
      barClear: this.deps.t('bar.clear'),
      barExit: this.deps.t('bar.exit'),
    }
  }
}

/**
 * Insert one block into the composer at the caret. A stale span retries once;
 * a frozen/busy composer reports failure so the controller keeps the page batch
 * intact instead of losing it.
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
