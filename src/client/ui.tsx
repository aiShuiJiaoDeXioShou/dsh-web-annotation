/**
 * React surface for the annotation bundle:
 *  - the right-Sidebar strip toggle (foreign DOM inserted into the dock strip);
 *  - the compact dock row above the composer that shows the live batch and
 *    offers "insert into composer" / "cancel";
 *  - transient hints after inserting or when something fails.
 */
import * as React from 'react'
import { fill } from './locale.js'
import type { AnnotationController, SessionState } from './controller.js'
import { findChromeStrip } from './target.js'

export const CSS_TEXT = [
  '.dsh-ann-chrome-btn{height:28px;display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:500 12px/1 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;cursor:pointer;flex:none}',
  '.dsh-ann-chrome-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
  '.dsh-ann-chrome-btn.is-active,.dsh-ann-chrome-btn.has-batch{background:#EAF0FB;color:#0A5CF5}',
  '.dsh-ann-chrome-btn:disabled{opacity:.55;cursor:default}',
  '.dsh-ann-chrome-btn svg{width:16px;height:16px;flex:none}',
  '.dsh-ann-chrome-label{white-space:nowrap}',
  '.dsh-ann-chrome-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}',
  '.dsh-ann-badge{position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#2563eb;color:#fff;font:600 9px/14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;pointer-events:none;display:none;box-sizing:border-box}',
  '.dsh-ann-dock-row{display:flex;width:100%;min-width:0;box-sizing:border-box;padding-top:2px;padding-bottom:2px}',
  '.dsh-ann-dock{display:inline-flex;align-items:center;gap:.45em;min-height:2em;padding:.15em .25em .15em .7em;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:.6em;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary);font-size:calc(var(--dsh-content-font-size,14px) - 3px);line-height:1.35;width:max-content;max-width:100%}',
  '.dsh-ann-dock svg{width:1.15em;height:1.15em;flex:none;color:var(--dsw-alias-label-secondary)}',
  '.dsh-ann-dock-text{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.dsh-ann-dock-hint{color:var(--dsw-alias-label-secondary);font-size:.92em}',
  '.dsh-ann-dock-spacer{flex:1 1 auto;min-width:.4em}',
  '.dsh-ann-dock-action{flex:none;height:1.8em;padding:0 .6em;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:.5em;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:.92em;cursor:pointer;white-space:nowrap}',
  '.dsh-ann-dock-action:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16))}',
  '.dsh-ann-dock-action.is-primary{background:var(--dsw-alias-brand-primary,#2563eb);border-color:transparent;color:#fff}',
  '.dsh-ann-dock-action:disabled{opacity:.55;cursor:default}',
  '.dsh-ann-dock.is-warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#b45309) 45%,transparent)}',
  '.dsh-ann-dock.is-paused{border-style:dashed}',
  '.dsh-ann-dock.is-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 45%,transparent)}',
].join('\n')

