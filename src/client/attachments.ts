/**
 * Bridge from annotation images to the composer's real attachment rail.
 *
 * Annotations cannot fabricate draft attachment ids: the Conversation service
 * owns browser-owned draft state and DSH's own composer is the only consumer
 * that should register them. So the plugin asks `conversation.createDrafts()`
 * for ids, then hands exactly those ids to `inputActions.addAttachments()`.
 * When either step refuses (composer busy, service unavailable) every draft is
 * released again so no orphaned blob/object URL is left behind.
 */
import { imageToFile } from '../shared/image.js'
import type { RuntimeImage } from '../shared/types.js'

/** Structural face of DSH's Conversation service used by this plugin. */
export interface ConversationFace {
  createDrafts(
    sessionId: string,
    files: readonly File[],
    uploadImages: boolean,
  ): readonly DraftAttachmentHandle[]
  releaseDraftAttachments(attachments: readonly DraftAttachmentHandle[]): void
}

export interface DraftAttachmentHandle {
  id: unknown
}

/** Structural face of the public composer `inputActions`. */
export interface ComposerInputActions {
  captureInsertion?: () => unknown
  insertText?: (text: string, span: unknown) => boolean
  setDraft?: (text: string) => void
  addAttachments?: (ids: readonly unknown[]) => boolean
  removeAttachment?: (id: unknown) => void
}

export type AttachmentFailure = 'unavailable' | 'empty' | 'conversion' | 'refused'

export interface AttachResult {
  ok: boolean
  attached: number
  failure?: AttachmentFailure
}

export interface AttachmentBridge {
  /** The Conversation service may activate after this plugin; resolve lazily. */
  attach(sessionId: string, actions: ComposerInputActions | undefined, images: readonly RuntimeImage[]): AttachResult
}

export function createAttachmentBridge(getConversation: () => ConversationFace | undefined): AttachmentBridge {
  return {
    attach(sessionId, actions, images) {
      if (images.length === 0) return { ok: true, attached: 0 }
      if (actions === undefined || typeof actions.addAttachments !== 'function') {
        return { ok: false, attached: 0, failure: 'unavailable' }
      }
      const conversation = getConversation()
      if (conversation === undefined || typeof conversation.createDrafts !== 'function') {
        return { ok: false, attached: 0, failure: 'unavailable' }
      }
      const files: File[] = []
      images.forEach((image, index) => {
        const file = imageToFile(image, `annotation-${index + 1}.png`)
        if (file !== null) files.push(file)
      })
      if (files.length === 0) return { ok: false, attached: 0, failure: 'conversion' }
      let drafts: readonly DraftAttachmentHandle[] = []
      try {
        drafts = conversation.createDrafts(sessionId, files, true)
      } catch {
        return { ok: false, attached: 0, failure: 'unavailable' }
      }
      if (drafts.length === 0) return { ok: false, attached: 0, failure: 'refused' }
      let accepted = false
      try {
        accepted = actions.addAttachments(drafts.map((draft) => draft.id)) === true
      } catch {
        accepted = false
      }
      if (!accepted) {
        try {
          conversation.releaseDraftAttachments(drafts)
        } catch {
          /* best effort */
        }
        return { ok: false, attached: 0, failure: 'refused' }
      }
      return { ok: true, attached: drafts.length }
    },
  }
}

/** Collect the full data URLs out of a `collectImages()` result, in record order. */
export function flattenCommittedImages(
  records: ReadonlyArray<{ recordId: string; images: readonly RuntimeImage[] }>,
): RuntimeImage[] {
  const result: RuntimeImage[] = []
  for (const record of records) {
    for (const image of record.images) result.push(image)
  }
  return result
}
