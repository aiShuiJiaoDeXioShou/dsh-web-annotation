/**
 * Offline tests for the page-injected annotation runtime.
 *
 * The runtime is a plain function that reads `window`/`document`, so these
 * tests drive it against a hand-rolled DOM stub (`node:test`, no jsdom). The
 * stub covers the pieces the runtime actually touches: element creation,
 * events, hidden file inputs, FileReader/File/Image for image attachments and
 * `elementFromPoint`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeMain } from '../src/client/runtime.js'
import type { RuntimeHudTexts } from '../src/shared/types.js'

const HUD: RuntimeHudTexts = {
  editorPlaceholder: '写一句要改什么…',
  editorDelete: '删除这条批注',
  editorConfirm: '保存并关闭',
  editorAddImage: '添加图片',
  editorImageRemove: '移除图片',
  editorImageTooLarge: '图片超过 8 MiB，已忽略。',
  editorImageLimit: '每条批注最多 4 张图片。',
  editorImageUnsupported: '仅支持 png/jpeg/webp/gif 图片。',
}

type AnyEl = any
type AnyFn = (...args: any[]) => any
type AnyObj = Record<string, any>

// ---------------------------------------------------------------------------
// Minimal browser-ish stubs
// ---------------------------------------------------------------------------

class StubFile {
  name: string
  type: string
  size: number
  constructor(name: string, type: string, size: number) {
    this.name = name
    this.type = type
    this.size = size
  }
}

class StubFileReader {
  result: string | null = null
  onload: AnyFn | null = null
  onerror: AnyFn | null = null
  readAsDataURL(file: StubFile) {
    setTimeout(() => {
      if (!file || typeof file !== 'object') {
        if (this.onerror) this.onerror()
        return
      }
      this.result = `data:${file.type};base64,${Buffer.from(file.name).toString('base64')}`
      if (this.onload) this.onload()
    }, 0)
  }
}

class StubImage {
  naturalWidth = 64
  naturalHeight = 48
  width = 64
  height = 48
  onload: AnyFn | null = null
  onerror: AnyFn | null = null
  private source = ''
  set src(value: string) {
    this.source = value
    setTimeout(() => {
      if (this.onload) this.onload()
    }, 0)
  }
  get src() {
    return this.source
  }
}

function markConnected(node: AnyEl, value: boolean) {
  node.isConnected = value
  const children: AnyEl[] = node.children || []
  for (const child of children) markConnected(child, value)
}

function makeElement(tagName: string): AnyEl {
  const attributes: Record<string, string> = {}
  const element: AnyEl = {
    tagName: String(tagName || 'div').toUpperCase(),
    nodeType: 1,
    id: '',
    style: {} as Record<string, string>,
    value: '',
    placeholder: '',
    type: '',
    files: null,
    multiple: false,
    accept: '',
    children: [] as AnyEl[],
    parentElement: null,
    isConnected: false,
    innerText: '',
    textContent: '',
    innerHTML: '',
    outerHTML: '<div></div>',
    scrollHeight: 42,
    offsetWidth: 260,
    offsetHeight: 84,
    classList: { length: 0 },
    handlers: {} as Record<string, AnyFn[]>,
    clicked: 0,
    setAttribute(key: string, value: unknown) { attributes[key] = String(value) },
    getAttribute(key: string) {
      return Object.prototype.hasOwnProperty.call(attributes, key) ? attributes[key] : null
    },
    hasAttribute(key: string) { return Object.prototype.hasOwnProperty.call(attributes, key) },
    removeAttribute(key: string) { delete attributes[key] },
    appendChild(child: AnyEl) {
      this.children.push(child)
      child.parentElement = this
      markConnected(child, this.isConnected === true)
      return child
    },
    removeChild(child: AnyEl) {
      this.children = this.children.filter((entry: AnyEl) => entry !== child)
      child.parentElement = null
      markConnected(child, false)
      return child
    },
    contains(target: AnyEl) {
      if (target === this) return true
      for (const child of this.children) {
        if (child !== null && child.contains && child.contains(target)) return true
      }
      return false
    },
    remove() {
      if (this.parentElement) {
        this.parentElement.removeChild(this)
      } else {
        markConnected(this, false)
      }
    },
    addEventListener(type: string, handler: AnyFn) {
      this.handlers[type] = this.handlers[type] || []
      this.handlers[type].push(handler)
    },
    removeEventListener(type: string, handler: AnyFn) {
      this.handlers[type] = (this.handlers[type] || []).filter((entry: AnyFn) => entry !== handler)
    },
    dispatch(type: string, event: AnyObj) {
      for (const handler of (this.handlers[type] || []).slice()) handler(event)
    },
    click() {
      this.clicked += 1
      this.dispatch('click', baseEvent({ target: this }))
    },
    querySelectorAll() { return [] },
    querySelector() { return null },
    getBoundingClientRect() { return { left: 12, top: 20, width: 120, height: 32 } },
    scrollIntoView() {},
    focus() {},
    setSelectionRange() {},
  }
  return element
}

function baseEvent(extra: AnyObj = {}): AnyObj {
  return Object.assign({
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {},
    isComposing: false,
    shiftKey: false,
    key: '',
    code: '',
    button: 0,
    target: null,
  }, extra)
}

interface Page {
  win: AnyEl
  doc: AnyEl
  created: AnyEl[]
  listeners: Map<string, AnyFn[]>
  targetElement: AnyEl
  fromPoint: (x: number, y: number) => AnyEl | null
  fireWindow(type: string, event: AnyObj): void
  setFromPoint(fn: (x: number, y: number) => AnyEl | null): void
}

/** Build an empty page (window/document stub) without booting the runtime. */
function makePage(): Page {
  const created: AnyEl[] = []
  const documentElement = makeElement('html')
  documentElement.isConnected = true
  const bodyElement = makeElement('body')
  documentElement.appendChild(bodyElement)
  const targetElement = makeElement('button')
  targetElement.innerText = '主操作按钮'
  targetElement.textContent = '主操作按钮'
  bodyElement.appendChild(targetElement)

  const page: Page = {
    win: null as unknown as AnyEl,
    doc: null as unknown as AnyEl,
    created,
    listeners: new Map<string, AnyFn[]>(),
    targetElement,
    fromPoint: () => targetElement,
    fireWindow(type: string, event: AnyObj) {
      for (const handler of (page.listeners.get(type) || []).slice()) handler(event)
    },
    setFromPoint(fn) {
      page.fromPoint = fn
    },
  }

  const documentShim: AnyEl = {
    documentElement,
    body: bodyElement,
    head: makeElement('head'),
    title: '离屏测试页',
    createElement(tag: string) {
      const element = makeElement(tag)
      created.push(element)
      return element
    },
    querySelectorAll() { return [] },
    querySelector() { return null },
    elementFromPoint(x: number, y: number) { return page.fromPoint(x, y) },
  }

  const windowShim: AnyEl = {
    document: documentShim,
    location: { href: 'http://127.0.0.1:8123/annotation-demo/ui-preview.html' },
    innerWidth: 430,
    innerHeight: 900,
    scrollX: 0,
    scrollY: 120,
    setTimeout(fn: AnyFn) { return setTimeout(fn, 0) },
    clearTimeout(id: any) { clearTimeout(id) },
    addEventListener(type: string, handler: AnyFn) {
      const list = page.listeners.get(type) || []
      list.push(handler)
      page.listeners.set(type, list)
    },
    removeEventListener(type: string, handler: AnyFn) {
      const list = page.listeners.get(type) || []
      page.listeners.set(type, list.filter((entry) => entry !== handler))
    },
    getComputedStyle() {
      return {
        color: 'rgb(27, 29, 34)', backgroundColor: 'rgb(49, 85, 198)', fontSize: '14px', fontWeight: '400',
        border: '0px none rgb(0, 0, 0)', borderRadius: '9px', padding: '0px 16px', margin: '0px',
        display: 'inline-block', width: '104px', height: '34px', lineHeight: '20px', textAlign: 'center',
        opacity: '1', gap: 'normal',
      }
    },
    CSS: { escape: (value: unknown) => String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1') },
    scrollTo(x: number, y: number) {
      windowShim.scrollX = x
      windowShim.scrollY = y
    },
    FileReader: StubFileReader,
    Image: StubImage,
    File: StubFile,
  }

  page.win = windowShim
  page.doc = documentShim
  return page
}

interface Harness extends Page {
  api: AnyEl
  find(attrValue: string): AnyEl | null
  findAll(attrValue: string): AnyEl[]
  findTag(tag: string, attrValue: string): AnyEl | null
  findAllTag(tag: string, attrValue: string): AnyEl[]
  layerEl(): AnyEl | null
  lastTextarea(): AnyEl | null
  pin(id: string): AnyEl | null
  imageInput(): AnyEl | null
  errorEl(): AnyEl | null
  thumbs(): AnyEl[]
}

function installPage(page: Page) {
  ;(globalThis as any).window = page.win
  ;(globalThis as any).document = page.doc
}

function boot(): Harness {
  const page = makePage()
  installPage(page)
  const api = runtimeMain()
  return attachHarness(page, api)
}

function reinject(page: Page): Harness {
  installPage(page)
  const api = runtimeMain()
  return attachHarness(page, api)
}

function attachHarness(page: Page, api: AnyEl): Harness {
  const harness: Harness = Object.assign(page, {
    api,
    find(attrValue: string) {
      for (let index = page.created.length - 1; index >= 0; index -= 1) {
        const element = page.created[index]
        if (element.getAttribute('data-dsh-annotate') === attrValue) return element
      }
      return null
    },
    findAll(attrValue: string) {
      return page.created.filter(
        (element) => element.isConnected && element.getAttribute('data-dsh-annotate') === attrValue,
      )
    },
    findTag(tag: string, attrValue: string) {
      for (let index = page.created.length - 1; index >= 0; index -= 1) {
        const element = page.created[index]
        if (element.tagName === tag.toUpperCase() && element.getAttribute('data-dsh-annotate') === attrValue) return element
      }
      return null
    },
    findAllTag(tag: string, attrValue: string) {
      return page.created.filter(
        (element) => element.isConnected
          && element.tagName === tag.toUpperCase()
          && element.getAttribute('data-dsh-annotate') === attrValue,
      )
    },
    layerEl() {
      for (let index = page.created.length - 1; index >= 0; index -= 1) {
        const element = page.created[index]
        if (element.getAttribute('data-dsh-annotate') === 'layer' && element.isConnected) return element
      }
      return null
    },
    lastTextarea() {
      for (let index = page.created.length - 1; index >= 0; index -= 1) {
        const element = page.created[index]
        if (element.tagName === 'TEXTAREA' && element.isConnected) return element
      }
      return null
    },
    pin(id: string) {
      for (let index = page.created.length - 1; index >= 0; index -= 1) {
        const element = page.created[index]
        if (
          element.getAttribute('data-dsh-annotate') === 'pin'
          && element.getAttribute('data-dsh-annotate-id') === id
          && element.isConnected
        ) return element
      }
      return null
    },
    imageInput() {
      return harness.findTag('input', 'editor-file')
    },
    errorEl() {
      return harness.find('editor-error')
    },
    thumbs() {
      return harness.findAllTag('img', 'editor-image')
    },
  })
  return harness
}

// ---------------------------------------------------------------------------
// Gesture helpers
// ---------------------------------------------------------------------------

function clickElement(harness: Harness) {
  harness.fireWindow('pointerdown', baseEvent({ clientX: 40, clientY: 60 }))
  harness.fireWindow('pointermove', baseEvent({ clientX: 40, clientY: 60 }))
  harness.fireWindow('pointerup', baseEvent({ clientX: 40, clientY: 60 }))
}

function blankClick(harness: Harness) {
  harness.setFromPoint(() => null)
  try {
    harness.fireWindow('pointerdown', baseEvent({ clientX: 300, clientY: 400 }))
    harness.fireWindow('pointerup', baseEvent({ clientX: 300, clientY: 400 }))
  } finally {
    harness.setFromPoint(() => harness.targetElement)
  }
}

function dragRegion(harness: Harness) {
  harness.fireWindow('pointerdown', baseEvent({ clientX: 20, clientY: 30 }))
  harness.fireWindow('pointermove', baseEvent({ clientX: 220, clientY: 180 }))
  harness.fireWindow('pointerup', baseEvent({ clientX: 240, clientY: 200 }))
}

function commitEditor(harness: Harness, text?: string) {
  const textarea = harness.lastTextarea()
  assert.ok(textarea !== null, 'expected an open inline editor textarea')
  if (text !== undefined) textarea.value = text
  textarea.dispatch('keydown', baseEvent({ key: 'Enter', code: 'Enter' }))
}

function attachFiles(harness: Harness, files: StubFile[]) {
  const input = harness.imageInput()
  assert.ok(input !== null, 'expected a hidden file input in the editor')
  input.files = files
  input.dispatch('change', baseEvent({ target: input }))
}

function pasteImage(harness: Harness, file: StubFile) {
  const textarea = harness.lastTextarea()
  assert.ok(textarea !== null, 'expected an open inline editor textarea')
  textarea.dispatch('paste', baseEvent({
    clipboardData: {
      items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      files: [file],
    },
  }))
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
async function flush() {
  await tick()
  await tick()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('installs the runtime API and reports version 5', () => {
  const harness = boot()
  assert.equal(typeof harness.api, 'object')
  assert.equal(harness.api.version, 5)
  for (const method of [
    'start', 'stop', 'status', 'pull', 'collect', 'collectImages',
    'openEditor', 'closeEditor', 'remove', 'clear', 'setVisible', 'dispose',
  ]) {
    assert.equal(typeof harness.api[method], 'function', `${method} should be a function`)
  }
  const snapshot = harness.api.status()
  assert.equal(snapshot.version, 5)
  assert.equal(snapshot.alive, true)
  assert.equal(snapshot.active, false)
  assert.equal(snapshot.editorOpen, false)
  assert.equal(snapshot.count, 0)
  assert.equal(harness.win.__DSH_WEB_ANNOTATE__, harness.api)
})

test('runtime source is self-contained when passed through executeJavaScript', () => {
  const page = makePage()
  const source = runtimeMain.toString()
  assert.equal(/^\s*(import|require)\b/m.test(source), false)
  // tsx transpiles with esbuild `keepNames`, which injects a module-level `__name`
  // helper into function bodies. The shipped bundle (scripts/build.mjs) runs
  // esbuild without keepNames, so the real toString() has no helper references.
  // Provide it here so this test still proves the body has no other externals.
  const factory = new Function('window', 'document', '__name', `return (${source})`) as AnyFn
  const api = factory(page.win, page.doc, (fn: AnyFn) => fn)({ hud: HUD })
  assert.equal(api.version, 5)
  assert.equal(page.win.__DSH_WEB_ANNOTATE__, api)
  assert.equal(api.start().ok, true)
  assert.equal(api.status().active, true)
  assert.equal(api.status().version, 5)
  assert.equal(typeof api.collectImages, 'function')
})

test('start is idempotent and re-arms the overlay', () => {
  const harness = boot()
  assert.equal(harness.api.start({ hud: HUD }).ok, true)
  assert.equal(harness.api.start({ hud: HUD }).ok, true)
  const snapshot = harness.api.status()
  assert.equal(snapshot.active, true)
  assert.equal(harness.layerEl().style.display, 'block')
  assert.equal(harness.find('capture').style.pointerEvents, 'auto')
})

test('click selects an element, opens the inline editor and commits a note', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  let snapshot = harness.api.status()
  assert.equal(snapshot.count, 1)
  assert.equal(snapshot.editorOpen, true)
  assert.equal(snapshot.editingId, 'a1')
  assert.equal(snapshot.records[0].kind, 'element')
  assert.equal(snapshot.records[0].label, '「主操作按钮」')
  const textarea = harness.lastTextarea()
  assert.equal(textarea.placeholder, HUD.editorPlaceholder)

  commitEditor(harness, '主按钮颜色太浅，换成深一点的品牌蓝')
  snapshot = harness.api.status()
  assert.equal(snapshot.editorOpen, false)
  assert.equal(snapshot.records[0].comment, '主按钮颜色太浅，换成深一点的品牌蓝')

  const collected = harness.api.collect()
  assert.equal(collected.records.length, 1)
  assert.equal(typeof collected.records[0].payload.selector, 'string')
  assert.ok(collected.records[0].payload.selector.length > 0)
  assert.deepEqual(collected.records[0].images, [])
})

test('blank click creates a point annotation and empty commit discards it', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  blankClick(harness)
  let snapshot = harness.api.status()
  assert.equal(snapshot.count, 1)
  assert.equal(snapshot.records[0].kind, 'element')
  assert.equal(snapshot.records[0].label, '「点击位置」')
  commitEditor(harness)
  snapshot = harness.api.status()
  assert.equal(snapshot.count, 0)
  assert.equal(snapshot.editorOpen, false)
})

test('drag creates a region annotation and empty commit discards it', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  dragRegion(harness)
  let snapshot = harness.api.status()
  assert.equal(snapshot.count, 1)
  assert.equal(snapshot.records[0].kind, 'region')
  assert.equal(snapshot.records[0].label, '220×170')
  assert.equal(snapshot.records[0].payload.elements.length > 0, true)
  commitEditor(harness)
  snapshot = harness.api.status()
  assert.equal(snapshot.count, 0)
})