/** ChatGPT-style annotate glyph: four selection corners plus a cursor arrow. */
export function AnnotateIcon({ size = 17 }: { size?: number }) {
  return React.createElement(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', focusable: 'false' },
    React.createElement('path', {
      d: 'M4 8.6V6.7A2.7 2.7 0 0 1 6.7 4h1.9M15.4 4h1.9A2.7 2.7 0 0 1 20 6.7v1.9M20 15.4v1.9a2.7 2.7 0 0 1-2.7 2.7h-1.9M8.6 20H6.7A2.7 2.7 0 0 1 4 17.3v-1.9',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
    React.createElement('path', {
      d: 'M11.4 10.4l7 2.8-3.2 1.2-1.2 3.2z',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.8',
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }),
  )
}

const ANNOTATE_GLYPH_HTML =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
  '<path d="M4 8.6V6.7A2.7 2.7 0 0 1 6.7 4h1.9M15.4 4h1.9A2.7 2.7 0 0 1 20 6.7v1.9M20 15.4v1.9a2.7 2.7 0 0 1-2.7 2.7h-1.9M8.6 20H6.7A2.7 2.7 0 0 1 4 17.3v-1.9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M11.4 10.4l7 2.8-3.2 1.2-1.2 3.2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>' +
  '</svg>'

function useSessionState(controller: AnnotationController, sessionId: string): SessionState {
  const store = controller.storeFor(sessionId)
  const [, force] = React.useReducer((value: number) => value + 1, 0)
  React.useEffect(() => store.subscribe(force), [store])
  return store.get()
}

export interface ChromeToggleProps {
  controller: AnnotationController
  t: (key: string, params?: Record<string, string | number>) => string
}

/**
 * The annotation entry control lives in the right-Sidebar dock strip. The
 * shipped sidebar declares no extension seat for its strip chrome, so this
 * component owns one foreign-DOM child it inserts and keeps re-anchored; it
 * disappears when no page is loaded in the column.
 */
export function ChromeToggle({ controller, t }: ChromeToggleProps): null {
  React.useEffect(() => {
    const container = document.createElement('div')
    container.setAttribute('data-web-annotation-chrome', '')
    container.style.cssText = 'display:none;align-items:center;flex:none;position:relative'
    try {
      container.style.setProperty('-webkit-app-region', 'no-drag')
    } catch {
      /* ignore */
    }
    const badge = document.createElement('span')
    badge.className = 'dsh-ann-badge'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'dsh-ann-chrome-btn'
    button.innerHTML = ANNOTATE_GLYPH_HTML
    const buttonLabel = document.createElement('span')
    buttonLabel.className = 'dsh-ann-chrome-label'
    buttonLabel.textContent = t('toggle.label')
    button.appendChild(buttonLabel)
    container.appendChild(button)
    container.appendChild(badge)

    let currentSession: string | null = null
    let unsubscribe: (() => void) | null = null

    const updateButton = () => {
      if (currentSession === null) return
      const state = controller.stateOf(currentSession)
      const open = state.open === true
      const count = state.records.length
      button.classList.toggle('is-active', open)
      button.classList.toggle('has-batch', !open && count > 0)
      button.disabled = state.busy
      const label = open ? t('toggle.exit') : count > 0 ? fill(t('toggle.resume'), { count }) : t('toggle.title')
      button.title = label
      button.setAttribute('aria-label', label)
      button.setAttribute('aria-pressed', open ? 'true' : 'false')
      badge.textContent = count > 0 ? String(count) : ''
      badge.style.display = count > 0 ? 'block' : 'none'
    }

    const onPointerDown = (event: PointerEvent) => {
      event.stopPropagation()
    }
    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const sessionId = currentSession
      if (sessionId === null) return
      const state = controller.stateOf(sessionId)
      if (state.busy) return
      controller.toggle(sessionId).catch(() => undefined)
    }
    button.addEventListener('pointerdown', onPointerDown, true)
    button.addEventListener('click', onClick, true)

    const sync = () => {
      const target = findChromeStrip()
      if (target === null) {
        container.style.display = 'none'
        return
      }
      const state = controller.stateOf(target.sessionId)
      if (!target.pageVisible && !state.open) {
        container.style.display = 'none'
        return
      }
      if (container.parentElement !== target.strip) {
        const control =
          target.strip.querySelector('[data-dockkit-split-control]') ??
          target.strip.querySelector('[data-dockkit-split-button]')
        let anchor: Element | null = control
        while (anchor !== null && anchor.parentElement !== null && anchor.parentElement !== target.strip) {
          anchor = anchor.parentElement
        }
        if (anchor !== null && anchor.parentElement === target.strip) target.strip.insertBefore(container, anchor)
        else target.strip.insertBefore(container, target.strip.firstChild)
      }
      container.style.display = 'inline-flex'
      if (currentSession !== target.sessionId) {
        currentSession = target.sessionId
        if (unsubscribe !== null) unsubscribe()
        unsubscribe = controller.storeFor(target.sessionId).subscribe(updateButton)
      }
      updateButton()
    }
    const timer = window.setInterval(sync, 400)
    sync()
    return () => {
      window.clearInterval(timer)
      if (unsubscribe !== null) unsubscribe()
      button.removeEventListener('pointerdown', onPointerDown, true)
      button.removeEventListener('click', onClick, true)
      container.remove()
    }
  }, [controller, t])
  return null
}

export interface ComposerDockProps {
  controller: AnnotationController
  sessionId: string
  inputActions: unknown
  t: (key: string, params?: Record<string, string | number>) => string
}

/**
 * Compact row above the composer card. It is the discoverable control while a
 * batch is live and the confirmation surface after notes were inserted.
 */
export function ComposerDock({ controller, sessionId, inputActions, t }: ComposerDockProps): React.ReactElement | null {
  const rowRef = React.useRef<HTMLDivElement | null>(null)
  const state = useSessionState(controller, sessionId)
  const actions = inputActions as Parameters<AnnotationController['setInputActions']>[1]

  React.useEffect(() => {
    controller.setInputActions(sessionId, actions)
    return () => controller.setInputActions(sessionId, undefined)
  }, [controller, sessionId, actions])

  React.useEffect(() => {
    const row = rowRef.current
    if (row === null) return undefined
    const align = () => {
      try {
        const cards = Array.from(document.querySelectorAll('[data-composer-card]'))
        let card: Element | null = null
        for (const candidate of cards) {
          const rect = candidate.getBoundingClientRect()
          if (rect.width > 40 && rect.height > 20) {
            card = candidate
            break
          }
        }
        if (card === null) {
          row.style.paddingLeft = ''
          return
        }
        const cardRect = card.getBoundingClientRect()
        const rowRect = row.getBoundingClientRect()
        row.style.paddingLeft = Math.max(0, Math.round(cardRect.left - rowRect.left)) + 'px'
      } catch {
        /* alignment is cosmetic */
      }
    }
    align()
    const timer = window.setInterval(align, 700)
    window.addEventListener('resize', align)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', align)
    }
  }, [state.open, state.lastInsert])

  if (sessionId === '') return null
  const hasBatch = state.records.length > 0
  const visible = state.open || hasBatch || state.hint !== null
  if (!visible) return null

  if (!state.open && !hasBatch) {
    const hint = state.hint
    if (hint === null) return null
    return React.createElement(
      'div',
      { className: 'dsh-ann-dock-row', ref: rowRef },
      React.createElement(
        'div',
        { className: 'dsh-ann-dock' + (hint.kind === 'error' ? ' is-error' : hint.kind === 'warn' ? ' is-warn' : '') },
        React.createElement(AnnotateIcon, { size: 15 }),
        React.createElement('span', { className: 'dsh-ann-dock-text' }, hint.text),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-ann-dock-action',
            onClick: () => controller.storeFor(sessionId).set({ hint: null, lastInsert: null }),
          },
          '×',
        ),
      ),
    )
  }

  const count = state.records.length
  const paused = !state.open
  const editing = state.editorOpen
  const hintText = paused
    ? t('dock.pausedHint')
    : state.hint !== null
      ? state.hint.text
      : editing
        ? t('dock.editing')
        : t('dock.hint')
  const title = hasBatch ? fill(t('dock.count'), { count }) : t('dock.title')
  const buttons: React.ReactNode[] = []
  if (paused) {
    buttons.push(
      React.createElement(
        'button',
        {
          key: 'resume',
          type: 'button',
          className: 'dsh-ann-dock-action',
          disabled: state.busy,
          onClick: () => controller.open(sessionId).catch(() => undefined),
        },
        t('dock.resume'),
      ),
    )
  } else {
    buttons.push(
      React.createElement(
        'button',
        {
          key: 'clear',
          type: 'button',
          className: 'dsh-ann-dock-action',
          disabled: state.busy,
          onClick: () => controller.discard(sessionId).catch(() => undefined),
        },
        t('dock.cancel'),
      ),
    )
  }
  buttons.push(
    React.createElement(
      'button',
      {
        key: 'write',
        type: 'button',
        className: 'dsh-ann-dock-action is-primary',
        disabled: state.busy,
        onClick: () => controller.write(sessionId).catch(() => undefined),
      },
      t('dock.finish'),
    ),
  )
  if (paused) {
    buttons.push(
      React.createElement(
        'button',
        {
          key: 'discard',
          type: 'button',
          className: 'dsh-ann-dock-action',
          title: t('dock.cancel'),
          'aria-label': t('dock.cancel'),
          disabled: state.busy,
          onClick: () => controller.discard(sessionId).catch(() => undefined),
        },
        '×',
      ),
    )
  }

  return React.createElement(
    'div',
    { className: 'dsh-ann-dock-row', ref: rowRef },
    React.createElement(
      'div',
      { className: 'dsh-ann-dock' + (state.hint !== null && state.hint.kind !== 'info' ? ' is-warn' : '') + (paused ? ' is-paused' : '') },
      React.createElement(AnnotateIcon, { size: 15 }),
      React.createElement(
        'span',
        { className: 'dsh-ann-dock-text' },
        title,
        React.createElement('span', { className: 'dsh-ann-dock-hint' }, ' · ' + hintText),
      ),
      React.createElement('span', { className: 'dsh-ann-dock-spacer' }),
      ...buttons,
    ),
  )
}
