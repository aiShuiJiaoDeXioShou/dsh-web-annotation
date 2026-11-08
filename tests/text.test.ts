import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildComposerText, formatRecord } from '../src/shared/text.js'
import type { RuntimeRecord } from '../src/shared/types.js'

function record(overrides: Partial<RuntimeRecord> = {}): RuntimeRecord {
  return {
    id: 'a1',
    index: 1,
    kind: 'element',
    label: '「导出」',
    comment: '颜色太浅',
    images: [],
    payload: {
      kind: 'element',
      selector: 'button.export',
      label: '「导出」',
      tag: 'button',
      text: '导出',
      html: '<button class="export">导出</button>',
      hints: { id: '', classes: 'export', testId: '', ariaLabel: '', role: '' },
      styles: {},
      rect: { x: 10, y: 20, width: 80, height: 30 },
      docRect: { x: 10, y: 220, width: 80, height: 30 },
      url: 'http://127.0.0.1/app/',
      title: '控制台',
    },
    ...overrides,
  }
}

test('empty record list produces no composer text', () => {
  assert.equal(buildComposerText([]), '')
})

test('element record formats selector, label and comment on one line', () => {
  assert.equal(formatRecord(record(), 1), '1. [元素] `button.export` 「导出」：颜色太浅')
})

test('point annotation without selector uses document coordinates', () => {
  const point = record({
    payload: {
      ...record().payload,
      selector: '',
      label: '「点击位置」',
      rect: { x: 0, y: 0, width: 0, height: 0 },
      docRect: { x: 120, y: 340, width: 0, height: 0 },
    },
  })
  assert.equal(formatRecord(point, 2), '2. [元素] 点击位置 (120, 340)：颜色太浅')
})

test('region record reports its document size', () => {
  const region = record({
    kind: 'region',
    label: '640×240',
    payload: {
      ...record().payload,
      kind: 'region',
      selector: '',
      docRect: { x: 0, y: 0, width: 640, height: 240 },
    },
  })
  assert.equal(formatRecord(region, 3), '3. [区域] 框选区域 640×240：颜色太浅')
})

test('records are grouped by page and the image trailer is appended', () => {
  const second = record({
    id: 'a2',
    comment: '留白太大',
    payload: { ...record().payload, selector: 'section.hero', url: 'http://127.0.0.1/settings', title: '设置' },
    label: '「主区域」',
  })
  const text = buildComposerText([record(), second], { imageCount: 2 })
  const lines = text.split('\n')
  assert.equal(lines[0], '网页批注（2 条）')
  assert.equal(lines[1], '')
  assert.equal(lines[2], '页面：控制台（http://127.0.0.1/app/）')
  assert.equal(lines[3], '1. [元素] `button.export` 「导出」：颜色太浅')
  assert.equal(lines[4], '')
  assert.equal(lines[5], '页面：设置（http://127.0.0.1/settings）')
  assert.equal(lines[6], '2. [元素] `section.hero` 「主区域」：留白太大')
  assert.equal(lines[8], '（本批含 2 张图片，已作为附件加入输入框）')
})

test('records without comment still render when they carry images', () => {
  const imageOnly = record({ comment: '', images: [{ id: 'i1', name: 'shot.png' }] })
  assert.match(buildComposerText([imageOnly]), /（仅图片）$/u)
})