test('pin click reopens the editor and updates the note', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  commitEditor(harness, '第一次备注')
  const pin = harness.pin('a1')
  assert.ok(pin !== null)
  harness.fireWindow('click', baseEvent({ target: pin }))
  let snapshot = harness.api.status()
  assert.equal(snapshot.editorOpen, true)
  assert.equal(snapshot.editingId, 'a1')
  assert.equal(harness.lastTextarea().value, '第一次备注')
  commitEditor(harness, '第二次备注')
  snapshot = harness.api.status()
  assert.equal(snapshot.records[0].comment, '第二次备注')
})

test('outside pointerdown commits the editor; empty outside commit is discarded', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  harness.lastTextarea().value = '外部点击保存'
  harness.fireWindow('pointerdown', baseEvent({ target: harness.targetElement, clientX: 5, clientY: 5 }))
  assert.equal(harness.api.status().editorOpen, false)
  assert.equal(harness.api.status().records[0].comment, '外部点击保存')

  clickElement(harness)
  assert.equal(harness.api.status().editorOpen, true)
  harness.fireWindow('pointerdown', baseEvent({ target: harness.targetElement, clientX: 5, clientY: 5 }))
  assert.equal(harness.api.status().editorOpen, false)
  assert.equal(harness.api.status().count, 1)
})

