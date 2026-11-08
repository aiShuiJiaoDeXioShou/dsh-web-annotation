/** Inline locale dictionaries (registered through ctx.locale at apply time). */

export const zh: Record<string, string> = {
  'toggle.label': '批注',
  'toggle.title': '批注右侧浏览器页面',
  'toggle.exit': '退出批注并写入输入框',
  'toggle.hint': '打开右侧浏览器页面后可批注',
  'dock.title': '网页批注',
  'dock.count': '共 {count} 条',
  'dock.hint': '点击页面元素，或拖动框选区域；备注直接在页面气泡里写。',
  'dock.editing': '正在页面内输入第 {index} 条…',
  'dock.finish': '写入输入框',
  'dock.cancel': '取消',
  'dock.images': '{count} 张图片',
  'hint.noBrowser': '右侧边栏没有可批注的页面：请先在右侧 Browser 标签中打开一个网页。',
  'hint.collapsed': '右侧边栏未展开：请先展开右侧边栏的 Browser 标签。',
  'hint.injectFailed': '无法在当前页面启用批注（注入失败）。请刷新页面后重试。',
  'hint.pageGone': '页面已不可用，批注模式已停止。',
  'hint.captureFailed': '读取批注失败，请重试。',
  'hint.insertFailed': '输入框正忙，暂未写入。请等输入框空闲后再点一次“批注”或“写入输入框”。',
  'hint.inserted': '已把 {count} 条批注写入输入框。',
  'hint.insertedImages': '已把 {count} 条批注和 {images} 张图片写入输入框。',
  'hint.imageFailed': '批注已写入输入框，但图片附加失败。可重新批注一次图片。',
  'hint.discarded': '已取消这批批注。',
  'editor.placeholder': '写一句要改什么…',
  'editor.delete': '删除这条批注',
  'editor.confirm': '保存并关闭',
  'editor.addImage': '添加图片',
  'editor.imageRemove': '移除图片',
  'editor.imageTooLarge': '图片超过 8MB，已忽略',
  'editor.imageLimit': '每条批注最多 4 张图片',
  'editor.imageUnsupported': '仅支持 PNG / JPEG / WebP / GIF',
}

export const en: Record<string, string> = {
  'toggle.label': 'Annotate',
  'toggle.title': 'Annotate the right-Sidebar browser page',
  'toggle.exit': 'Exit annotation and insert into the composer',
  'toggle.hint': 'Open a page in the right-Sidebar browser first',
  'dock.title': 'Web annotations',
  'dock.count': '{count} annotations',
  'dock.hint': 'Click a page element or drag a region; write the note in the inline bubble.',
  'dock.editing': 'Editing annotation {index} on the page…',
  'dock.finish': 'Insert into composer',
  'dock.cancel': 'Cancel',
  'dock.images': '{count} images',
  'hint.noBrowser': 'No annotatable page in the right sidebar: open a page in a right-Sidebar Browser tab first.',
  'hint.collapsed': 'The right sidebar is collapsed: expand its Browser tab first.',
  'hint.injectFailed': 'Could not enable annotation on this page (injection failed). Reload the page and retry.',
  'hint.pageGone': 'The page is no longer available; annotation mode stopped.',
  'hint.captureFailed': 'Could not read the annotations; retry.',
  'hint.insertFailed': 'The composer is busy, so nothing was inserted. Wait for it to become idle and click Annotate/Insert again.',
  'hint.inserted': 'Inserted {count} annotations into the composer.',
  'hint.insertedImages': 'Inserted {count} annotations and {images} images into the composer.',
  'hint.imageFailed': 'The notes were inserted, but attaching the images failed. Annotate the images again to retry.',
  'hint.discarded': 'This annotation batch was discarded.',
  'editor.placeholder': 'Describe what should change…',
  'editor.delete': 'Delete this annotation',
  'editor.confirm': 'Save and close',
  'editor.addImage': 'Add image',
  'editor.imageRemove': 'Remove image',
  'editor.imageTooLarge': 'Image is over 8 MB and was skipped',
  'editor.imageLimit': 'Up to 4 images per annotation',
  'editor.imageUnsupported': 'Only PNG / JPEG / WebP / GIF are supported',
}

export function fill(template: string, params?: Record<string, string | number>): string {
  if (typeof template !== 'string') return ''
  return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (match, key: string) => {
    const value = params === undefined ? undefined : params[key]
    return value === undefined || value === null ? match : String(value)
  })
}
