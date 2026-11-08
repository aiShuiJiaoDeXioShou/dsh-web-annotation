/**
 * Right-Sidebar Browser DOM discovery and the webview runtime bridge.
 *
 * The shipped sidebar has no plugin extension seat for its control strip, so
 * the annotate toggle is a foreign DOM child that is re-anchored on a timer.
 * Everything here is defensive: DSH upgrades may rename presentation details,
 * and a missing node must degrade to a readable hint, never an exception.
 */
import type { RuntimeAction, RuntimeHudTexts, RuntimeStatus } from '../shared/types.js'

/** Minimal surface of the Electron `<webview>` used by the annotation flow. */
export interface BrowserView {
  executeJavaScript(code: string): Promise<unknown>
  getURL?(): string
  getTitle?(): string
  isConnected: boolean
  getBoundingClientRect(): DOMRect
  closest(selector: string): Element | null
}

export interface BrowserTarget {
  view: BrowserView
  sessionId: string
  pageUrl: string
  pageTitle: string
}

export type TargetFailureReason = 'no-browser' | 'collapsed'

export type ResolvedTarget = { ok: true; target: BrowserTarget } | { ok: false; reason: TargetFailureReason }

export function cssEscape(value: string): string {
  if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
  return String(value).replace(/([^a-zA-Z0-9_-])/gu, '\\$1')
}

/** Whether an element is actually presented to the user (not display:none/clipped). */
export function visibleRect(element: Element): DOMRect | null {
  try {
    if (element instanceof HTMLElement && typeof element.checkVisibility === 'function') {
      if (!element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return null
    }
  } catch {
    /* checkVisibility is optional */
  }
  const rect = element.getBoundingClientRect()
  if (rect.width <= 4 || rect.height <= 4) return null
  return rect
}

function isBrowserView(element: Element): element is Element & BrowserView {
  const value = element as unknown as Partial<BrowserView>
  return typeof value.executeJavaScript === 'function'
}

/** Read a webview's current URL without letting a destroyed guest throw. */
export function viewUrl(view: BrowserView): string {
  try {
    const url = typeof view.getURL === 'function' ? view.getURL() : ''
    return typeof url === 'string' ? url : ''
  } catch {
    return ''
  }
}

export function viewTitle(view: BrowserView): string {
  try {
    const title = typeof view.getTitle === 'function' ? view.getTitle() : ''
    return typeof title === 'string' ? title : ''
  } catch {
    return ''
  }
}

/**
 * Resolve the visible webview addressed by a session id.
 *
 * Focus tracking is a hint only: the sidebar can contain several browser tabs
 * and the toggle button itself steals focus, so the first visible frame wins
 * when no tracked frame matches.
 */
export function resolveBrowserTarget(sessionId: string, focused?: BrowserView | null): ResolvedTarget {
  if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, reason: 'no-browser' }
  let root: Element | null = null
  try {
    root = document.querySelector(`[data-sidebar-right-session="${cssEscape(sessionId)}"]`)
  } catch {
    root = null
  }
  if (root === null) return { ok: false, reason: 'no-browser' }
  const views = Array.from(root.querySelectorAll('webview[data-sidebar-browser-frame]'))
  const candidates: BrowserView[] = []
  for (const element of views) {
    if (element.closest('[hidden]') !== null) continue
    if (visibleRect(element) === null) continue
    if (!isBrowserView(element)) continue
    candidates.push(element)
  }
  if (candidates.length === 0) {
    const expanded = root.hasAttribute('data-sidebar-right-open') || root.querySelector('[data-sidebar-right-open]') !== null
    return { ok: false, reason: expanded ? 'no-browser' : 'collapsed' }
  }
  const preferred = focused !== undefined && focused !== null ? candidates.find((view) => view === focused) : undefined
  const view = preferred ?? candidates[0]
  return {
    ok: true,
    target: { view, sessionId, pageUrl: viewUrl(view), pageTitle: viewTitle(view) },
  }
}

