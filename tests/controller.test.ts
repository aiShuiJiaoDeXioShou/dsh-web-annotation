/**
 * Lifecycle regression suite for ChatGPT-style annotation sessions.
 *
 * Covered contract:
 *  - open arms capture; pause (sidebar toggle) keeps records and markers;
 *  - re-open reuses the live runtime instead of re-injecting (persistent pins);
 *  - editing a pin while paused updates the dock count;
 *  - explicit write inserts one compact composer block + attachments, then clears;
 *  - the in-page bottom bar's 'commit' action is consumed exactly once;
 *  - a busy composer keeps the batch alive; page loss drops it with a hint.
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

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='

class FakeRuntime {
  alive = false
  version = 6
  active = false
  records: FakeRecord[] = []
  injected = 0
  started = 0
  stopped = 0
  cleared = 0
  editorOpen = false
  editingId: string | null = null
  revision = 0
  action: 'commit' | null = null
  url = 'http://127.0.0.1/app/'
  title = '控制台'

  status(): RuntimeStatus {
    return {
      version: this.version,
      alive: true,
      active: this.active,
      editorOpen: this.editorOpen,
      editingId: this.editingId,
      revision: this.revision,
      count: this.records.length,
      records: this.records.map((record) => makeRecord(record)),
      url: this.url,
      title: this.title,
      action: this.action,
      viewport: { width: 400, height: 800 },
      scroll: { x: 0, y: 0 },
    }
  }

  touch(): void {
    this.revision += 1
  }

  inject(): void {
    this.alive = true
    this.active = false
    this.records = []
    this.injected += 1
    this.revision = 0
  }
}

function makeView(runtime: FakeRuntime): BrowserView {
  return {
    isConnected: true,
    getBoundingClientRect: () => ({ width: 300, height: 400 }) as DOMRect,
    closest: () => null,
    getURL: () => runtime.url,
    getTitle: () => runtime.title,
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
        runtime.action = null
        runtime.touch()
        return { ok: true }
      }
      if (code.includes('.takeAction()')) {
        const action = runtime.action
        runtime.action = null
        return action
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
              dataUrl: PNG,
            })),
          })),
        }
      }
      if (code.includes('.collect()')) {
        const status = runtime.status()
        return { url: status.url, title: status.title, records: status.records }
      }
      if (code.includes('.pull()') || code.includes('.status()')) {
        return runtime.alive ? runtime.status() : null
      }
      return null
    },
  }
}

interface HarnessOptions {
  insertOk?: boolean
  attachOk?: boolean
  lostRuntime?: boolean
}

async function flush(times = 30): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
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
  let intervalHandler: (() => void) | null = null
  const timers = {
    setInterval: (handler: () => void) => {
      intervalHandler = handler
      return 1
    },
    clearInterval: () => {
      intervalHandler = null
    },
    setTimeout: () => 2,
    clearTimeout: () => undefined,
  }
  const deps: ControllerDeps = {
    resolveTarget: (): ResolvedTarget => ({
      ok: true,
      target: { view, sessionId: 's1', pageUrl: runtime.url, pageTitle: runtime.title },
    }),
    ensureRuntime: async () => {
      if (options.lostRuntime === true) return false
      if (runtime.alive && runtime.version === 6) return true
      runtime.inject()
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
      runtime.action = null
      runtime.touch()
    },
    takeRuntimeAction: async () => {
      const action = runtime.action
      runtime.action = null
      return action
    },
    getInputActions: () => actions,
    attachments: {
      attach: (sessionId, _actions, images) => {
        attachments.push({ sessionId, images: images.length })
        return { ok: options.attachOk !== false, attached: options.attachOk === false ? 0 : images.length }
      },
    },
    t: (key: string, params?: Record<string, string | number>) => key + (params === undefined ? '' : ':' + JSON.stringify(params)),
    timers,
  }
  const controller = new AnnotationController(deps)
  controller.setInputActions('s1', actions)
  const tick = async () => {
    intervalHandler?.()
    await flush()
  }
  return { controller, runtime, view, inserts, attachments, tick }
}

test('open injects once, arms capture and exposes status', async () => {
  const { controller, runtime } = makeHarness()
  await controller.open('s1')
  const state = controller.stateOf('s1')
  assert.equal(state.open, true)
  assert.equal(state.active, true)
  assert.equal(runtime.injected, 1)
  assert.equal(runtime.started, 1)
})

test('sidebar toggle pauses without writing and keeps the markers', async () => {
  const { controller, runtime, inserts } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '第一轮', kind: 'element', imageCount: 0 }]
  runtime.touch()
  await controller.toggle('s1')
  const state = controller.stateOf('s1')
  assert.equal(state.open, false)
  assert.equal(runtime.stopped, 1)
  assert.equal(inserts.length, 0)
  assert.equal(runtime.records.length, 1, 'markers must survive pause')
  assert.equal(state.records.length, 1)
})

test('reopen after pause reuses the runtime and keeps the batch', async () => {
  const { controller, runtime } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '保留', kind: 'element', imageCount: 0 }]
  runtime.touch()
  await controller.pause('s1')
  await controller.open('s1')
  const state = controller.stateOf('s1')
  assert.equal(runtime.injected, 1, 'runtime must be reused so markers persist')
  assert.equal(runtime.started, 2)
  assert.equal(state.open, true)
  assert.equal(state.records.length, 1)
})

test('pin edits while paused update the dock count through polling', async () => {
  const { controller, runtime, tick } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '第一条', kind: 'element', imageCount: 0 }]
  runtime.touch()
  await controller.pause('s1')
  runtime.records.push({ id: 'a2', comment: '暂停后新增', kind: 'region', imageCount: 0 })
  runtime.touch()
  await tick()
  const state = controller.stateOf('s1')
  assert.equal(state.open, false)
  assert.equal(state.records.length, 2)
})

test('explicit write inserts one compact block, attaches images, then clears the page', async () => {
  const { controller, runtime, inserts, attachments } = makeHarness()
  await controller.open('s1')
  runtime.records = [
    { id: 'a1', comment: '颜色太浅', kind: 'element', imageCount: 0 },
    { id: 'a2', comment: '留白太大', kind: 'region', imageCount: 1 },
  ]
  runtime.touch()
  await controller.pause('s1')
  await controller.write('s1')
  assert.equal(inserts.length, 1)
  assert.match(inserts[0], /网页批注（2 条）/u)
  assert.match(inserts[0], /颜色太浅/u)
  assert.match(inserts[0], /1 张图片/u)
  assert.deepEqual(attachments, [{ sessionId: 's1', images: 1 }])
  const state = controller.stateOf('s1')
  assert.equal(state.open, false)
  assert.equal(state.records.length, 0)
  assert.equal(state.lastInsert?.count, 2)
  assert.equal(state.lastInsert?.images, 1)
  assert.equal(runtime.records.length, 0)
  assert.equal(runtime.cleared, 1)
})

test('in-page bottom-bar commit action writes exactly once', async () => {
  const { controller, runtime, inserts, tick } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '来自页面底栏', kind: 'element', imageCount: 0 }]
  runtime.touch()
  runtime.action = 'commit'
  await tick()
  assert.equal(inserts.length, 1)
  assert.match(inserts[0], /来自页面底栏/u)
  assert.equal(runtime.action, null, 'action must be consumed')
  assert.equal(controller.stateOf('s1').records.length, 0)
  await tick()
  assert.equal(inserts.length, 1, 'a consumed action must not write twice')
})

test('busy composer keeps the page batch alive for retry', async () => {
  const { controller, runtime } = makeHarness({ insertOk: false })
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '重要修改', kind: 'element', imageCount: 0 }]
  runtime.touch()
  await controller.write('s1')
  const state = controller.stateOf('s1')
  assert.equal(state.open, true)
  assert.equal(state.hint?.kind, 'warn')
  assert.equal(runtime.records.length, 1)
})

test('write on an empty batch closes silently', async () => {
  const { controller, runtime, inserts } = makeHarness()
  await controller.open('s1')
  await controller.write('s1')
  assert.equal(inserts.length, 0)
  assert.equal(controller.stateOf('s1').open, false)
})

test('discard clears page markers without inserting text', async () => {
  const { controller, runtime, inserts } = makeHarness()
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '不要了', kind: 'element', imageCount: 0 }]
  runtime.touch()
  await controller.discard('s1')
  assert.equal(inserts.length, 0)
  assert.equal(controller.stateOf('s1').open, false)
  assert.equal(runtime.records.length, 0)
})

test('image attachment failure still keeps the inserted text', async () => {
  const { controller, runtime, inserts } = makeHarness({ attachOk: false })
  await controller.open('s1')
  runtime.records = [{ id: 'a1', comment: '带图', kind: 'element', imageCount: 1 }]
  runtime.touch()
  await controller.write('s1')
  assert.equal(inserts.length, 1)
  const state = controller.stateOf('s1')
  assert.equal(state.open, false)
  assert.equal(state.hint?.kind, 'warn')
})

test('lost page runtime drops the batch with a warning', async () => {
  const runtime = new FakeRuntime()
  runtime.inject()
  runtime.records = [{ id: 'a1', comment: '会丢', kind: 'element', imageCount: 0 }]
  runtime.touch()
  const view = makeView(runtime)
  let injectCount = 0
  const store = new (class {
    handler: (() => void) | null = null
  })()
  const deps: ControllerDeps = {
    resolveTarget: () => ({ ok: true, target: { view, sessionId: 's1', pageUrl: runtime.url, pageTitle: runtime.title } }),
    ensureRuntime: async () => {
      injectCount += 1
      return false
    },
    startRuntime: async () => runtime.status(),
    stopRuntime: async () => undefined,
    clearRuntime: async () => undefined,
    takeRuntimeAction: async () => null,
    getInputActions: () => undefined,
    attachments: { attach: () => ({ ok: true, attached: 0 }) },
    t: (key: string) => key,
    timers: {
      setInterval: (handler: () => void) => {
        store.handler = handler
        return 1
      },
      clearInterval: () => {
        store.handler = null
      },
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    },
  }
  const controller = new AnnotationController(deps)
  // Simulate an open session whose page then navigates away.
  runtime.alive = false
  await controller.open('s1')
  const state = controller.stateOf('s1')
  assert.equal(state.open, false)
  assert.match(String(state.hint?.text), /injectFailed|pageGone/u)
  assert.ok(injectCount >= 1)
})
