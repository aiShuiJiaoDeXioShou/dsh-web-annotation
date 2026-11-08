/**
 * Page-injected annotation runtime.
 *
 * `runtimeMain` is deliberately self-contained: its source (via `toString()`)
 * is turned into `executeJavaScript` source by the client, so everything it
 * needs lives inside the function body and it may only touch `window`,
 * `document` and ordinary browser globals. It installs
 * `window.__DSH_WEB_ANNOTATE__` and returns the API described in
 * `docs/REFACTOR.md`.
 *
 * Interesting bits:
 * - ChatGPT-style pause: `stop()` only pauses mode. Records and their boxes/pins
 *   stay on the page and remain clickable so a later `start()` (or a pin click)
 *   resumes editing from where the user left off.
 * - `start()` is restart-safe: it always re-creates/re-shows the overlay and
 *   capture layers, re-installs the pointer listeners and resets hover/region
 *   state. The old "open -> exit -> open" bug came from a one-shot listener
 *   guard that survived stop().
 * - The in-page bottom bar (`data-dsh-annotate="hud"`) is the ChatGPT-style
 *   action bar: write queues the one-shot `commit` action the plugin consumes,
 *   clear/exit pause the mode.
 * - Records carry full image data URLs; `status()`/`collect()` only ever expose
 *   image metadata, `collectImages()` is the only way to read the bytes.
 * - There is no screenshot/capturePage code any more.
 */
import type {
  AnnotationPayload,
  CollectedBatch,
  CollectedImages,
  RuntimeAction,
  RuntimeHudTexts,
  RuntimeImage,
  RuntimeImageMeta,
  RuntimeRecord,
  RuntimeStatus,
} from '../shared/types.js'

/**
 * Runtime protocol version. Keep the local `VERSION` literal inside
 * `runtimeMain` in sync: the injected function source cannot reference module
 * scope, so it must stay a literal there.
 */
export const RUNTIME_VERSION = 6

/** Options accepted when the runtime source is injected into the page. */
export interface RuntimeMainOptions {
  /** HUD/editor strings to preload before `start()` is called. */
  hud?: RuntimeHudTexts
}

/** The object installed as `window.__DSH_WEB_ANNOTATE__`. */
export interface RuntimeApi {
  version: number
  start(options?: { hud?: RuntimeHudTexts } | null): { ok: boolean }
  stop(): { ok: boolean }
  status(): RuntimeStatus
  pull(): RuntimeStatus
  collect(): CollectedBatch
  collectImages(): CollectedImages
  openEditor(recordId: string): { ok: boolean }
  closeEditor(mode?: 'commit' | 'cancel'): { ok: boolean; closed?: boolean; revision?: number }
  remove(recordId: string): { ok: boolean; revision?: number }
  takeAction(): RuntimeAction | null
  clear(): { ok: boolean; revision?: number }
  setVisible(visible: boolean): { ok: boolean }
  dispose(): void
}

/**
 * Install the annotation runtime in the current page.
 *
 * The returned API is also assigned to `window.__DSH_WEB_ANNOTATE__`. Calling
 * this again (after a `dispose()` or because the controller re-injected the
 * script) safely replaces the previous instance.
 */
