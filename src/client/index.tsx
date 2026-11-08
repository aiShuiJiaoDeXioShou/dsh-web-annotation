/**
 * Browser half of dsh-web-annotation.
 *
 * Wiring only: register locale/CSS, build the per-session controller, and
 * mount the two UI surfaces into the catalogued public slots:
 *  - `shell.overlay`    -> annotation toggle in the right-Sidebar dock strip
 *  - `conversation.input.dock` -> live batch row + insert/cancel controls
 *
 * Finished annotations become ordinary composer text and ordinary composer
 * image attachments; there is no Host route, report file or session rewrite.
 */
import * as React from 'react'

import type { BrowserView } from './target.js'
import { resolveBrowserTarget } from './target.js'
import { injectRuntime, startRuntime, stopRuntime, clearRuntime } from './target.js'
import { createAttachmentBridge, type ConversationFace } from './attachments.js'
import { AnnotationController } from './controller.js'
import { runtimeMain } from './runtime.js'
import { en, fill, zh } from './locale.js'
import { ChromeToggle, ComposerDock, CSS_TEXT } from './ui.js'

const LOCALE_NS = 'dshWebAnnotation'
const RUNTIME_SOURCE = '(' + runtimeMain.toString() + ')();'

interface PluginContext {
  effect(register: () => (() => void) | void, label?: string): void
  locale: {
    register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(namespace: string): (key: string) => string
  }
  slots: {
    inject(name: string, factory: () => (() => void) | void): void
    register(options: Record<string, unknown>, component: (props: never) => React.ReactElement | null): () => void
  }
  get(name: string): unknown
  inject(names: string[], callback: (ctx: PluginContext) => void): void
}

export const inject = ['slots', 'locale']

export function apply(ctx: PluginContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-web-annotation: locale')
  const bound = ctx.locale.bind(LOCALE_NS)
  const t = (key: string, params?: Record<string, string | number>): string => fill(bound(key), params)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-plugin-css', 'dsh-web-annotation')
    style.textContent = CSS_TEXT
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, 'dsh-web-annotation: styles')

  // Track the focused browser frame so several right-sidebar tabs resolve to the
  // one the user is actually working in. Focus is a hint only; the target
  // resolver falls back to the first visible frame.
  const focus: { element: BrowserView | null } = { element: null }
  ctx.effect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (target.tagName === 'WEBVIEW' && target.hasAttribute('data-sidebar-browser-frame')) {
        focus.element = target as unknown as BrowserView
      }
    }
    document.addEventListener('focusin', onFocusIn, true)
    return () => document.removeEventListener('focusin', onFocusIn, true)
  }, 'dsh-web-annotation: focus tracking')

  // The Conversation service activates when the conversation package boots; it
  // can be later than this plugin, so resolve lazily and re-resolve on demand.
  let conversation: ConversationFace | undefined
  const resolveConversation = (): ConversationFace | undefined => {
    if (conversation !== undefined) return conversation
    try {
      const service = ctx.get('conversation')
      if (service !== null && typeof service === 'object') conversation = service as unknown as ConversationFace
    } catch {
      /* service not ready yet */
    }
    return conversation
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['conversation'], (serviceCtx) => {
        const service = serviceCtx.get('conversation')
        if (service !== null && typeof service === 'object') conversation = service as unknown as ConversationFace
      })
    } catch {
      /* older client builds without deferred inject fall back to ctx.get */
    }
  }

  const controller = new AnnotationController({
    resolveTarget: (sessionId) => resolveBrowserTarget(sessionId, focus.element),
    injectRuntime: (view) => injectRuntime(view, RUNTIME_SOURCE),
    startRuntime: (view, hud) => startRuntime(view, hud),
    stopRuntime: (view) => stopRuntime(view),
    clearRuntime: (view) => clearRuntime(view),
    getInputActions: (sessionId) => controller.getInputActions(sessionId),
    attachments: createAttachmentBridge(resolveConversation),
    t,
    timers: {
      setInterval: (handler, ms) => window.setInterval(handler, ms),
      clearInterval: (handle) => window.clearInterval(handle as number),
      setTimeout: (handler, ms) => window.setTimeout(handler, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
  })

  ctx.effect(
    () => () => controller.dispose(),
    'dsh-web-annotation: controller disposal',
  )

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'web-annotation-chrome', order: 40 },
    () => React.createElement(ChromeToggle, { controller, t }) as unknown as React.ReactElement | null,
  )), 'dsh-web-annotation: chrome control')

  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: 'web-annotation-dock', order: 16, locale: LOCALE_NS },
    ((props: { sessionId?: string; inputActions?: unknown }) => {
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      if (sessionId === '') return null
      return React.createElement(ComposerDock, {
        controller,
        sessionId,
        inputActions: props.inputActions,
        t,
      }) as unknown as React.ReactElement
    }) as never,
  )), 'dsh-web-annotation: composer dock')
}