export interface ChromeStripTarget {
  strip: HTMLElement
  sessionId: string
  pageVisible: boolean
}

/** Locate the open right-sidebar strip that owns a loaded browser page. */
export function findChromeStrip(): ChromeStripTarget | null {
  const panels = document.querySelectorAll('[data-sidebar-right-session][data-sidebar-right-open]')
  for (const panel of panels) {
    const sessionId = panel.getAttribute('data-sidebar-right-session')
    if (typeof sessionId !== 'string' || sessionId === '') continue
    const panelRect = panel.getBoundingClientRect()
    if (panelRect.width <= 0 || panelRect.height <= 0) continue
    const strip = panel.querySelector('[data-dockkit-strip]')
    if (strip === null || !(strip instanceof HTMLElement)) continue
    let pageVisible = false
    const views = panel.querySelectorAll('webview[data-sidebar-browser-frame]')
    for (const view of views) {
      const viewRect = view.getBoundingClientRect()
      if (viewRect.width <= 4 || viewRect.height <= 4) continue
      const url = viewUrl(view as unknown as BrowserView)
      if (url !== '' && url.startsWith('about:') !== true) {
        pageVisible = true
        break
      }
    }
    return { strip, sessionId, pageVisible }
  }
  return null
}

/** Evaluate one expression against the injected runtime; null when unavailable. */
export async function callRuntime<T = unknown>(view: BrowserView, expression: string): Promise<T | null> {
  try {
    const value = await view.executeJavaScript(
      'window.__DSH_WEB_ANNOTATE__ ? window.__DSH_WEB_ANNOTATE__.' + expression + ' : null',
    )
    return (value ?? null) as T | null
  } catch {
    return null
  }
}

/**
 * Make sure a compatible runtime is live without destroying an existing one.
 *
 * Re-injecting on every open would throw away the persistent annotation batch
 * (ChatGPT-style markers must survive mode switches), so the existing runtime is
 * reused whenever its reported version matches; only a missing/stale runtime is
 * injected, and runtimeMain disposes the previous copy itself.
 */
export async function ensureRuntime(view: BrowserView, source: string, expectedVersion: number): Promise<boolean> {
  const current = await callRuntime<RuntimeStatus>(view, 'status()')
  if (current !== null && current.alive === true && current.version === expectedVersion) return true
  return injectRuntime(view, source)
}

/** Inject (or re-inject) the page runtime; runtimeMain disposes any previous copy itself. */
export async function injectRuntime(view: BrowserView, source: string): Promise<boolean> {
  // The guest may still be attaching when the user opens annotation mode right
  // after the tab appears, so a failed executeJavaScript gets one short retry.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await delay(250)
    try {
      await view.executeJavaScript(source + ';true')
    } catch {
      continue
    }
    const status = await callRuntime<RuntimeStatus>(view, 'status()')
    if (status !== null && status.alive === true) return true
  }
  return false
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** Start annotation mode and verify the overlay actually became active. */
export async function startRuntime(view: BrowserView, hud: RuntimeHudTexts): Promise<RuntimeStatus | null> {
  try {
    await view.executeJavaScript(
      'window.__DSH_WEB_ANNOTATE__ && window.__DSH_WEB_ANNOTATE__.start(' + JSON.stringify({ hud }) + ');true',
    )
  } catch {
    return null
  }
  const status = await callRuntime<RuntimeStatus>(view, 'status()')
  return status !== null && status.active === true ? status : null
}

export async function stopRuntime(view: BrowserView): Promise<void> {
  await callRuntime(view, 'stop()')
}

export async function clearRuntime(view: BrowserView): Promise<void> {
  await callRuntime(view, 'clear()')
}

/** Consume the one-shot page-side command queue ('commit' from the bottom bar). */
export async function takeRuntimeAction(view: BrowserView): Promise<RuntimeAction | null> {
  const action = await callRuntime<RuntimeAction | null>(view, 'takeAction()')
  return action === 'commit' ? 'commit' : null
}