test('confirm button and collect() commit the note and page info', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  harness.lastTextarea().value = '点确认按钮保存'
  harness.find('editor-confirm').dispatch('click', baseEvent())
  const snapshot = harness.api.status()
  assert.equal(snapshot.editorOpen, false)
  assert.equal(snapshot.records[0].comment, '点确认按钮保存')
  const collected = harness.api.collect()
  assert.equal(collected.url, 'http://127.0.0.1:8123/annotation-demo/ui-preview.html')
  assert.equal(collected.title, '离屏测试页')
  assert.equal(collected.records.length, 1)
  assert.equal(collected.records[0].index, 1)
})

test('delete button and remove()/clear() drop records', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  harness.find('editor-delete').dispatch('click', baseEvent())
  assert.equal(harness.api.status().count, 0)

  clickElement(harness)
  commitEditor(harness, 'one')
  clickElement(harness)
  commitEditor(harness, 'two')
  assert.equal(harness.api.status().count, 2)
  const ids = harness.api.status().records.map((record: AnyObj) => record.id)
  assert.equal(harness.api.remove(ids[0]).ok, true)
  assert.equal(harness.api.status().count, 1)
  assert.equal(harness.api.clear().ok, true)
  assert.equal(harness.api.status().count, 0)
  assert.deepEqual(harness.api.collectImages().records, [])
})