export function runtimeMain(options?: RuntimeMainOptions | RuntimeHudTexts | null): RuntimeApi {
  'use strict'
  var KEY = '__DSH_WEB_ANNOTATE__'
  var VERSION = 6
  var Z = 2147483600
  var MAX_IMAGES = 4
  var MAX_IMAGE_BYTES = 8 * 1024 * 1024
  var ALLOWED_IMAGE_TYPES: any = {
    'image/png': true,
    'image/jpeg': true,
    'image/webp': true,
    'image/gif': true,
  }

  // Replace a previous instance in the same page, if any.
  var previous: any = null
  try { previous = (window as any)[KEY] } catch (error) { previous = null }
  if (previous !== null && previous !== undefined && typeof previous.dispose === 'function') {
    try { previous.dispose() } catch (error) { /* ignore */ }
  }
  try {
    delete (window as any)[KEY]
  } catch (error) {
    try { (window as any)[KEY] = undefined } catch (innerError) { /* ignore */ }
  }

  var state: any = {
    active: false,
    records: [],
    revision: 0,
    editor: null,
    hud: {},
    down: null,
    region: null,
    pendingAction: null,
    nextId: 0,
    nextImageId: 0,
  }
  // Optional HUD strings passed at injection time; start() may override them.
  var opts: any = options
  if (opts !== null && opts !== undefined && typeof opts === 'object') {
    if (opts.hud !== null && opts.hud !== undefined && typeof opts.hud === 'object') {
      state.hud = opts.hud
    } else if (
      typeof opts.editorPlaceholder === 'string'
      || typeof opts.editorAddImage === 'string'
      || typeof opts.editorConfirm === 'string'
    ) {
      state.hud = opts
    }
  }

  var layer: any = null
  var captureLayer: any = null
  var hoverBox: any = null
  var regionBox: any = null
  var bar: any = null
  var layerFresh = false
  var listenersInstalled = false
  var disposed = false
  var api: any = null

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function css(node: any, styles: any) {
    if (!node) return node
    for (var key in styles) {
      if (!Object.prototype.hasOwnProperty.call(styles, key)) continue
      try { node.style[key] = styles[key] } catch (error) { /* ignore */ }
    }
    return node
  }

  function makeBox(styles: any) {
    return css(document.createElement('div'), styles)
  }

  function hide(node: any) {
    if (node && node.style) node.style.display = 'none'
  }

  function connected(node: any) {
    return node !== null && node !== undefined && node.isConnected === true
  }

  function clipText(value: any, max: number) {
    var text = value === null || value === undefined ? '' : String(value)
    return text.length > max ? text.slice(0, max) + '…' : text
  }

  function escapeSelector(value: any) {
    var cssApi = (window as any).CSS
    if (cssApi && typeof cssApi.escape === 'function') return cssApi.escape(value)
    return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1')
  }

  function hudText(key: string, fallback: string) {
    var value = state.hud !== null && state.hud !== undefined ? state.hud[key] : undefined
    return typeof value === 'string' && value !== '' ? value : fallback
  }

  function findRecord(id: string) {
    var records = state.records
    for (var index = 0; index < records.length; index += 1) {
      if (records[index].id === id) return records[index]
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Page info / DOM introspection
  // ---------------------------------------------------------------------------

  function pageInfo() {
    var location = (window as any).location || {}
    var title = ''
    try { title = document.title || '' } catch (error) { title = '' }
    return { url: typeof location.href === 'string' ? location.href : '', title: title }
  }

  function selectorFor(node: any): string {
    if (!node || node.nodeType !== 1) return ''
    var parts: string[] = []
    var current = node
    for (var depth = 0; depth < 8 && current && current.nodeType === 1 && current !== document.documentElement; depth += 1) {
      var part = current.tagName ? current.tagName.toLowerCase() : ''
      if (current.id) {
        var idSelector = '#' + escapeSelector(current.id)
        try {
          if (document.querySelectorAll(idSelector).length === 1) {
            parts.unshift(idSelector)
            return parts.join(' > ')
          }
        } catch (error) { /* ignore */ }
      }
      var classes: string[] = []
      if (current.classList) {
        for (var classIndex = 0; classIndex < current.classList.length && classes.length < 2; classIndex += 1) {
          var className = current.classList[classIndex]
          if (className && className.length <= 40 && !/^[0-9]/.test(className)) classes.push(className)
        }
      }
      if (classes.length > 0) part += '.' + classes.map(escapeSelector).join('.')
      var parent = current.parentElement
      if (parent) {
        var sameTag = 0
        var position = 0
        var children = parent.children || []
        for (var childIndex = 0; childIndex < children.length; childIndex += 1) {
          var child = children[childIndex]
          if (child.tagName === current.tagName) {
            sameTag += 1
            if (child === current) position = sameTag
          }
        }
        if (sameTag > 1) part += ':nth-of-type(' + position + ')'
      }
      parts.unshift(part)
      var candidate = parts.join(' > ')
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate
      } catch (error) { /* ignore */ }
      current = parent
    }
    return parts.join(' > ')
  }

  function labelFor(node: any) {
    var text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.length > 0) return '「' + clipText(text, 40) + '」'
    var aria = node.getAttribute ? node.getAttribute('aria-label') : ''
    if (aria) return clipText(aria, 60)
    var testId = node.getAttribute ? node.getAttribute('data-testid') : ''
    if (testId) return testId
    var tag = node.tagName ? node.tagName.toLowerCase() : ''
    return node.id ? tag + '#' + node.id : tag
  }

  function stylesFor(node: any) {
    var result: Record<string, string> = {}
    var keys = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'margin', 'border', 'borderRadius', 'display', 'gap', 'textAlign', 'opacity', 'width', 'height']
    var computed: any = null
    try { computed = (window as any).getComputedStyle(node) } catch (error) { return result }
    if (!computed) return result
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index]
      var value = computed[key]
      if (typeof value === 'string' && value !== '') result[key] = clipText(value, 100)
    }
    return result
  }

  function elementAt(x: number, y: number): any {
    var node: any = null
    var captureWas: any = null
    if (captureLayer !== null && captureLayer.style && captureLayer.style.pointerEvents !== 'none') {
      captureWas = captureLayer.style.pointerEvents
      captureLayer.style.pointerEvents = 'none'
    }
    try {
      node = document.elementFromPoint(x, y)
    } catch (error) {
      node = null
    } finally {
      if (captureWas !== null && captureLayer !== null && captureLayer.style) captureLayer.style.pointerEvents = captureWas
    }
    if (node === null || node === undefined) return null
    while (node && node.nodeType === 1) {
      if (node.hasAttribute && node.hasAttribute('data-dsh-annotate')) {
        node = node.parentElement
        continue
      }
      if (node === document.documentElement || node === document.body) return null
      var rect = node.getBoundingClientRect()
      if (rect.width >= 4 && rect.height >= 4) return node
      node = node.parentElement
    }
    return null
  }

  function payloadForElement(node: any): AnnotationPayload {
    var rect = node.getBoundingClientRect()
    var info = pageInfo()
    var classes = ''
    try { classes = node.getAttribute('class') || '' } catch (error) { classes = '' }
    var html = ''
    try { html = clipText(node.outerHTML, 800) } catch (error) { html = '' }
    var tag = node.tagName ? node.tagName.toLowerCase() : ''
    return {
      kind: 'element',
      selector: selectorFor(node),
      label: labelFor(node),
      tag: tag,
      text: clipText((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(), 120),
      html: html,
      hints: {
        id: node.id || '',
        classes: clipText(classes, 120),
        testId: node.getAttribute ? node.getAttribute('data-testid') || '' : '',
        ariaLabel: node.getAttribute ? node.getAttribute('aria-label') || '' : '',
        role: node.getAttribute ? node.getAttribute('role') || '' : '',
      },
      styles: stylesFor(node),
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      docRect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
      url: info.url,
      title: info.title,
    }
  }

  function elementsInRect(rect: any) {
    var found: any[] = []
    var seen: any = {}
    var columns = 5
    var rows = 4
    for (var column = 0; column < columns; column += 1) {
      for (var row = 0; row < rows; row += 1) {
        var x = rect.x + rect.width * (column + 0.5) / columns
        var y = rect.y + rect.height * (row + 0.5) / rows
        var node = elementAt(x, y)
        if (!node) continue
        var selector = selectorFor(node)
        if (!selector || seen[selector]) continue
        seen[selector] = true
        var nodeRect = node.getBoundingClientRect()
        found.push({
          selector: selector,
          label: labelFor(node),
          tag: node.tagName ? node.tagName.toLowerCase() : '',
          text: clipText((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(), 80),
          rect: { x: nodeRect.left, y: nodeRect.top, width: nodeRect.width, height: nodeRect.height },
        })
        if (found.length >= 8) return found
      }
    }
    return found
  }

  function payloadForRegion(rect: any): AnnotationPayload {
    var info = pageInfo()
    var elements = elementsInRect(rect)
    return {
      kind: 'region',
      selector: elements.length > 0 ? elements[0].selector : '',
      label: formatRegionRect(rect),
      tag: '',
      text: '',
      html: '',
      hints: {},
      styles: {},
      rect: rect,
      docRect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
      elements: elements,
      url: info.url,
      title: info.title,
    }
  }

  function isAnnotatableElement(node: any) {
    if (!node || node.nodeType !== 1) return false
    var tag = node.tagName ? node.tagName.toLowerCase() : ''
    if (tag === 'html' || tag === 'body') return false
    var rect = node.getBoundingClientRect()
    if (rect.width < 4 || rect.height < 4) return false
    var role = node.getAttribute ? node.getAttribute('role') : null
    var interactive = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea'
      || tag === 'select' || tag === 'label' || tag === 'summary' || tag === 'img'
      || role !== null
      || (node.hasAttribute ? node.hasAttribute('data-testid') === true : false)
    if (interactive === true) return true
    var wide = rect.width >= window.innerWidth * 0.6
    var tall = rect.height >= window.innerHeight * 0.9
    if (wide === true && tall === true) return false
    return true
  }

  function updateHover(x: number, y: number) {
    if (!state.active || state.editor || state.down || state.region) return
    var node = elementAt(x, y)
    if (!node || isAnnotatableElement(node) !== true) {
      hide(hoverBox)
      return
    }
    var rect = node.getBoundingClientRect()
    place(hoverBox, rect.left + window.scrollX, rect.top + window.scrollY, rect.width, rect.height)
  }

  function payloadForPoint(x: number, y: number): AnnotationPayload {
    var info = pageInfo()
    return {
      kind: 'element',
      selector: '',
      label: '「点击位置」',
      tag: '',
      text: '',
      html: '',
      hints: {},
      styles: {},
      rect: { x: x, y: y, width: 0, height: 0 },
      docRect: { x: x + window.scrollX, y: y + window.scrollY, width: 0, height: 0 },
      url: info.url,
      title: info.title,
    }
  }

  // ---------------------------------------------------------------------------
  // Overlay layers
  // ---------------------------------------------------------------------------

  function resetRecordNodes() {
    for (var index = 0; index < state.records.length; index += 1) {
      var record = state.records[index]
      record.boxEl = null
      record.pinEl = null
    }
  }

  function ensureLayer() {
    if (connected(layer) && connected(captureLayer)) return layer
    var stale = layer
    layer = null
    captureLayer = null
    hoverBox = null
    regionBox = null
    bar = null
    resetRecordNodes()
    if (stale) {
      try { stale.remove() } catch (error) { /* ignore */ }
    }
    layer = document.createElement('div')
    layer.setAttribute('data-dsh-annotate', 'layer')
    css(layer, {
      position: 'absolute', left: '0', top: '0', width: '0', height: '0',
      overflow: 'visible', pointerEvents: 'none', zIndex: String(Z), display: 'none',
    })
    var mount: any = document.documentElement || document.body || null
    if (mount) mount.appendChild(layer)
    captureLayer = makeBox({
      position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
      background: 'transparent', pointerEvents: 'auto', cursor: 'crosshair',
      zIndex: '0',
    })
    captureLayer.setAttribute('data-dsh-annotate', 'capture')
    layer.appendChild(captureLayer)
    hoverBox = makeBox({
      position: 'absolute', display: 'none', border: '2px solid #3b82f6',
      backgroundColor: 'rgba(59,130,246,0.14)', borderRadius: '3px',
      boxSizing: 'border-box', pointerEvents: 'none', zIndex: '1',
    })
    hoverBox.setAttribute('data-dsh-annotate', 'hover')
    regionBox = makeBox({
      position: 'absolute', display: 'none', border: '1.5px dashed #2563eb',
      backgroundColor: 'rgba(37,99,235,0.10)', borderRadius: '2px',
      boxSizing: 'border-box', pointerEvents: 'none', zIndex: '1',
    })
    regionBox.setAttribute('data-dsh-annotate', 'region')
    layer.appendChild(hoverBox)
    layer.appendChild(regionBox)
    layerFresh = true
    return layer
  }

  function armLayer() {
    ensureLayer()
    if (layerFresh) {
      redrawRecords()
      layerFresh = false
    }
    if (layer) layer.style.display = 'block'
    if (captureLayer) {
      captureLayer.style.display = 'block'
      captureLayer.style.pointerEvents = 'auto'
      captureLayer.style.cursor = 'crosshair'
    }
    hide(hoverBox)
    hide(regionBox)
  }

  // ---------------------------------------------------------------------------
  // In-page bottom action bar (ChatGPT-style)
  // ---------------------------------------------------------------------------

  function isBarTarget(target: any) {
    var node = target
    while (node) {
      if (node.hasAttribute && node.getAttribute('data-dsh-annotate') === 'hud') return true
      if (node === document.documentElement || node === document.body) return false
      node = node.parentElement
    }
    return false
  }

  function barTitleText() {
    return hudText('barTitle', '{count}').replace(/\{count\}/g, String(state.records.length))
  }

  function barButton(attr: string, label: string, aria: string) {
    var button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-dsh-annotate', attr)
    button.textContent = label
    if (aria !== '') {
      button.setAttribute('aria-label', aria)
      button.title = aria
    }
    css(button, {
      border: '0', background: 'transparent', color: 'rgba(255,255,255,0.86)',
      font: 'inherit', fontSize: '12px', cursor: 'pointer', borderRadius: '999px',
      padding: '5px 8px', lineHeight: '1', flex: 'none',
    })
    button.addEventListener('pointerdown', function (event: any) {
      try { event.stopPropagation() } catch (error) { /* ignore */ }
    })
    return button
  }

  function ensureBar() {
    if (bar !== null && bar.el && connected(bar.el)) return bar
    ensureLayer()
    if (layerFresh) {
      redrawRecords()
      layerFresh = false
    }
    if (bar !== null && bar.el && connected(bar.el)) return bar
    var el = makeBox({
      position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)',
      display: 'none', alignItems: 'center', gap: '6px', padding: '6px 8px 6px 14px',
      background: 'rgba(27,29,34,0.94)', color: '#ffffff', borderRadius: '999px',
      boxShadow: '0 8px 24px rgba(15,23,42,0.32)', boxSizing: 'border-box',
      maxWidth: 'calc(100vw - 24px)', pointerEvents: 'auto', zIndex: '4',
      font: '500 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    })
    el.setAttribute('data-dsh-annotate', 'hud')
    var title = document.createElement('span')
    title.setAttribute('data-dsh-annotate', 'hud-title')
    css(title, { whiteSpace: 'nowrap', color: 'rgba(255,255,255,0.92)', flex: 'none' })

    var clearButton = barButton('hud-clear', hudText('barClear', 'Clear'), hudText('barClear', 'Clear'))
    var writeButton = barButton('hud-write', hudText('barWrite', 'Insert'), hudText('barWrite', 'Insert'))
    var exitButton = barButton('hud-exit', '×', hudText('barExit', 'Exit'))
    css(writeButton, {
      background: '#2563eb', color: '#ffffff', padding: '5px 12px', marginLeft: '2px',
    })
    css(exitButton, { fontSize: '16px', padding: '3px 7px', color: 'rgba(255,255,255,0.72)' })

    clearButton.addEventListener('click', function (event: any) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      barClear()
    })
    writeButton.addEventListener('click', function (event: any) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      barWrite()
    })
    exitButton.addEventListener('click', function (event: any) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      barExit()
    })

    el.appendChild(title)
    el.appendChild(clearButton)
    el.appendChild(writeButton)
    el.appendChild(exitButton)
    layer.appendChild(el)
    bar = {
      el: el,
      title: title,
      clearButton: clearButton,
      writeButton: writeButton,
      exitButton: exitButton,
    }
    return bar
  }

  function setBarBusy(current: any, busy: boolean) {
    if (current === null || current === undefined) return
    var buttons = [current.clearButton, current.writeButton, current.exitButton]
    for (var index = 0; index < buttons.length; index += 1) {
      if (buttons[index]) buttons[index].disabled = busy
    }
    if (current.writeButton) {
      current.writeButton.textContent = busy ? hudText('barWriting', 'Writing…') : hudText('barWrite', 'Insert')
      current.writeButton.style.opacity = busy ? '0.72' : '1'
    }
  }

  function syncBar() {
    var current = ensureBar()
    current.title.textContent = barTitleText()
    current.el.style.display = state.active === true ? 'flex' : 'none'
    setBarBusy(current, state.pendingAction !== null)
    return current
  }

  function hideBar() {
    if (bar !== null && bar.el) bar.el.style.display = 'none'
  }

  function barWrite() {
    if (state.active !== true) return
    state.pendingAction = 'commit'
    state.revision += 1
    syncBar()
  }

  function barClear() {
    if (state.active !== true) return
    state.pendingAction = null
    clearRecords()
    stopMode()
  }

  function barExit() {
    if (state.active !== true) return
    state.pendingAction = null
    stopMode()
  }

  function takeAction(): RuntimeAction | null {
    var action = state.pendingAction
    state.pendingAction = null
    if (action !== null) {
      state.revision += 1
      if (bar !== null && bar.el && connected(bar.el)) setBarBusy(bar, false)
    }
    return action
  }

  function place(node: any, x: number, y: number, width: number, height: number) {
    css(node, {
      display: 'block',
      left: Math.round(x) + 'px',
      top: Math.round(y) + 'px',
      width: Math.max(1, Math.round(width)) + 'px',
      height: Math.max(1, Math.round(height)) + 'px',
    })
  }

  function formatRegionRect(rect: any) {
    if (!rect) return ''
    return Math.round(rect.width) + '×' + Math.round(rect.height)
  }

  function recordLabel(record: any) {
    if (record.kind === 'region') return formatRegionRect(record.payload.docRect || record.payload.rect)
    return record.payload.label || record.payload.tag || ''
  }

  function renumber() {
    for (var index = 0; index < state.records.length; index += 1) {
      var record = state.records[index]
      record.index = index + 1
      if (record.pinEl) record.pinEl.textContent = String(record.index)
    }
  }

  function drawRecord(record: any) {
    ensureLayer()
    var payload = record.payload || {}
    var rect = payload.docRect
    if (!rect && payload.rect) {
      rect = {
        x: payload.rect.x + window.scrollX,
        y: payload.rect.y + window.scrollY,
        width: payload.rect.width,
        height: payload.rect.height,
      }
    }
    if (!rect) return
    if (record.boxEl && !connected(record.boxEl)) record.boxEl = null
    if (record.pinEl && !connected(record.pinEl)) record.pinEl = null
    var hasSize = rect.width > 0 && rect.height > 0
    if (hasSize && record.boxEl === null) {
      var boxEl = makeBox({
        position: 'absolute', border: '2px solid rgba(37,99,235,0.9)',
        backgroundColor: 'rgba(37,99,235,0.10)', borderRadius: '3px',
        boxSizing: 'border-box', display: 'block', pointerEvents: 'none', zIndex: '1',
      })
      place(boxEl, rect.x, rect.y, rect.width, rect.height)
      boxEl.setAttribute('data-dsh-annotate', 'record')
      layer.appendChild(boxEl)
      record.boxEl = boxEl
    }
    if (record.pinEl === null) {
      var pinEl = makeBox({
        position: 'absolute', width: '28px', height: '28px', borderRadius: '14px',
        background: '#2563eb', color: '#ffffff', border: '2px solid #ffffff',
        boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
        font: '600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        boxShadow: '0 2px 6px rgba(15,23,42,0.35)', pointerEvents: 'auto', cursor: 'pointer',
        transform: 'translate(-50%,-50%)', zIndex: '2',
      })
      pinEl.setAttribute('data-dsh-annotate', 'pin')
      pinEl.setAttribute('data-dsh-annotate-id', record.id)
      pinEl.textContent = String(record.index)
      css(pinEl, { left: Math.round(rect.x) + 'px', top: Math.round(rect.y) + 'px' })
      layer.appendChild(pinEl)
      record.pinEl = pinEl
    }
  }

  function redrawRecords() {
    for (var index = 0; index < state.records.length; index += 1) {
      var record = state.records[index]
      if (record.boxEl) { try { record.boxEl.remove() } catch (error) { /* ignore */ } }
      if (record.pinEl) { try { record.pinEl.remove() } catch (error) { /* ignore */ } }
      record.boxEl = null
      record.pinEl = null
      drawRecord(record)
    }
  }

  // ---------------------------------------------------------------------------
  // Record lifecycle
  // ---------------------------------------------------------------------------

  function removeRecordInternal(record: any) {
    if (record.boxEl) {
      try { record.boxEl.remove() } catch (error) { /* ignore */ }
    }
    if (record.pinEl) {
      try { record.pinEl.remove() } catch (error) { /* ignore */ }
    }
    state.records = state.records.filter(function (entry: any) { return entry !== record })
    renumber()
    state.revision += 1
    if (bar !== null && bar.el && connected(bar.el)) syncBar()
  }

  function removeRecord(id: any) {
    var recordId = String(id)
    var record = findRecord(recordId)
    if (record === null) return { ok: false }
    if (state.editor !== null && state.editor.recordId === recordId) closeEditor('cancel')
    if (findRecord(recordId) === record) removeRecordInternal(record)
    return { ok: true, revision: state.revision }
  }

  function clearRecords() {
    if (state.editor !== null) closeEditor('cancel')
    for (var index = 0; index < state.records.length; index += 1) {
      var record = state.records[index]
      if (record.boxEl) {
        try { record.boxEl.remove() } catch (error) { /* ignore */ }
      }
      if (record.pinEl) {
        try { record.pinEl.remove() } catch (error) { /* ignore */ }
      }
    }
    state.records = []
    state.pendingAction = null
    state.revision += 1
    if (bar !== null && bar.el && connected(bar.el)) syncBar()
    // Nothing left to draw: hide the whole overlay, even if the plugin has not
    // called stop() yet. start() re-shows it on the next open.
    if (state.records.length === 0) {
      hide(hoverBox)
      hide(regionBox)
      hideBar()
      if (captureLayer) {
        captureLayer.style.pointerEvents = 'none'
        captureLayer.style.display = 'none'
      }
      if (layer) layer.style.display = 'none'
    }
    return { ok: true, revision: state.revision }
  }

  function isPinTarget(target: any) {
    var node = target
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.hasAttribute) {
        if (node.getAttribute('data-dsh-annotate') === 'pin') return node
        if (node.getAttribute('data-dsh-annotate') === 'layer') return null
      }
      node = node.parentElement
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Image attachments
  // ---------------------------------------------------------------------------

  function imageCtor() {
    try {
      if (window && typeof (window as any).Image === 'function') return (window as any).Image
    } catch (error) { /* ignore */ }
    if (typeof Image !== 'undefined') return Image
    return null
  }

  function readerCtor() {
    try {
      if (window && typeof (window as any).FileReader === 'function') return (window as any).FileReader
    } catch (error) { /* ignore */ }
    if (typeof FileReader !== 'undefined') return FileReader
    return null
  }

  function imageTypeOf(file: any) {
    var declared = file && file.type ? String(file.type).toLowerCase() : ''
    if (declared !== '') return ALLOWED_IMAGE_TYPES[declared] === true ? declared : ''
    var name = file && file.name ? String(file.name).toLowerCase() : ''
    var match = /\.(png|jpe?g|webp|gif)$/.exec(name)
    if (!match) return ''
    var extension = match[1]
    if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
    return 'image/' + extension
  }

  function readViaArrayBuffer(file: any, type: string, done: any) {
    if (!file || typeof file.arrayBuffer !== 'function' || typeof btoa !== 'function') {
      done(null)
      return
    }
    try {
      file.arrayBuffer().then(function (buffer: any) {
        try {
          var bytes = new Uint8Array(buffer)
          var binary = ''
          for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
          done('data:' + type + ';base64,' + btoa(binary))
        } catch (error) {
          done(null)
        }
      }).catch(function () { done(null) })
    } catch (error) {
      done(null)
    }
  }

  function readImageFile(file: any, type: string, done: any) {
    var finished = false
    function complete(value: any) {
      if (finished) return
      finished = true
      done(typeof value === 'string' && value.length > 0 ? value : null)
    }
    var Reader = readerCtor()
    if (Reader) {
      var started = false
      try {
        var reader = new Reader()
        reader.onload = function () {
          var result = reader.result
          if (typeof result === 'string' && result.length > 0) complete(result)
          else readViaArrayBuffer(file, type, complete)
        }
        reader.onerror = function () { readViaArrayBuffer(file, type, complete) }
        reader.readAsDataURL(file)
        started = true
      } catch (error) {
        started = false
      }
      if (started) return
    }
    readViaArrayBuffer(file, type, complete)
  }

  function probeImageSize(image: any) {
    var Ctor = imageCtor()
    if (!Ctor) return
    try {
      var probe = new Ctor()
      probe.onload = function () {
        var width = probe.naturalWidth || probe.width || 0
        var height = probe.naturalHeight || probe.height || 0
        if (width > 0) image.width = width
        if (height > 0) image.height = height
        state.revision += 1
      }
      probe.onerror = function () { /* dimensions stay unknown */ }
      probe.src = image.dataUrl
    } catch (error) { /* ignore */ }
  }

  function renderEditorImages() {
    var editorState = state.editor
    if (editorState === null) return
    var record = findRecord(editorState.recordId)
    if (record === null) return
    var row = editorState.imagesRow
    if (!row) return
    for (var index = row.children.length - 1; index >= 0; index -= 1) {
      try { row.children[index].remove() } catch (error) { /* ignore */ }
    }
    if (record.images.length === 0) {
      row.style.display = 'none'
      return
    }
    row.style.display = 'flex'
    for (var imageIndex = 0; imageIndex < record.images.length; imageIndex += 1) {
      appendThumbnail(row, record, record.images[imageIndex])
    }
  }

  function appendThumbnail(row: any, record: any, image: any) {
    var thumb = makeBox({
      position: 'relative', display: 'inline-flex', width: '32px', height: '32px',
      flex: 'none', borderRadius: '4px', overflow: 'visible',
    })
    var img = document.createElement('img')
    img.setAttribute('data-dsh-annotate', 'editor-image')
    img.setAttribute('alt', '')
    img.setAttribute('src', image.dataUrl)
    img.src = image.dataUrl
    css(img, {
      display: 'block', width: '32px', height: '32px', objectFit: 'cover',
      borderRadius: '4px', border: '1px solid rgba(15,23,42,0.14)', boxSizing: 'border-box',
      pointerEvents: 'none',
    })
    var removeButton = document.createElement('button')
    removeButton.type = 'button'
    removeButton.setAttribute('data-dsh-annotate', 'editor-image-remove')
    removeButton.setAttribute('data-dsh-annotate-image-id', image.id)
    removeButton.setAttribute('aria-label', hudText('editorImageRemove', 'Remove image'))
    removeButton.title = hudText('editorImageRemove', 'Remove image')
    removeButton.textContent = '×'
    css(removeButton, {
      position: 'absolute', top: '-5px', right: '-5px', width: '16px', height: '16px',
      padding: '0', border: '0', borderRadius: '8px', background: '#1b1d22',
      color: '#ffffff', font: '600 11px/1 sans-serif', cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1',
    })
    removeButton.addEventListener('pointerdown', function (event: any) {
      try { event.stopPropagation() } catch (error) { /* ignore */ }
    })
    removeButton.addEventListener('click', function (event: any) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      removeImage(record, image.id)
    })
    thumb.appendChild(img)
    thumb.appendChild(removeButton)
    row.appendChild(thumb)
  }

  function removeImage(record: any, imageId: string) {
    var next: any[] = []
    for (var index = 0; index < record.images.length; index += 1) {
      if (record.images[index].id !== imageId) next.push(record.images[index])
    }
    record.images = next
    state.revision += 1
    renderEditorImages()
  }

  function showImageError(record: any, message: string) {
    var editorState = state.editor
    if (editorState === null || editorState.recordId !== record.id) return
    if (!editorState.errorEl) return
    editorState.errorEl.textContent = message
    editorState.errorEl.style.display = 'block'
  }

  function queueImageFile(record: any, file: any) {
    if (!record || !file) return
    if (findRecord(record.id) !== record) return
    var type = imageTypeOf(file)
    if (type === '') {
      showImageError(record, hudText('editorImageUnsupported', 'Unsupported image type'))
      return
    }
    if (typeof file.size === 'number' && file.size > MAX_IMAGE_BYTES) {
      showImageError(record, hudText('editorImageTooLarge', 'Image is too large'))
      return
    }
    if (record.images.length + record.pending >= MAX_IMAGES) {
      showImageError(record, hudText('editorImageLimit', 'Too many images'))
      return
    }
    record.pending += 1
    var name = file.name ? String(file.name) : 'image'
    readImageFile(file, type, function (dataUrl: any) {
      record.pending -= 1
      if (findRecord(record.id) !== record) return
      if (dataUrl === null || dataUrl === undefined || dataUrl === '') {
        showImageError(record, hudText('editorImageUnsupported', 'Unsupported image type'))
        return
      }
      state.nextImageId += 1
      var image = { id: 'img' + state.nextImageId, name: name, dataUrl: String(dataUrl) }
      record.images.push(image)
      state.revision += 1
      probeImageSize(image)
      renderEditorImages()
    })
  }

  function queueImageFiles(record: any, files: any) {
    if (!record || !files) return
    for (var index = 0; index < files.length; index += 1) {
      var file = files[index]
      if (file) queueImageFile(record, file)
    }
  }

  function clipboardImageFiles(event: any) {
    var files: any[] = []
    var clipboard = event ? event.clipboardData : null
    if (!clipboard) return files
    var items = clipboard.items
    if (items && typeof items.length === 'number') {
      for (var index = 0; index < items.length; index += 1) {
        var item = items[index]
        if (!item) continue
        if (item.kind !== undefined && item.kind !== 'file') continue
        if (item.type && String(item.type).indexOf('image/') !== 0) continue
        if (typeof item.getAsFile !== 'function') continue
        var file = item.getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length === 0 && clipboard.files && typeof clipboard.files.length === 'number') {
      for (var fileIndex = 0; fileIndex < clipboard.files.length; fileIndex += 1) {
        if (clipboard.files[fileIndex]) files.push(clipboard.files[fileIndex])
      }
    }
    return files
  }

  // ---------------------------------------------------------------------------
  // Inline editor
  // ---------------------------------------------------------------------------

  function autoGrow(textarea: any) {
    try {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(150, Math.max(30, textarea.scrollHeight)) + 'px'
    } catch (error) { /* ignore */ }
  }

  function positionEditor(editor: any, record: any) {
    var rect = record.payload.docRect || { x: window.scrollX + 40, y: window.scrollY + 40, width: 0, height: 0 }
    var viewportLeft = window.scrollX
    var viewportTop = window.scrollY
    var maxLeft = viewportLeft + window.innerWidth - (editor.offsetWidth || 260) - 8
    var maxTop = viewportTop + window.innerHeight - (editor.offsetHeight || 90) - 8
    var left = rect.x + 18
    if (left > maxLeft) left = Math.max(viewportLeft + 8, rect.x - (editor.offsetWidth || 260) - 18)
    var top = rect.y - 12
    if (top < viewportTop + 8) top = rect.y + Math.max(rect.height, 18) + 12
    if (top > maxTop) top = Math.max(viewportTop + 8, maxTop)
    css(editor, { left: Math.round(left) + 'px', top: Math.round(top) + 'px' })
  }

  function openEditor(record: any) {
    if (!record) return { ok: false }
    if (state.editor !== null) {
      if (state.editor.recordId === record.id) {
        try { state.editor.textarea.focus({ preventScroll: true }) } catch (error) { /* ignore */ }
        return { ok: true }
      }
      closeEditor('commit')
    }
    ensureLayer()
    if (layerFresh) {
      redrawRecords()
      layerFresh = false
    }
    var rect = record.payload.docRect || {}
    if (rect.y !== undefined) {
      var visibleTop = window.scrollY
      var visibleBottom = window.scrollY + window.innerHeight
      if (rect.y < visibleTop + 24 || rect.y > visibleBottom - 120) {
        try { window.scrollTo(window.scrollX, Math.max(0, rect.y - window.innerHeight / 3)) } catch (error) { /* ignore */ }
      }
    }
    var editor = makeBox({
      position: 'absolute', display: 'block', width: '260px', maxWidth: 'calc(100vw - 24px)',
      background: '#ffffff', color: '#1b1d22', border: '1px solid rgba(15,23,42,0.14)',
      borderRadius: '10px', boxShadow: '0 10px 28px rgba(15,23,42,0.22)',
      padding: '8px 10px', boxSizing: 'border-box',
      font: '13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif',
      pointerEvents: 'auto', zIndex: '3', textAlign: 'left',
    })
    editor.setAttribute('data-dsh-annotate', 'editor')
    var textarea = document.createElement('textarea')
    textarea.setAttribute('data-dsh-annotate', 'editor-input')
    textarea.value = record.comment || ''
    textarea.placeholder = hudText('editorPlaceholder', '')
    css(textarea, {
      display: 'block', width: '100%', minHeight: '30px', maxHeight: '150px',
      border: '0', outline: 'none', resize: 'none', padding: '0', margin: '0',
      background: 'transparent', color: 'inherit', font: 'inherit', lineHeight: '1.5',
      overflowY: 'auto', boxSizing: 'border-box',
    })

    var imagesRow = makeBox({
      display: 'none', flexWrap: 'wrap', alignItems: 'center', gap: '6px',
      marginTop: '6px',
    })
    imagesRow.setAttribute('data-dsh-annotate', 'editor-images')

    var errorEl = makeBox({
      display: 'none', marginTop: '4px', color: '#dc2626',
      font: '11px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      wordBreak: 'break-word',
    })
    errorEl.setAttribute('data-dsh-annotate', 'editor-error')

    var footer = makeBox({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '4px' })

    var addImageButton = document.createElement('button')
    addImageButton.type = 'button'
    addImageButton.setAttribute('data-dsh-annotate', 'editor-add-image')
    addImageButton.setAttribute('aria-label', hudText('editorAddImage', 'Add image'))
    addImageButton.title = hudText('editorAddImage', 'Add image')
    css(addImageButton, {
      flex: 'none', width: '24px', height: '24px', padding: '0', border: '0',
      borderRadius: '12px', background: 'transparent', color: '#6b7280',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    })
    addImageButton.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

    var fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.setAttribute('data-dsh-annotate', 'editor-file')
    fileInput.setAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif')
    fileInput.setAttribute('multiple', 'multiple')
    fileInput.multiple = true
    fileInput.accept = 'image/png,image/jpeg,image/webp,image/gif'
    css(fileInput, { display: 'none' })

    var spacer = makeBox({ flex: '1 1 auto' })

    var confirmButton = document.createElement('button')
    confirmButton.type = 'button'
    confirmButton.setAttribute('data-dsh-annotate', 'editor-confirm')
    confirmButton.title = hudText('editorConfirm', 'save')
    confirmButton.setAttribute('aria-label', hudText('editorConfirm', 'save'))
    css(confirmButton, {
      flex: 'none', width: '24px', height: '24px', padding: '0', border: '0',
      borderRadius: '12px', background: 'transparent', color: '#2563eb',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    })
    confirmButton.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5 L10 17.5 L19 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    confirmButton.addEventListener('pointerdown', function (event: any) {
      try { event.stopPropagation() } catch (error) { /* ignore */ }
    })
    confirmButton.addEventListener('click', function (event: any) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      closeEditor('commit')
    })

    var deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.setAttribute('data-dsh-annotate', 'editor-delete')
    deleteButton.title = hudText('editorDelete', 'delete')
    deleteButton.setAttribute('aria-label', hudText('editorDelete', 'delete'))
    css(deleteButton, {
      flex: 'none', width: '24px', height: '24px', padding: '0', border: '0',
      borderRadius: '12px', background: 'transparent', color: '#9ca3af',
      cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    })
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    deleteButton.addEventListener('pointerdown', function (event: any) {
      try { event.stopPropagation() } catch (error) { /* ignore */ }
    })
    deleteButton.addEventListener('click', function (event: any) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      deleteFromEditor()
    })

    footer.appendChild(addImageButton)
    footer.appendChild(spacer)
    footer.appendChild(confirmButton)
    footer.appendChild(deleteButton)
    editor.appendChild(textarea)
    editor.appendChild(imagesRow)
    editor.appendChild(errorEl)
    editor.appendChild(footer)
    editor.appendChild(fileInput)
    layer.appendChild(editor)

    textarea.addEventListener('input', function () { autoGrow(textarea) })
    textarea.addEventListener('keydown', function (event: any) {
      if (event.isComposing === true) return
      if (event.key === 'Enter' && event.shiftKey !== true) {
        try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
        closeEditor('commit')
        return
      }
      if (event.key === 'Escape') {
        try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
        closeEditor('cancel')
      }
    })
    textarea.addEventListener('paste', function (event: any) {
      var files = clipboardImageFiles(event)
      if (files.length === 0) return
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      queueImageFiles(record, files)
    })

    addImageButton.addEventListener('pointerdown', function (event: any) {
      try { event.stopPropagation() } catch (error) { /* ignore */ }
    })
    addImageButton.addEventListener('click', function (event: any) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      try { fileInput.click() } catch (error) { /* ignore */ }
    })
    fileInput.addEventListener('change', function (event: any) {
      var input = event && event.target ? event.target : fileInput
      var files = input && input.files ? input.files : []
      queueImageFiles(record, files)
      try { input.value = '' } catch (error) { /* ignore */ }
    })
    editor.addEventListener('pointerdown', function (event: any) {
      try { event.stopPropagation() } catch (error) { /* ignore */ }
    })

    state.editor = {
      recordId: record.id,
      el: editor,
      textarea: textarea,
      imagesRow: imagesRow,
      errorEl: errorEl,
      fileInput: fileInput,
    }
    record.editing = true
    hide(hoverBox)
    positionEditor(editor, record)
    autoGrow(textarea)
    renderEditorImages()
    try {
      textarea.focus({ preventScroll: true })
      var length = textarea.value.length
      textarea.setSelectionRange(length, length)
    } catch (error) { /* ignore */ }
    return { ok: true }
  }

  function openEditorById(id: any) {
    var record = findRecord(String(id))
    if (record === null) return { ok: false }
    return openEditor(record)
  }

  function closeEditor(mode?: 'commit' | 'cancel') {
    var editorState = state.editor
    if (editorState === null) return { ok: true, closed: false }
    var record = findRecord(editorState.recordId)
    var value = ''
    try { value = String(editorState.textarea.value || '').trim() } catch (error) { value = '' }
    try { editorState.el.remove() } catch (error) { /* ignore */ }
    state.editor = null
    if (record !== null) {
      record.editing = false
      var action = mode === undefined || mode === null ? 'commit' : mode
      var hasImages = record.images.length > 0 || record.pending > 0
      if (action === 'commit') {
        if (value !== '') {
          record.comment = value
          record.draft = false
        } else if (record.draft === true) {
          if (hasImages) {
            record.comment = ''
            record.draft = false
          } else {
            removeRecordInternal(record)
          }
        }
      } else if (record.draft === true) {
        if (hasImages) record.draft = false
        else removeRecordInternal(record)
      }
    }
    state.revision += 1
    return { ok: true, closed: true, revision: state.revision }
  }

  function deleteFromEditor() {
    var editorState = state.editor
    if (editorState === null) return { ok: false }
    var record = findRecord(editorState.recordId)
    try { editorState.el.remove() } catch (error) { /* ignore */ }
    state.editor = null
    if (record !== null) {
      record.editing = false
      removeRecordInternal(record)
    } else {
      state.revision += 1
    }
    return { ok: true }
  }

  // ---------------------------------------------------------------------------
  // Gestures
  // ---------------------------------------------------------------------------

  function createAnnotation(payload: AnnotationPayload) {
    state.nextId += 1
    var record = {
      id: 'a' + state.nextId,
      index: state.records.length + 1,
      kind: payload.kind,
      payload: payload,
      comment: '',
      images: [],
      pending: 0,
      draft: true,
      editing: false,
      boxEl: null,
      pinEl: null,
    }
    state.records.push(record)
    drawRecord(record)
    state.revision += 1
    hide(hoverBox)
    openEditor(record)
    syncBar()
    return { ok: true, id: record.id, revision: state.revision }
  }

  function finishRegionAt(event: any) {
    var region = state.region
    if (!region) return null
    var left = Math.min(region.startX, event.clientX)
    var top = Math.min(region.startY, event.clientY)
    var width = Math.abs(event.clientX - region.startX)
    var height = Math.abs(event.clientY - region.startY)
    if (width < 8 || height < 8) return null
    return { x: left, y: top, width: width, height: height }
  }

  function onPointerDown(event: any) {
    if (isBarTarget(event.target)) return
    if (event.button !== undefined && event.button !== 0 && event.pointerType !== 'touch') return
    // An open editor is committed on any outside pointerdown, even while paused.
    if (state.editor !== null) {
      var inside = false
      try { inside = state.editor.el.contains(event.target) } catch (error) { inside = false }
      if (!inside) {
        try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
        closeEditor('commit')
      }
      return
    }
    if (!state.active) return
    if (isPinTarget(event.target) !== null) return
    state.down = { x: event.clientX, y: event.clientY }
    state.region = null
    try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
  }

  function onPointerMove(event: any) {
    if (!state.active) return
    if (state.editor !== null) return
    if (state.down !== null && state.region === null) {
      var dx = event.clientX - state.down.x
      var dy = event.clientY - state.down.y
      if (dx * dx + dy * dy > 36) {
        state.region = { startX: state.down.x, startY: state.down.y, x: event.clientX, y: event.clientY }
      }
    }
    if (state.region !== null) {
      var region = state.region
      var left = Math.min(region.startX, event.clientX)
      var top = Math.min(region.startY, event.clientY)
      place(regionBox, left + window.scrollX, top + window.scrollY,
        Math.abs(event.clientX - region.startX), Math.abs(event.clientY - region.startY))
      hide(hoverBox)
      return
    }
    if (state.down !== null) {
      hide(hoverBox)
      return
    }
    updateHover(event.clientX, event.clientY)
  }

  function onPointerUp(event: any) {
    if (isBarTarget(event.target)) return
    if (event.button !== undefined && event.button !== 0 && event.pointerType !== 'touch') return
    if (state.editor !== null) return
    if (!state.active) return
    if (state.region !== null) {
      var rect = finishRegionAt(event)
      hide(regionBox)
      state.region = null
      state.down = null
      if (rect !== null) {
        try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
        createAnnotation(payloadForRegion(rect))
      }
      return
    }
    if (state.down === null) return
    var down = state.down
    state.down = null
    if (Math.abs(event.clientX - down.x) > 6 || Math.abs(event.clientY - down.y) > 6) return
    var node = elementAt(event.clientX, event.clientY)
    try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
    if (node !== null && isAnnotatableElement(node) === true) createAnnotation(payloadForElement(node))
    else createAnnotation(payloadForPoint(event.clientX, event.clientY))
  }

  function onClick(event: any) {
    if (isBarTarget(event.target)) return
    // Pins stay live while paused: clicking a number reopens its note.
    var pin = isPinTarget(event.target)
    if (pin !== null) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      if (event.stopImmediatePropagation) event.stopImmediatePropagation()
      var id = ''
      try { id = pin.getAttribute('data-dsh-annotate-id') || '' } catch (error) { id = '' }
      if (id !== '') openEditorById(id)
      return
    }
    if (!state.active) return
    if (state.editor !== null) return
    try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
    if (event.stopImmediatePropagation) event.stopImmediatePropagation()
  }

  function onKeyDown(event: any) {
    if (event.isComposing === true) return
    if (event.key !== 'Escape') return
    // Esc closes an open editor regardless of pause state; only when there is
    // no editor and annotation mode is live does it pause the mode.
    if (state.editor !== null) {
      try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
      if (event.stopImmediatePropagation) event.stopImmediatePropagation()
      closeEditor('cancel')
      return
    }
    if (!state.active) return
    try { event.preventDefault(); event.stopPropagation() } catch (error) { /* ignore */ }
    if (event.stopImmediatePropagation) event.stopImmediatePropagation()
    stopMode()
  }

  function onPointerCancel() {
    state.region = null
    state.down = null
    hide(regionBox)
  }

  function installListeners() {
    if (listenersInstalled === true) return
    listenersInstalled = true
    try {
      window.addEventListener('pointerdown', onPointerDown as any, true)
      window.addEventListener('pointermove', onPointerMove as any, true)
      window.addEventListener('pointerup', onPointerUp as any, true)
      window.addEventListener('pointercancel', onPointerCancel as any, true)
      window.addEventListener('click', onClick as any, true)
      window.addEventListener('keydown', onKeyDown as any, true)
    } catch (error) { /* ignore */ }
  }

  function removeListeners() {
    if (listenersInstalled !== true) return
    listenersInstalled = false
    try {
      window.removeEventListener('pointerdown', onPointerDown as any, true)
      window.removeEventListener('pointermove', onPointerMove as any, true)
      window.removeEventListener('pointerup', onPointerUp as any, true)
      window.removeEventListener('pointercancel', onPointerCancel as any, true)
      window.removeEventListener('click', onClick as any, true)
      window.removeEventListener('keydown', onKeyDown as any, true)
    } catch (error) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Public snapshot / collection
  // ---------------------------------------------------------------------------

  function imageMetas(record: any): RuntimeImageMeta[] {
    var metas: RuntimeImageMeta[] = []
    for (var index = 0; index < record.images.length; index += 1) {
      var image = record.images[index]
      metas.push({ id: image.id, name: image.name, width: image.width, height: image.height })
    }
    return metas
  }

  function publicRecord(record: any): RuntimeRecord {
    return {
      id: record.id,
      index: record.index,
      kind: record.kind,
      label: recordLabel(record),
      comment: record.comment,
      payload: record.payload,
      images: imageMetas(record),
    }
  }

  function status(): RuntimeStatus {
    var info = pageInfo()
    var records: RuntimeRecord[] = []
    for (var index = 0; index < state.records.length; index += 1) {
      records.push(publicRecord(state.records[index]))
    }
    return {
      version: VERSION,
      alive: true,
      active: state.active === true,
      editorOpen: state.editor !== null,
      editingId: state.editor === null ? null : state.editor.recordId,
      revision: state.revision,
      count: records.length,
      records: records,
      action: state.pendingAction,
      url: info.url,
      title: info.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
    }
  }

  function collect(): CollectedBatch {
    var info = pageInfo()
    var records: RuntimeRecord[] = []
    for (var index = 0; index < state.records.length; index += 1) {
      records.push(publicRecord(state.records[index]))
    }
    return { url: info.url, title: info.title, records: records }
  }

  function collectImages(): CollectedImages {
    var records: Array<{ recordId: string; images: RuntimeImage[] }> = []
    for (var recordIndex = 0; recordIndex < state.records.length; recordIndex += 1) {
      var record = state.records[recordIndex]
      var images: RuntimeImage[] = []
      for (var imageIndex = 0; imageIndex < record.images.length; imageIndex += 1) {
        var image = record.images[imageIndex]
        images.push({
          id: image.id,
          name: image.name,
          dataUrl: image.dataUrl,
          width: image.width,
          height: image.height,
        })
      }
      records.push({ recordId: record.id, images: images })
    }
    return { records: records }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function startMode(options?: { hud?: RuntimeHudTexts } | null) {
    var startOptions: any = options
    if (startOptions !== null && startOptions !== undefined && typeof startOptions === 'object') {
      if (startOptions.hud !== null && startOptions.hud !== undefined && typeof startOptions.hud === 'object') {
        state.hud = startOptions.hud
      }
    }
    disposed = false
    state.active = true
    state.down = null
    state.region = null
    if (state.editor !== null) closeEditor('commit')
    // Records are intentionally kept: re-arming only re-enables picking.
    armLayer()
    installListeners()
    syncBar()
    state.revision += 1
    return { ok: true }
  }

  function stopMode() {
    if (state.editor !== null) closeEditor('commit')
    state.active = false
    state.down = null
    state.region = null
    hide(hoverBox)
    hide(regionBox)
    hideBar()
    if (captureLayer) {
      captureLayer.style.pointerEvents = 'none'
      captureLayer.style.display = 'none'
    }
    // PAUSE, not teardown: keep the markers layer visible while records exist
    // (ChatGPT-style) so pins stay clickable and a later start() resumes.
    if (layer) layer.style.display = state.records.length > 0 ? 'block' : 'none'
    state.revision += 1
    return { ok: true }
  }

  function setVisible(visible: boolean) {
    ensureLayer()
    if (layerFresh) {
      redrawRecords()
      layerFresh = false
    }
    if (layer) layer.style.display = visible ? 'block' : 'none'
    if (captureLayer) {
      captureLayer.style.display = visible ? 'block' : 'none'
      captureLayer.style.pointerEvents = visible && state.active ? 'auto' : 'none'
    }
    return { ok: true }
  }

  function dispose() {
    removeListeners()
    if (state.editor !== null) {
      try { state.editor.el.remove() } catch (error) { /* ignore */ }
      state.editor = null
    }
    for (var index = 0; index < state.records.length; index += 1) {
      var record = state.records[index]
      try { if (record.boxEl) record.boxEl.remove() } catch (error) { /* ignore */ }
      try { if (record.pinEl) record.pinEl.remove() } catch (error) { /* ignore */ }
    }
    state.records = []
    state.active = false
    state.down = null
    state.region = null
    state.revision += 1
    try { if (layer) layer.remove() } catch (error) { /* ignore */ }
    layer = null
    captureLayer = null
    hoverBox = null
    regionBox = null
    bar = null
    layerFresh = false
    disposed = true
    try {
      if ((window as any)[KEY] === api) delete (window as any)[KEY]
    } catch (error) {
      try { (window as any)[KEY] = undefined } catch (innerError) { /* ignore */ }
    }
  }

  api = {
    version: VERSION,
    start: startMode,
    stop: stopMode,
    status: status,
    pull: status,
    collect: collect,
    collectImages: collectImages,
    openEditor: openEditorById,
    closeEditor: closeEditor,
    remove: removeRecord,
    takeAction: takeAction,
    clear: clearRecords,
    setVisible: setVisible,
    dispose: dispose,
  } as RuntimeApi

  try { (window as any)[KEY] = api } catch (error) { /* ignore */ }
  return api
}
