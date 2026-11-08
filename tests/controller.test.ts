/**
 * Open -> finish -> reopen regression suite for the annotation lifecycle.
 *
 * This is the direct regression test for the reported bug: after leaving
 * element-selection mode once, entering it again must arm a live runtime and
 * accept annotations. The controller is driven through a fake webview whose
 * `executeJavaScript` mimics the injected page runtime.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AnnotationController, type ControllerDeps } from '../src/client/controller.js'
import type { BrowserView, ResolvedTarget } from '../src/client/target.js'
import type { RuntimeRecord, RuntimeStatus } from '../src/shared/types.js'
import type { ComposerInputActions } from '../src/client/attachments.js'

interface FakeRecord {
  id: string
  comment: string
  kind: 'element' | 'region'
  imageCount: number
}

function makeRecord(fake: FakeRecord): RuntimeRecord {
  return {
    id: fake.id,
    index: 1,
    kind: fake.kind,
    label: '「导出」',
    comment: fake.comment,
    images: Array.from({ length: fake.imageCount }, (_, index) => ({ id: `img-${index}`, name: `shot-${index}.png` })),
    payload: {
      kind: fake.kind,
      selector: 'button.export',
      label: '「导出」',
      tag: 'button',
      text: '导出',
      html: '',
      hints: { id: '', classes: 'export', testId: '', ariaLabel: '', role: '' },
      styles: {},
      rect: { x: 0, y: 0, width: 80, height: 30 },
      docRect: { x: 0, y: 0, width: 80, height: 30 },
      url: 'http://127.0.0.1/app/',
      title: '控制台',
    },
  }
}

class FakeRuntime {
  active = false
  records: FakeRecord[] = []
  injected = 0
  started = 0
  stopped = 0
  cleared = 0
  editorOpen = false
  editingId: string | null = null
  revision = 0

  status(): RuntimeStatus {
    return {
      version: 5,
      alive: true,
      active: this.active,
      editorOpen: this.editorOpen,
      editingId: this.editingId,
      revision: this.revision,
      count: this.records.length,
      records: this.records.map((record) => makeRecord(record)),
      url: 'http://127.0.0.1/app/',
      title: '控制台',
      viewport: { width: 400, height: 800 },
      scroll: { x: 0, y: 0 },
    }
  }
}

function makeView(runtime: FakeRuntime): BrowserView {
  const view: BrowserView = {
    isConnected: true,
    getBoundingClientRect: () => ({ width: 300, height: 400 }) as DOMRect,
    closest: () => null,
    getURL: () => 'http://127.0.0.1/app/',
    getTitle: () => '控制台',
    async executeJavaScript(code: string): Promise<unknown> {
      if (code.includes('.start(')) {
        runtime.started += 1
        runtime.active = true
        return { ok: true }
      }
      if (code.includes('.stop()')) {
        runtime.stopped += 1
        runtime.active = false
        return { ok: true }
      }
      if (code.includes('.clear()')) {
        runtime.cleared += 1
        runtime.records = []
        runtime.editorOpen = false
        runtime.editingId = null
        runtime.revision += 1
        return { ok: true }
      }
      if (code.includes('.closeEditor()')) {
        runtime.editorOpen = false
        runtime.editingId = null
        return { ok: true }
      }
      if (code.includes('.collectImages()')) {
        return {
          records: runtime.records.map((record) => ({
            recordId: record.id,
            images: Array.from({ length: record.imageCount }, (_, index) => ({
              id: `img-${index}`,
              name: `shot-${index}.png`,
              dataUrl:
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
            })),
          })),
        }
      }
      if (code.includes('.collect()')) {
        const status = runtime.status()
        return { url: status.url, title: status.title, records: status.records }
      }
      if (code.includes('.pull()') || code.includes('.status()')) return runtime.status()
      return null
    },
  }
  return view
}

interface HarnessOptions {
  insertOk?: boolean
  attachOk?: boolean
}

function makeHarness(options: HarnessOptions = {}) {
  const runtime = new FakeRuntime()
  const view = makeView(runtime)
  const inserts: string[] = []
  const attachments: Array<{ sessionId: string; images: number }> = []
  const actions: ComposerInputActions = {
    captureInsertion: () => ({ start: 0, end: 0, draftRev: 1 }),
    insertText: (text: string) => {
      inserts.push(text)
      return options.insertOk !== false
    },
    addAttachments: () => options.attachOk !== false,
  }
  const timers = {
    setInterval: () => 1,
    clearInterval: () => undefined,
    setTimeout: () => 2,
    clearTimeout: () => undefined,
  }
  const deps: ControllerDeps = {
    resolveTarget: (): ResolvedTarget => ({
      ok: true,
      target: { view, sessionId: 's1', pageUrl: 'http://127.0.0.1/app/', pageTitle: '控制台' },
    }),
    injectRuntime: async () => {
      runtime.injected += 1
      runtime.active = false
      runtime.records = []
      return true
    },
    startRuntime: async () => {
      runtime.started += 1
      runtime.active = true
      return runtime.status()
    },
    stopRuntime: async () => {
      runtime.stopped += 1
      runtime.active = false
    },
    clearRuntime: async () => {
      runtime.cleared += 1
      runtime.records = []
    },
    getInputActions: () => actions,
    attachments: {
      attach: (sessionId, _actions, images) => {
        attachments.push({ sessionId, images: images.length })
        return { ok: options.attachOk !== false, attached: options.attachOk === false ? 0 : images.length }
      },
    },
    t: (key: string, params?: Record<string, string | number>) => {
      const suffix = params === undefined ? '' : ':' + JSON.stringify(params)
      return key + suffix
    },
    timers,
  }
  const controller = new AnnotationController(deps)
  controller.setInputActions('s1', actions)
  return { controller, runtime, view, inserts, attachments }
}

test('open arms the runtime and publishes the live session', async () => {
  const { controller, runtime } = makeHarness()
  await controller.open('s1')
  const state = controller.stateOf('s1')
  assert.equal(state.open, true)
  assert.equal(state.active, true)
  assert.equal(runtime.injected, 1)
  assert.equal(runtime.started, 1)
})

test('finish inserts one compact text block and clears the page batch', async () => {
  const { controller, runtime, inserts } = makeHarness()
  await controller.open('s1')
  runtime.records = [
    { id: 'a1', comment: '颜色太浅', kind: 'element', imageCount: 0 },
    { id: 'a2', comment: '留白太大', kind: 'region', imageCount: 0 },
  ]
  await controller.finish('s1')
  assert.equal(inserts.length, 1)
  assert.match(inserts[0], /网页批注（2 条）/u)
  assert.match(inserts[0], /颜色太浅/u)
  assert.match(inserts[0], /留白太大/u)
  const state = controller.stateOf('s1')
  assert.equal(state.open, false)
  assert.equal(state.active, false)
  assert.equal(state.records.length, 0)
  assert.equal(state.lastInsert?.count, 2)
  assert.equal(runtime.active, false)
})

test('reopening after a finished batch re-arms selection mode (reported bug)', async () => {
  const { controller, runtime } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '第一轮', kind: 'element', imageCount: 0 }]
  await controller.finish('s1')
  runtime.records = []

  // Second open: the runtime must be injected and started again, not reused.
  await controller.open('s1')
  const state = controller.stateOf('s1')
  assert.equal(state.open, true)
  assert.equal(state.active, true)
  assert.equal(runtime.injected, 2)
  assert.equal(runtime.started, 2)

  // And selection still produces annotations that reach the composer.
  runtime.records = [{ id: 'b1', comment: '第二轮', kind: 'element', imageCount: 0 }]
  await controller.finish('s1')
  assert.equal(controller.stateOf('s1').lastInsert?.count, 1)
})

test('rapid double toggle cannot race two transitions', async () => {
  const { controller, runtime } = makeHarness()
  const originalInject = runtime.injected
  // Fire both toggles inside one microtask: the exclusive guard must keep the
  // second from starting a competing open/finish transition.
  const first = controller.toggle('s1')
  const second = controller.toggle('s1')
  await Promise.all([first, second])
  assert.equal(controller.stateOf('s1').open, true)
  assert.equal(runtime.injected, originalInject + 1)
})

test('images are staged as composer attachments and counted in the hint', async () => {
  const { controller, runtime, inserts, attachments } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '看这张图', kind: 'element', imageCount: 2 }]
  await controller.finish('s1')
  assert.equal(inserts.length, 1)
  assert.match(inserts[0], /2 张图片/u)
  assert.deepEqual(attachments, [{ sessionId: 's1', images: 2 }])
  const state = controller.stateOf('s1')
  assert.equal(state.lastInsert?.images, 2)
})

test('a busy composer keeps the page batch alive for retry', async () => {
  const { controller, runtime } = makeHarness({ insertOk: false })
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '重要修改', kind: 'element', imageCount: 0 }]
  await controller.finish('s1')
  const state = controller.stateOf('s1')
  assert.equal(state.open, true)
  assert.equal(state.hint?.kind, 'warn')
  assert.equal(runtime.active, true)
  assert.equal(runtime.records.length, 1)
})

test('finishing an empty batch closes silently without inserting text', async () => {
  const { controller, runtime, inserts } = makeHarness()
  await controller.open('s1')
  runtime.records = []
  await controller.finish('s1')
  assert.equal(inserts.length, 0)
  assert.equal(controller.stateOf('s1').open, false)
})

test('discard clears the page batch without inserting text', async () => {
  const { controller, runtime, inserts } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '不要了', kind: 'element', imageCount: 0 }]
  await controller.discard('s1')
  assert.equal(inserts.length, 0)
  assert.equal(controller.stateOf('s1').open, false)
  assert.equal(runtime.active, false)
})

test('image attachment failure still keeps the inserted text', async () => {
  const { controller, runtime, inserts } = makeHarness({ attachOk: false })
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '带图', kind: 'element', imageCount: 1 }]
  await controller.finish('s1')
  assert.equal(inserts.length, 1)
  const state = controller.stateOf('s1')
  assert.equal(state.open, false)
  assert.equal(state.hint?.kind, 'warn')
})