test('escape cancels the editor and then exits the mode', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  harness.fireWindow('keydown', baseEvent({ key: 'Escape' }))
  let snapshot = harness.api.status()
  assert.equal(snapshot.editorOpen, false)
  assert.equal(snapshot.count, 0)
  assert.equal(snapshot.active, true)
  harness.fireWindow('keydown', baseEvent({ key: 'Escape' }))
  snapshot = harness.api.status()
  assert.equal(snapshot.active, false)
  assert.equal(harness.layerEl().style.display, 'none')
})

test('restart after stop keeps records and re-arms selection gestures', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  commitEditor(harness, 'first')
  assert.equal(harness.api.stop().ok, true)
  let snapshot = harness.api.status()
  assert.equal(snapshot.active, false)
  assert.equal(snapshot.count, 1)
  assert.equal(harness.layerEl().style.display, 'none')
  assert.equal(harness.api.collect().records.length, 1)

  assert.equal(harness.api.start({ hud: HUD }).ok, true)
  snapshot = harness.api.status()
  assert.equal(snapshot.active, true)
  assert.equal(snapshot.count, 1)
  assert.equal(harness.layerEl().style.display, 'block')
  assert.equal(harness.find('capture').style.pointerEvents, 'auto')

  clickElement(harness)
  assert.equal(harness.api.status().editorOpen, true)
  commitEditor(harness, 'second')
  snapshot = harness.api.status()
  assert.equal(snapshot.count, 2)
  assert.equal(snapshot.records[1].comment, 'second')
})

