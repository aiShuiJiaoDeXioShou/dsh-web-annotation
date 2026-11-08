/**
 * Shared annotation vocabulary for the page runtime, the browser-side
 * controller and the tests.
 *
 * The runtime injected into the annotated page owns the DOM truth; the plugin
 * only ever reads the plain-data shapes declared here. Nothing in this file may
 * import a DOM or Node built-in so both halves can depend on it.
 */

export type AnnotationKind = 'element' | 'region'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface ElementHints {
  id: string
  classes: string
  testId: string
  ariaLabel: string
  role: string
}

export type StyleSnapshot = Record<string, string>

/** One DOM element selected by the user, or the empty-string selector of a point click. */
export interface AnnotationPayload {
  kind: AnnotationKind
  selector: string
  label: string
  tag: string
  text: string
  html: string
  hints: ElementHints | Record<string, never>
  styles: StyleSnapshot
  rect: Rect
  docRect: Rect
  elements?: RegionElement[]
  url: string
  title: string
}

export interface RegionElement {
  selector: string
  label: string
  tag: string
  text: string
  rect?: Rect
}

/**
 * One image attached to a single annotation inside the page runtime.
 *
 * `dataUrl` only travels to the plugin on commit (`collectImages`), so the
 * 250 ms projection poll never drags base64 bytes across `executeJavaScript`.
 */
export interface RuntimeImage {
  id: string
  name: string
  dataUrl: string
  width?: number
  height?: number
}

/** Image metadata included in the lightweight projection. */
export interface RuntimeImageMeta {
  id: string
  name: string
  width?: number
  height?: number
}

/** One annotation as the plugin sees it before/after commit. */
export interface RuntimeRecord {
  id: string
  index: number
  kind: AnnotationKind
  label: string
  comment: string
  payload: AnnotationPayload
  images: RuntimeImageMeta[]
}

/** Snapshot used by the plugin poll loop; deliberately image-free. */
export interface RuntimeStatus {
  version: number
  alive: true
  active: boolean
  editorOpen: boolean
  editingId: string | null
  revision: number
  count: number
  records: RuntimeRecord[]
  url: string
  title: string
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
}

/** Text/placeholder copies pushed into the page runtime at start. */
export interface RuntimeHudTexts {
  editorPlaceholder: string
  editorDelete: string
  editorConfirm: string
  editorAddImage: string
  editorImageRemove: string
  editorImageTooLarge: string
  editorImageLimit: string
  editorImageUnsupported: string
}

/** One committed annotation batch the controller turns into composer content. */
export interface CommittedBatch {
  url: string
  title: string
  records: RuntimeRecord[]
  /** Full data URLs, aligned with records by record id. */
  images: RuntimeImage[]
}

export interface CollectedBatch {
  url: string
  title: string
  records: RuntimeRecord[]
}

/** Per-annotation image bundle returned by `collectImages`. */
export interface CollectedImages {
  records: Array<{ recordId: string; images: RuntimeImage[] }>
}
