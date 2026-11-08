/**
 * Image helpers shared by the browser controller and tests.
 *
 * The page runtime hands committed images over as data URLs (it can only pass
 * plain data through `executeJavaScript`), while the DSH Conversation service
 * accepts real `File` objects. These helpers bridge that gap and enforce the
 * plugin's own intake limits before any bytes reach the Host.
 */

export const SUPPORTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number]

/** Mirrors the runtime-side limit: 8 MiB of decoded source bytes per image. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

export interface ParsedDataUrl {
  mediaType: SupportedImageType
  bytes: Uint8Array
  dataUrl: string
}

export function isSupportedImageType(value: unknown): value is SupportedImageType {
  return typeof value === 'string' && (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(value)
}

/** Best-effort media type for a file name. */
export function imageMediaTypeOfName(name: string): SupportedImageType | null {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return null
}

/** Decode a `data:image/...;base64,...` URL into bytes. */
export function parseImageDataUrl(dataUrl: unknown): ParsedDataUrl | null {
  if (typeof dataUrl !== 'string') return null
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n\s]+)$/u.exec(dataUrl)
  if (match === null) return null
  const mediaType = match[1] as SupportedImageType
  if (!isSupportedImageType(mediaType)) return null
  let bytes: Uint8Array
  try {
    bytes = base64ToBytes(match[2].replace(/\s/gu, ''))
  } catch {
    return null
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
  return { mediaType, bytes, dataUrl }
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  }
  // Node test environment (the browser half always has atob).
  interface NodeBuffer {
    buffer: ArrayBufferLike
    byteOffset: number
    byteLength: number
  }
  const nodeBuffer = (globalThis as unknown as { Buffer?: { from(data: string, encoding: string): NodeBuffer } }).Buffer
  if (nodeBuffer === undefined) throw new Error('no base64 decoder')
  const buffer = nodeBuffer.from(base64, 'base64')
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
}

/** Convert one committed runtime image to a `File` ready for the Conversation service. */
export function imageToFile(image: { name?: string; dataUrl: string }, fallbackName: string): File | null {
  const parsed = parseImageDataUrl(image.dataUrl)
  if (parsed === null) return null
  const name = sanitizeImageName(image.name, fallbackName, parsed.mediaType)
  try {
    return new File([parsed.bytes as BlobPart], name, { type: parsed.mediaType })
  } catch {
    try {
      // Some older Electron/webview File constructors are picky about typed arrays.
      return new File([parsed.bytes.slice().buffer as ArrayBuffer], name, { type: parsed.mediaType })
    } catch {
      return null
    }
  }
}

export function sanitizeImageName(name: unknown, fallback: string, mediaType: SupportedImageType): string {
  const raw = typeof name === 'string' && name.trim() !== '' ? name.trim() : fallback
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').slice(0, 120)
  if (cleaned === '') return `annotation.${extensionOf(mediaType)}`
  return /\.[A-Za-z0-9]{1,5}$/u.test(cleaned) ? cleaned : `${cleaned}.${extensionOf(mediaType)}`
}

export function extensionOf(mediaType: SupportedImageType): string {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}