test('stop keeps records and status/collect stay image-byte-free', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  commitEditor(harness, 'note')
  harness.api.stop()
  const collected = harness.api.collect()
  assert.equal(collected.records.length, 1)
  assert.equal(JSON.stringify(harness.api.status()).includes('dataUrl'), false)
  assert.equal(JSON.stringify(collected).includes('dataUrl'), false)
})

test('dispose removes the instance and re-injection re-arms annotation', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  commitEditor(harness, 'before dispose')
  harness.api.dispose()
  assert.equal(harness.win.__DSH_WEB_ANNOTATE__, undefined)
  assert.equal(harness.listeners.get('pointerdown')?.length ?? 0, 0)

  const again = reinject(harness)
  assert.equal(again.api.version, 5)
  assert.equal(again.api.status().active, false)
  assert.equal(again.api.start({ hud: HUD }).ok, true)
  clickElement(again)
  assert.equal(again.api.status().editorOpen, true)
  commitEditor(again, 'after re-inject')
  const snapshot = again.api.status()
  assert.equal(snapshot.count, 1)
  assert.equal(snapshot.records[0].comment, 'after re-inject')
})

test('image file input is hidden, localized and accepts only image types', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  const addButton = harness.find('editor-add-image')
  assert.ok(addButton !== null)
  assert.equal(addButton.getAttribute('aria-label'), HUD.editorAddImage)
  const input = harness.imageInput()
  assert.ok(input !== null)
  assert.equal(input.type, 'file')
  assert.equal(input.style.display, 'none')
  assert.equal(input.getAttribute('accept'), 'image/png,image/jpeg,image/webp,image/gif')
  assert.equal(input.multiple, true)
  addButton.click()
  assert.equal(input.clicked, 1)
})

