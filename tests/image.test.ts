import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  imageMediaTypeOfName,
  imageToFile,
  isSupportedImageType,
  parseImageDataUrl,
  sanitizeImageName,
} from '../src/shared/image.js'

const png1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='

test('data URL decoder accepts the supported image types', () => {
  const parsed = parseImageDataUrl(png1x1)
  assert.ok(parsed !== null)
  assert.equal(parsed.mediaType, 'image/png')
  assert.ok(parsed.bytes.length > 10)
})

test('data URL decoder rejects unsupported or malformed inputs', () => {
  assert.equal(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null)
  assert.equal(parseImageDataUrl('http://example.com/a.png'), null)
  assert.equal(parseImageDataUrl('data:image/png;base64,'), null)
  assert.equal(parseImageDataUrl(null), null)
})

test('committed image becomes a File with a sanitized name and media type', () => {
  const file = imageToFile({ name: 'shot.png', dataUrl: png1x1 }, 'annotation-1.png')
  assert.ok(file instanceof File)
  assert.equal(file.name, 'shot.png')
  assert.equal(file.type, 'image/png')
  assert.ok(file.size > 10)
})

test('file name falls back to the provided default and extension is added', () => {
  assert.equal(sanitizeImageName('', 'annotation-2.png', 'image/png'), 'annotation-2.png')
  assert.equal(sanitizeImageName('weird/name', 'x', 'image/jpeg'), 'weird_name.jpg')
  assert.equal(sanitizeImageName('already.webp', 'x', 'image/webp'), 'already.webp')
})

test('media type helpers agree with the runtime whitelist', () => {
  assert.equal(isSupportedImageType('image/webp'), true)
  assert.equal(isSupportedImageType('image/bmp'), false)
  assert.equal(imageMediaTypeOfName('a.JPEG'), 'image/jpeg')
  assert.equal(imageMediaTypeOfName('a.txt'), null)
})
