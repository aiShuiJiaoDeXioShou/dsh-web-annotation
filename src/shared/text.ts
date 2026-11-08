/**
 * Composer-text formatting for committed annotation records.
 *
 * The text lands in the user's own composer draft, so it must stay compact:
 * no report file paths, no HTML, no style dumps, no Markdown headers. Every
 * extra token here is paid on every send, so only the information the model
 * needs to locate and change the element is kept.
 *
 * Records are grouped by the page they were captured on, which keeps batches
 * from several browser tabs/navigation states readable after they are merged
 * into one composer draft.
 */
import type { Rect, RuntimeRecord } from './types.js'

export interface BuildTextOptions {
  /** Append the image count when the batch carries attachments. */
  imageCount?: number
}

/** Render records as one text block for the composer. */
export function buildComposerText(records: readonly RuntimeRecord[], options: BuildTextOptions = {}): string {
  const visible = records.filter((record) => record.comment.trim() !== '' || record.images.length > 0)
  if (visible.length === 0) return ''
  const lines: string[] = []
  lines.push(`网页批注（${visible.length} 条）`)
  let lastPage: string | null = null
  let number = 0
  for (const record of visible) {
    const url = record.payload.url || ''
    if (url !== lastPage) {
      lines.push('')
      lines.push(`页面：${pageLabel(record.payload.title)}（${url === '' ? '地址未知' : url}）`)
      lastPage = url
    }
    number += 1
    lines.push(formatRecord(record, number))
  }
  const imageCount = options.imageCount ?? 0
  if (imageCount > 0) {
    lines.push('')
    lines.push(`（本批含 ${imageCount} 张图片，已作为附件加入输入框）`)
  }
  return lines.join('\n')
}

/** One line: `<n>. [kind] <locator>：<comment>` */
export function formatRecord(record: RuntimeRecord, number: number): string {
  const kind = record.kind === 'region' ? '区域' : '元素'
  const locator = locatorOf(record)
  const comment = record.comment.trim()
  const suffix = comment === '' ? '（仅图片）' : comment
  return `${number}. [${kind}] ${locator}：${suffix}`
}

/** Prefer a concrete selector; fall back to the human label or a point coordinate. */
function locatorOf(record: RuntimeRecord): string {
  const payload = record.payload
  const label = (record.label || payload.label || '').trim()
  if (record.kind === 'region') {
    const rect = payload.docRect || payload.rect
    const size = rect === undefined ? '' : `${Math.round(rect.width)}×${Math.round(rect.height)}`
    return label === '' || label === size ? `框选区域 ${size}` : `${label}（${size}）`
  }
  const selector = (payload.selector || '').trim()
  if (selector !== '') {
    return label === '' ? `\`${selector}\`` : `\`${selector}\` ${label}`
  }
  const point = pointLabel(payload.docRect || payload.rect)
  return point === '' ? label || '（未定位元素）' : `点击位置 ${point}`
}

function pointLabel(rect: Rect | undefined): string {
  if (rect === undefined || rect === null) return ''
  const x = Math.round(rect.x)
  const y = Math.round(rect.y)
  return `(${x}, ${y})`
}

function pageLabel(title: string): string {
  const text = typeof title === 'string' ? title.trim() : ''
  return text === '' ? '（无标题页面）' : text
}