test('attaches an image through the file input and exposes only metadata', async () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  attachFiles(harness, [new StubFile('shot.png', 'image/png', 2048)])
  await flush()

  const snapshot = harness.api.status()
  assert.equal(snapshot.records[0].images.length, 1)
  const meta = snapshot.records[0].images[0]
  assert.equal(typeof meta.id, 'string')
  assert.equal(meta.name, 'shot.png')
  assert.equal(Object.prototype.hasOwnProperty.call(meta, 'dataUrl'), false)
  assert.equal(meta.width, 64)
  assert.equal(meta.height, 48)
  assert.equal(JSON.stringify(snapshot).includes('data:image'), false)

  const images = harness.api.collectImages()
  assert.equal(images.records.length, 1)
  assert.equal(images.records[0].recordId, 'a1')
  assert.equal(images.records[0].images.length, 1)
  assert.ok(images.records[0].images[0].dataUrl.startsWith('data:image/png;base64,'))

  assert.equal(harness.thumbs().length, 1)
  assert.ok(harness.thumbs()[0].getAttribute('src').startsWith('data:image/png;base64,'))
})

test('pasting a clipboard image attaches it', async () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  pasteImage(harness, new StubFile('paste.png', 'image/png', 512))
  await flush()
  const snapshot = harness.api.status()
  assert.equal(snapshot.records[0].images.length, 1)
  assert.equal(snapshot.records[0].images[0].name, 'paste.png')
  assert.equal(harness.thumbs().length, 1)
})

test('image-only annotations are kept and survive commit plus pin reopen', async () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  attachFiles(harness, [new StubFile('only.png', 'image/png', 100)])
  await flush()
  commitEditor(harness)
  let snapshot = harness.api.status()
  assert.equal(snapshot.count, 1)
  assert.equal(snapshot.editorOpen, false)
  assert.equal(snapshot.records[0].comment, '')

  const pin = harness.pin('a1')
  assert.ok(pin !== null)
  harness.fireWindow('click', baseEvent({ target: pin }))
  snapshot = harness.api.status()
  assert.equal(snapshot.editorOpen, true)
  assert.equal(snapshot.records[0].images.length, 1)
  assert.equal(harness.thumbs().length, 1)
  commitEditor(harness, '补一句说明')
  assert.equal(harness.api.status().records[0].comment, '补一句说明')
  assert.equal(harness.api.status().records[0].images.length, 1)
})

test('limits attachments to four images per annotation', async () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  attachFiles(harness, [
    new StubFile('1.png', 'image/png', 100),
    new StubFile('2.png', 'image/png', 100),
    new StubFile('3.png', 'image/png', 100),
    new StubFile('4.png', 'image/png', 100),
    new StubFile('5.png', 'image/png', 100),
  ])
  await flush()
  assert.equal(harness.api.status().records[0].images.length, 4)
  assert.equal(harness.errorEl().textContent, HUD.editorImageLimit)
  assert.equal(harness.errorEl().style.display, 'block')
})

test('rejects oversized files with the localized message', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  attachFiles(harness, [new StubFile('huge.png', 'image/png', 8 * 1024 * 1024 + 1)])
  assert.equal(harness.api.status().records[0].images.length, 0)
  assert.equal(harness.errorEl().textContent, HUD.editorImageTooLarge)
})

test('accepts exactly 8 MiB and rejects unsupported image types', async () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  attachFiles(harness, [new StubFile('edge.png', 'image/png', 8 * 1024 * 1024)])
  assert.equal(harness.errorEl().style.display, 'none')
  await flush()
  assert.equal(harness.api.status().records[0].images.length, 1)
  attachFiles(harness, [new StubFile('vector.svg', 'image/svg+xml', 100)])
  assert.equal(harness.errorEl().textContent, HUD.editorImageUnsupported)
  assert.equal(harness.api.status().records[0].images.length, 1)
})

test('remove thumbnail control drops a single image', async () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  attachFiles(harness, [
    new StubFile('a.png', 'image/png', 100),
    new StubFile('b.png', 'image/png', 100),
  ])
  await flush()
  assert.equal(harness.api.status().records[0].images.length, 2)
  const removeButtons = harness.findAll('editor-image-remove')
  assert.equal(removeButtons.length, 2)
  assert.equal(removeButtons[0].getAttribute('aria-label'), HUD.editorImageRemove)
  removeButtons[0].dispatch('click', baseEvent({ target: removeButtons[0] }))
  assert.equal(harness.api.status().records[0].images.length, 1)
  assert.equal(harness.thumbs().length, 1)
})

test('clear drops image data and commit/collectImages stay consistent', async () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  attachFiles(harness, [new StubFile('clear.png', 'image/png', 100)])
  await flush()
  commitEditor(harness, 'with image')
  let images = harness.api.collectImages()
  assert.equal(images.records.length, 1)
  assert.equal(images.records[0].images.length, 1)

  harness.api.clear()
  const snapshot = harness.api.status()
  assert.equal(snapshot.count, 0)
  images = harness.api.collectImages()
  assert.deepEqual(images.records, [])
  assert.equal(harness.api.collect().records.length, 0)
})

test('setVisible toggles the overlay without dropping records', () => {
  const harness = boot()
  harness.api.start({ hud: HUD })
  clickElement(harness)
  commitEditor(harness, 'kept')
  assert.equal(harness.api.setVisible(false).ok, true)
  assert.equal(harness.layerEl().style.display, 'none')
  assert.equal(harness.api.status().count, 1)
  assert.equal(harness.api.setVisible(true).ok, true)
  assert.equal(harness.layerEl().style.display, 'block')
  assert.equal(harness.api.status().count, 1)
})
