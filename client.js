/**
 * Client half of the Web Page Annotations bundle.
 *
 * Renders:
 *  - an annotation toggle in the right-Sidebar Browser control strip;
 *  - the "批注 xN" chip above the composer, aligned to the composer card;
 *  - the injected runtime inside the page's Electron <webview>
 *    (executeJavaScript), which owns the picking gestures, markers and the
 *    inline comment bubble.
 */
window.__ModuleLoader__.load({
  id: 'dsh-web-annotation',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const RUNTIME_KEY = '__DSH_WEB_ANNOTATE__';
    const RUNTIME_GLOBAL = 'window.' + RUNTIME_KEY;
    const RUNTIME_VERSION = 4;
    const LOCALE_NS = 'dshWebAnnotation';
    const SAVE_URL = '/dsh-annotate/save';

    const zh = {
      'toggle.label': '批注',
      'toggle.labelCount': '批注 {count}',
      'toggle.title': '批注右侧浏览器页面（桌面端）',
      'tray.title': '网页批注',
      'tray.close': '退出',
      'tray.retryInsert': '再次写入输入框',
      'tray.count': '共 {count} 条',
      'tray.screenshots': '将附 {count} 张截图',
      'tray.undo': '撤销上一条',
      'tray.remove': '删除这条批注',
      'tray.edit': '在页面上编辑这条批注',
      'tray.kindElement': '元素',
      'tray.kindRegion': '区域',
      'tray.empty': '点击页面元素，或按住拖动框选区域；备注会直接在页面上的输入框里写。',
      'tray.editingInPage': '正在页面内输入第 {index} 条…（Enter 保存，点击空白处也可以）',
      'tray.pinHint': '点击页面上的蓝色编号可修改备注。',
      'tray.send': '发送批注（{count}）',
      'tray.sending': '正在截图并保存…',
      'tray.clear': '清空',
      'tray.noPage': '（未定位页面）',
      'tray.editNow': '（输入中…）',
      'chrome.enter': '批注此页面',
      'chrome.exit': '退出批注',
      'editor.delete': '删除这条批注',
      'editor.confirm': '保存并关闭',
      'chip.label': '批注 x{count}',
      'chip.remove': '清除这批批注',
      'chip.title': '发送消息时会自动附上这批批注',
      'hint.noBrowser': '右侧边栏没有可批注的页面：请先在右侧 Browser 标签中打开一个网页。',
      'hint.collapsed': '右侧边栏未展开：请先展开右侧边栏的 Browser 标签。',
      'hint.injectFailed': '无法在当前页面启用批注（注入失败）。请刷新页面后重试。',
      'hint.pageGone': '页面已不可用，批注模式已停止。',
      'hint.working': '正在准备报告…',
      'hint.inserted': '已写入输入框。',
      'hint.sent': '已写入输入框（{count} 条批注，{images} 张截图）。',
      'hint.undone': '已撤销上一条批注。',
      'hint.noAnnotation': '还没有可发送的批注。',
      'hint.isEmpty': '这条批注没有内容，已丢弃。',
      'hint.copied': '输入框正忙，报告已复制到剪贴板，直接粘贴发送即可。',
      'hint.insertFailed': '报告已保存到磁盘，但写入输入框失败，可点“再次写入输入框”。',
      'hint.captureFailed': '准备批注数据失败，请重试。',
      'hint.saveRequestFailed': '保存批注报告失败：{error}',
      'hud.element': '批注模式 · 点击元素 / 拖动框选',
      'hud.hint': '空格临时操作 · Esc 退出',
      'hud.editing': '输入需求后按 Enter 保存',
      'hud.suspended': '临时操作模式 · 松开空格恢复批注',
      'editor.placeholder': '写一句要改什么…',
      'editor.hint': 'Enter 保存 · Shift+Enter 换行 · 点击气泡外完成此处批注',
    };

    const en = {
      'toggle.label': 'Annotate',
      'toggle.labelCount': 'Annotate {count}',
      'toggle.title': 'Annotate the right-Sidebar browser page (desktop)',
      'tray.title': 'Web page annotations',
      'tray.close': 'Exit',
      'tray.retryInsert': 'Insert again',
      'tray.count': '{count} annotations',
      'tray.screenshots': '{count} screenshots',
      'tray.undo': 'Undo last',
      'tray.remove': 'Remove this annotation',
      'tray.edit': 'Edit this annotation on the page',
      'tray.kindElement': 'Element',
      'tray.kindRegion': 'Region',
      'tray.empty': 'Click a page element, or drag to select a region; write the note in the inline editor on the page.',
      'tray.editingInPage': 'Editing annotation {index} on the page… (Enter to save, or click blank space)',
      'tray.pinHint': 'Click a blue number on the page to edit its note.',
      'tray.send': 'Send annotations ({count})',
      'tray.sending': 'Capturing and saving…',
      'tray.clear': 'Clear',
      'tray.noPage': '(no page located)',
      'tray.editNow': '(typing…)',
      'chrome.enter': 'Annotate this page',
      'chrome.exit': 'Exit annotation',
      'editor.delete': 'Delete this annotation',
      'editor.confirm': 'Save and close',
      'chip.label': 'Notes x{count}',
      'chip.remove': 'Discard these annotations',
      'chip.title': 'These annotations are attached to the next message you send',
      'hint.noBrowser': 'No annotatable page in the right sidebar: open a page in a right-Sidebar Browser tab first.',
      'hint.collapsed': 'The right sidebar is collapsed: expand its Browser tab first.',
      'hint.injectFailed': 'Could not enable annotation on this page (injection failed). Reload the page and retry.',
      'hint.pageGone': 'The page is no longer available; annotation mode stopped.',
      'hint.working': 'Preparing the report…',
      'hint.inserted': 'Inserted into the composer.',
      'hint.sent': 'Inserted into the composer ({count} annotations, {images} screenshots).',
      'hint.undone': 'Last annotation removed.',
      'hint.noAnnotation': 'There is no annotation to send.',
      'hint.isEmpty': 'That annotation had no text and was discarded.',
      'hint.copied': 'The composer is busy; the report was copied to the clipboard instead.',
      'hint.insertFailed': 'The report was saved to disk but could not be inserted; use “Insert again”.',
      'hint.captureFailed': 'Preparing annotation data failed; retry.',
      'hint.saveRequestFailed': 'Saving the annotation report failed: {error}',
      'hud.element': 'Annotation mode · click an element / drag a region',
      'hud.hint': 'Space for page · Esc to exit',
      'hud.editing': 'Type the note, then press Enter',
      'hud.suspended': 'Temporary page mode · release Space to resume',
      'editor.placeholder': 'Describe what should change…',
      'editor.hint': 'Enter to save · Shift+Enter for a new line · click outside this bubble to finish',
    };

    const CSS_TEXT = [
      '.dsh-ann-chrome-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
      '.dsh-ann-chrome-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary)}',
      '.dsh-ann-chrome-btn.is-active{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18));color:var(--dsw-alias-label-primary)}',
      '.dsh-ann-chrome-btn:disabled{opacity:.55;cursor:default}',
      '.dsh-ann-chrome-btn svg{width:17px;height:17px}',
      '.dsh-ann-chrome-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:1px}',
      '.dsh-ann-chip-row{display:flex;width:100%;min-width:0}',
      '.dsh-ann-chip{display:inline-flex;align-items:center;gap:.45em;height:2em;padding:0 .25em 0 .7em;border:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:.6em;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary);font-size:calc(var(--dsh-content-font-size,14px) - 3px);line-height:1;width:max-content;max-width:100%}',
      '.dsh-ann-chip svg{width:1.15em;height:1.15em;flex:none;color:var(--dsw-alias-label-secondary)}',
      '.dsh-ann-chip-label{white-space:nowrap}',
      '.dsh-ann-chip-remove{width:1.6em;height:1.6em;padding:0;border:0;border-radius:.8em;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:1em;line-height:1;cursor:pointer;flex:none}',
      '.dsh-ann-chip-remove:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.16));color:var(--dsw-alias-state-error-primary,#dc2626)}',
].join('\n');

    /** Self-contained runtime injected into the annotated page. */
    function runtimeMain() {
      'use strict';
      var KEY = '__DSH_WEB_ANNOTATE__';
      if (window[KEY] && typeof window[KEY].dispose === 'function') {
        try { window[KEY].dispose(); } catch (error) { /* ignore */ }
      }
      try { delete window[KEY]; } catch (error) { window[KEY] = undefined; }
      var Z = 2147483600;
      var state = {
        active: false,
        records: [],
        revision: 0,
        editor: null,
        hud: {},
        down: null,
        region: null,
        nextId: 0,
      };
      var layer = null;
      var captureLayer = null;
      var hoverBox = null;
      var regionBox = null;

      function css(node, styles) {
        for (var key in styles) {
          try { node.style[key] = styles[key]; } catch (error) { /* ignore */ }
        }
        return node;
      }
      function makeBox(styles) { return css(document.createElement('div'), styles); }
      function hide(node) { if (node) node.style.display = 'none'; }
      function connected(node) { return node !== null && node !== undefined && node.isConnected === true; }
      function clipText(value, max) {
        var text = value === null || value === undefined ? '' : String(value);
        return text.length > max ? text.slice(0, max) + '…' : text;
      }
      function escapeSelector(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
      }

      function ensureLayer() {
        if (connected(layer)) return layer;
        layer = document.createElement('div');
        layer.setAttribute('data-dsh-annotate', 'layer');
        css(layer, {
          position: 'absolute', left: '0', top: '0', width: '0', height: '0',
          overflow: 'visible', pointerEvents: 'none', zIndex: String(Z), display: 'none',
        });
        var mount = document.documentElement || document.body || document;
        mount.appendChild(layer);
        captureLayer = makeBox({
          position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
          background: 'transparent', pointerEvents: 'auto', cursor: 'crosshair',
          zIndex: '0',
        });
        captureLayer.setAttribute('data-dsh-annotate', 'capture');
        layer.appendChild(captureLayer);
        hoverBox = makeBox({
          position: 'absolute', display: 'none', border: '2px solid #3b82f6',
          backgroundColor: 'rgba(59,130,246,0.14)', borderRadius: '3px',
          boxSizing: 'border-box', pointerEvents: 'none', zIndex: '1',
        });
        hoverBox.setAttribute('data-dsh-annotate', 'hover');
        regionBox = makeBox({
          position: 'absolute', display: 'none', border: '1.5px dashed #2563eb',
          backgroundColor: 'rgba(37,99,235,0.10)', borderRadius: '2px',
          boxSizing: 'border-box', pointerEvents: 'none', zIndex: '1',
        });
        regionBox.setAttribute('data-dsh-annotate', 'region');
        layer.appendChild(hoverBox);
        layer.appendChild(regionBox);
        return layer;
      }

      function renderHud() { /* The page-level HUD was removed by request. */ }

      function place(node, x, y, width, height) {
        css(node, {
          display: 'block',
          left: Math.round(x) + 'px',
          top: Math.round(y) + 'px',
          width: Math.max(1, Math.round(width)) + 'px',
          height: Math.max(1, Math.round(height)) + 'px',
        });
      }

      function selectorFor(node) {
        if (!node || node.nodeType !== 1) return '';
        var parts = [];
        var current = node;
        for (var depth = 0; depth < 8 && current && current.nodeType === 1 && current !== document.documentElement; depth += 1) {
          var part = current.tagName.toLowerCase();
          if (current.id) {
            var idSelector = '#' + escapeSelector(current.id);
            try {
              if (document.querySelectorAll(idSelector).length === 1) {
                parts.unshift(idSelector);
                return parts.join(' > ');
              }
            } catch (error) { /* ignore */ }
          }
          var classes = [];
          if (current.classList) {
            for (var index = 0; index < current.classList.length && classes.length < 2; index += 1) {
              var name = current.classList[index];
              if (name && name.length <= 40 && !/^[0-9]/.test(name)) classes.push(name);
            }
          }
          if (classes.length > 0) part += '.' + classes.map(escapeSelector).join('.');
          var parent = current.parentElement;
          if (parent) {
            var sameTag = 0;
            var position = 0;
            for (var childIndex = 0; childIndex < parent.children.length; childIndex += 1) {
              var child = parent.children[childIndex];
              if (child.tagName === current.tagName) {
                sameTag += 1;
                if (child === current) position = sameTag;
              }
            }
            if (sameTag > 1) part += ':nth-of-type(' + position + ')';
          }
          parts.unshift(part);
          var candidate = parts.join(' > ');
          try {
            if (document.querySelectorAll(candidate).length === 1) return candidate;
          } catch (error) { /* ignore */ }
          current = parent;
        }
        return parts.join(' > ');
      }

      function labelFor(node) {
        var text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length > 0) return '「' + clipText(text, 40) + '」';
        var aria = node.getAttribute('aria-label');
        if (aria) return clipText(aria, 60);
        var testId = node.getAttribute('data-testid');
        if (testId) return testId;
        var tag = node.tagName.toLowerCase();
        return node.id ? tag + '#' + node.id : tag;
      }

      function stylesFor(node) {
        var result = {};
        var keys = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'margin', 'border', 'borderRadius', 'display', 'gap', 'textAlign', 'opacity', 'width', 'height'];
        var computed;
        try { computed = window.getComputedStyle(node); } catch (error) { return result; }
        for (var index = 0; index < keys.length; index += 1) {
          var key = keys[index];
          var value = computed[key];
          if (typeof value === 'string' && value !== '') result[key] = clipText(value, 100);
        }
        return result;
      }

      function elementAt(x, y) {
        var node = null;
        var captureWas = null;
        if (captureLayer !== null && captureLayer.style.pointerEvents !== 'none') {
          captureWas = captureLayer.style.pointerEvents;
          captureLayer.style.pointerEvents = 'none';
        }
        try {
          node = document.elementFromPoint(x, y);
        } catch (error) {
          node = null;
        } finally {
          if (captureWas !== null && captureLayer !== null) captureLayer.style.pointerEvents = captureWas;
        }
        if (node === null) return null;
        while (node && node.nodeType === 1) {
          if (node.hasAttribute && node.hasAttribute('data-dsh-annotate')) {
            node = node.parentElement;
            continue;
          }
          if (node === document.documentElement || node === document.body) return null;
          var rect = node.getBoundingClientRect();
          if (rect.width >= 4 && rect.height >= 4) return node;
          node = node.parentElement;
        }
        return null;
      }

      function pageInfo() {
        return { url: location.href, title: document.title };
      }

      function payloadForElement(node) {
        var rect = node.getBoundingClientRect();
        var info = pageInfo();
        var classes = '';
        try { classes = node.getAttribute('class') || ''; } catch (error) { /* ignore */ }
        var html = '';
        try { html = clipText(node.outerHTML, 800); } catch (error) { /* ignore */ }
        return {
          kind: 'element',
          selector: selectorFor(node),
          label: labelFor(node),
          tag: node.tagName ? node.tagName.toLowerCase() : '',
          text: clipText((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(), 120),
          html: html,
          hints: {
            id: node.id || '',
            classes: clipText(classes, 120),
            testId: node.getAttribute('data-testid') || '',
            ariaLabel: node.getAttribute('aria-label') || '',
            role: node.getAttribute('role') || '',
          },
          styles: stylesFor(node),
          rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
          docRect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
          url: info.url,
          title: info.title,
        };
      }

      function elementsInRect(rect) {
        var found = [];
        var seen = {};
        var columns = 5;
        var rows = 4;
        for (var column = 0; column < columns; column += 1) {
          for (var row = 0; row < rows; row += 1) {
            var x = rect.x + rect.width * (column + 0.5) / columns;
            var y = rect.y + rect.height * (row + 0.5) / rows;
            var node = elementAt(x, y);
            if (!node) continue;
            var selector = selectorFor(node);
            if (!selector || seen[selector]) continue;
            seen[selector] = true;
            var nodeRect = node.getBoundingClientRect();
            found.push({
              selector: selector,
              label: labelFor(node),
              tag: node.tagName ? node.tagName.toLowerCase() : '',
              text: clipText((node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim(), 80),
              rect: { x: nodeRect.left, y: nodeRect.top, width: nodeRect.width, height: nodeRect.height },
            });
            if (found.length >= 8) return found;
          }
        }
        return found;
      }

      function payloadForRegion(rect) {
        var info = pageInfo();
        var elements = elementsInRect(rect);
        return {
          kind: 'region',
          selector: elements.length > 0 ? elements[0].selector : '',
          label: Math.round(rect.width) + '×' + Math.round(rect.height),
          tag: '',
          text: '',
          html: '',
          hints: {},
          styles: {},
          rect: rect,
          docRect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
          elements: elements,
          url: info.url,
          title: info.title,
        };
      }

      function isAnnotatableElement(node) {
        if (!node || node.nodeType !== 1) return false;
        var tag = node.tagName ? node.tagName.toLowerCase() : '';
        if (tag === 'html' || tag === 'body') return false;
        var rect = node.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        var interactive = tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea'
          || tag === 'select' || tag === 'label' || tag === 'summary' || tag === 'img'
          || node.getAttribute('role') !== null || node.hasAttribute('data-testid') === true;
        if (interactive === true) return true;
        var wide = rect.width >= window.innerWidth * 0.6;
        var tall = rect.height >= window.innerHeight * 0.9;
        if (wide === true && tall === true) return false;
        return true;
      }

      function updateHover(x, y) {
        if (!state.active || state.editor || state.down || state.region) return;
        var node = elementAt(x, y);
        if (!node || isAnnotatableElement(node) !== true) { hide(hoverBox); return; }
        var rect = node.getBoundingClientRect();
        place(hoverBox, rect.left + window.scrollX, rect.top + window.scrollY, rect.width, rect.height);
      }

      function payloadForPoint(x, y) {
        var info = pageInfo();
        return {
          kind: 'element',
          selector: '',
          label: '「点击位置」',
          tag: '',
          text: '',
          html: '',
          hints: {},
          styles: {},
          rect: { x: x, y: y, width: 0, height: 0 },
          docRect: { x: x + window.scrollX, y: y + window.scrollY, width: 0, height: 0 },
          url: info.url,
          title: info.title,
        };
      }

      function formatRegionRect(rect) {
        return Math.round(rect.width) + '×' + Math.round(rect.height);
      }

      function recordLabel(record) {
        if (record.kind === 'region') return formatRegionRect(record.payload.docRect || record.payload.rect);
        return record.payload.label || record.payload.tag || '';
      }

      function findRecord(id) {
        for (var index = 0; index < state.records.length; index += 1) {
          if (state.records[index].id === id) return state.records[index];
        }
        return null;
      }

      function renumber() {
        for (var index = 0; index < state.records.length; index += 1) {
          var record = state.records[index];
          record.index = index + 1;
          if (record.pinEl) record.pinEl.textContent = String(record.index);
        }
      }

      function drawRecord(record) {
        ensureLayer();
        var payload = record.payload || {};
        var rect = payload.docRect;
        if (!rect && payload.rect) {
          rect = { x: payload.rect.x + window.scrollX, y: payload.rect.y + window.scrollY, width: payload.rect.width, height: payload.rect.height };
        }
        if (!rect) return;
        var hasSize = rect.width > 0 && rect.height > 0;
        var boxEl = null;
        if (hasSize) {
          boxEl = makeBox({
            position: 'absolute', border: '2px solid rgba(37,99,235,0.9)',
            backgroundColor: 'rgba(37,99,235,0.10)', borderRadius: '3px',
            boxSizing: 'border-box', display: 'block', pointerEvents: 'none', zIndex: '1',
          });
          place(boxEl, rect.x, rect.y, rect.width, rect.height);
          boxEl.setAttribute('data-dsh-annotate', 'record');
          layer.appendChild(boxEl);
        }
        var pinEl = makeBox({
          position: 'absolute', width: '28px', height: '28px', borderRadius: '14px',
          background: '#2563eb', color: '#ffffff', border: '2px solid #ffffff',
          boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: '600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
          boxShadow: '0 2px 6px rgba(15,23,42,0.35)', pointerEvents: 'auto', cursor: 'pointer',
          transform: 'translate(-50%,-50%)', zIndex: '2',
        });
        pinEl.setAttribute('data-dsh-annotate', 'pin');
        pinEl.setAttribute('data-dsh-annotate-id', record.id);
        pinEl.textContent = String(record.index);
        css(pinEl, { left: Math.round(rect.x) + 'px', top: Math.round(rect.y) + 'px' });
        layer.appendChild(pinEl);
        record.boxEl = boxEl;
        record.pinEl = pinEl;
      }

      function removeRecordInternal(record) {
        if (record.boxEl) record.boxEl.remove();
        if (record.pinEl) record.pinEl.remove();
        state.records = state.records.filter(function (entry) { return entry !== record; });
        renumber();
        state.revision += 1;
      }

      function removeRecord(id) {
        var record = findRecord(id);
        if (record === null) return { ok: false };
        if (state.editor && state.editor.recordId === id) closeEditor('cancel');
        removeRecordInternal(record);
        return { ok: true, revision: state.revision };
      }

      function clearRecords() {
        if (state.editor) closeEditor('cancel');
        for (var index = 0; index < state.records.length; index += 1) {
          var record = state.records[index];
          if (record.boxEl) record.boxEl.remove();
          if (record.pinEl) record.pinEl.remove();
        }
        state.records = [];
        state.revision += 1;
        return { ok: true, revision: state.revision };
      }

      function isPinTarget(target) {
        var node = target;
        while (node && node !== document.body && node !== document.documentElement) {
          if (node.hasAttribute) {
            if (node.getAttribute('data-dsh-annotate') === 'pin') return node;
            if (node.getAttribute('data-dsh-annotate') === 'layer') return null;
          }
          node = node.parentElement;
        }
        return null;
      }

      function autoGrow(textarea) {
        try {
          textarea.style.height = 'auto';
          textarea.style.height = Math.min(150, Math.max(30, textarea.scrollHeight)) + 'px';
        } catch (error) { /* ignore */ }
      }

      function positionEditor(editor, record) {
        var rect = record.payload.docRect || { x: window.scrollX + 40, y: window.scrollY + 40, width: 0, height: 0 };
        var viewportLeft = window.scrollX;
        var viewportTop = window.scrollY;
        var maxLeft = viewportLeft + window.innerWidth - (editor.offsetWidth || 260) - 8;
        var maxTop = viewportTop + window.innerHeight - (editor.offsetHeight || 90) - 8;
        var left = rect.x + 18;
        if (left > maxLeft) left = Math.max(viewportLeft + 8, rect.x - (editor.offsetWidth || 260) - 18);
        var top = rect.y - 12;
        if (top < viewportTop + 8) top = rect.y + Math.max(rect.height, 18) + 12;
        if (top > maxTop) top = Math.max(viewportTop + 8, maxTop);
        css(editor, { left: Math.round(left) + 'px', top: Math.round(top) + 'px' });
      }

      function openEditor(record) {
        if (!record) return { ok: false };
        if (state.editor) {
          if (state.editor.recordId === record.id) {
            try { state.editor.textarea.focus({ preventScroll: true }); } catch (error) { /* ignore */ }
            return { ok: true };
          }
          closeEditor('commit');
        }
        ensureLayer();
        var rect = record.payload.docRect || {};
        if (rect.y !== undefined) {
          var visibleTop = window.scrollY;
          var visibleBottom = window.scrollY + window.innerHeight;
          if (rect.y < visibleTop + 24 || rect.y > visibleBottom - 120) {
            try { window.scrollTo(window.scrollX, Math.max(0, rect.y - window.innerHeight / 3)); } catch (error) { /* ignore */ }
          }
        }
        var editor = makeBox({
          position: 'absolute', display: 'block', width: '260px', maxWidth: 'calc(100vw - 24px)',
          background: '#ffffff', color: '#1b1d22', border: '1px solid rgba(15,23,42,0.14)',
          borderRadius: '10px', boxShadow: '0 10px 28px rgba(15,23,42,0.22)',
          padding: '8px 10px', boxSizing: 'border-box',
          font: '13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif',
          pointerEvents: 'auto', zIndex: '3', textAlign: 'left',
        });
        editor.setAttribute('data-dsh-annotate', 'editor');
        var textarea = document.createElement('textarea');
        textarea.setAttribute('data-dsh-annotate', 'editor-input');
        textarea.value = record.comment || '';
        textarea.placeholder = state.hud.editorPlaceholder || '';
        css(textarea, {
          display: 'block', width: '100%', minHeight: '30px', maxHeight: '150px',
          border: '0', outline: 'none', resize: 'none', padding: '0', margin: '0',
          background: 'transparent', color: 'inherit', font: 'inherit', lineHeight: '1.5',
          overflowY: 'auto', boxSizing: 'border-box',
        });
        var footer = makeBox({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', marginTop: '4px' });
        var spacer = makeBox({ flex: '1 1 auto' });
        var confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.setAttribute('data-dsh-annotate', 'editor-confirm');
        confirmButton.title = state.hud.editorConfirm || '';
        confirmButton.setAttribute('aria-label', state.hud.editorConfirm || 'save');
        css(confirmButton, {
          flex: 'none', width: '24px', height: '24px', padding: '0', border: '0',
          borderRadius: '12px', background: 'transparent', color: '#2563eb',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        });
        confirmButton.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5 L10 17.5 L19 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        confirmButton.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
        confirmButton.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          closeEditor('commit');
        });
        var deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.setAttribute('data-dsh-annotate', 'editor-delete');
        deleteButton.title = state.hud.editorDelete || '';
        deleteButton.setAttribute('aria-label', state.hud.editorDelete || 'delete');
        css(deleteButton, {
          flex: 'none', width: '24px', height: '24px', padding: '0', border: '0',
          borderRadius: '12px', background: 'transparent', color: '#9ca3af',
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        });
        deleteButton.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        deleteButton.addEventListener('pointerdown', function (event) { event.stopPropagation(); });
        deleteButton.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          deleteFromEditor();
        });
        footer.appendChild(spacer);
        footer.appendChild(confirmButton);
        footer.appendChild(deleteButton);
        editor.appendChild(textarea);
        editor.appendChild(footer);
        layer.appendChild(editor);

        textarea.addEventListener('input', function () {
          autoGrow(textarea);
        });
        textarea.addEventListener('keydown', function (event) {
          if (event.isComposing === true) return;
          if (event.key === 'Enter' && event.shiftKey !== true) {
            event.preventDefault();
            event.stopPropagation();
            closeEditor('commit');
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeEditor('cancel');
          }
        });
        editor.addEventListener('pointerdown', function (event) {
          event.stopPropagation();
        });

        state.editor = { recordId: record.id, el: editor, textarea: textarea };
        record.editing = true;
        hide(hoverBox);
        positionEditor(editor, record);
        autoGrow(textarea);
        renderHud();
        try {
          textarea.focus({ preventScroll: true });
          var length = textarea.value.length;
          textarea.setSelectionRange(length, length);
        } catch (error) { /* ignore */ }
        return { ok: true };
      }

      function openEditorById(id) {
        var record = findRecord(id);
        if (record === null) return { ok: false };
        return openEditor(record);
      }

      function closeEditor(mode) {
        var editorState = state.editor;
        if (editorState === null) return { ok: true, closed: false };
        var record = findRecord(editorState.recordId);
        var value = '';
        try { value = String(editorState.textarea.value || '').trim(); } catch (error) { value = ''; }
        try { editorState.el.remove(); } catch (error) { /* ignore */ }
        state.editor = null;
        if (record !== null) {
          record.editing = false;
          var action = mode === undefined || mode === null ? 'commit' : mode;
          if (action === 'commit') {
            if (value !== '') {
              record.comment = value;
              record.draft = false;
            } else if (record.draft === true) {
              removeRecordInternal(record);
            }
          } else if (action === 'cancel' && record.draft === true) {
            removeRecordInternal(record);
          }
        }
        state.revision += 1;
        renderHud();
        return { ok: true, closed: true, revision: state.revision };
      }

      function deleteFromEditor() {
        var editorState = state.editor;
        if (editorState === null) return { ok: false };
        var record = findRecord(editorState.recordId);
        try { editorState.el.remove(); } catch (error) { /* ignore */ }
        state.editor = null;
        if (record !== null) {
          record.editing = false;
          removeRecordInternal(record);
        }
        state.revision += 1;
        renderHud();
        return { ok: true };
      }

      function createAnnotation(payload) {
        state.nextId += 1;
        var record = {
          id: 'a' + state.nextId,
          index: state.records.length + 1,
          kind: payload.kind,
          payload: payload,
          comment: '',
          draft: true,
          editing: false,
          boxEl: null,
          pinEl: null,
        };
        state.records.push(record);
        drawRecord(record);
        state.revision += 1;
        hide(hoverBox);
        openEditor(record);
        return { ok: true, id: record.id, revision: state.revision };
      }

      function finishRegionAt(event) {
        var region = state.region;
        if (!region) return null;
        var left = Math.min(region.startX, event.clientX);
        var top = Math.min(region.startY, event.clientY);
        var width = Math.abs(event.clientX - region.startX);
        var height = Math.abs(event.clientY - region.startY);
        if (width < 8 || height < 8) return null;
        return { x: left, y: top, width: width, height: height };
      }

      function onPointerDown(event) {
        if (!state.active) return;
        if (event.button !== undefined && event.button !== 0 && event.pointerType !== 'touch') return;
        if (state.editor !== null) {
          var inside = false;
          try { inside = state.editor.el.contains(event.target); } catch (error) { inside = false; }
          if (!inside) {
            try { event.preventDefault(); event.stopPropagation(); } catch (error) { /* ignore */ }
            closeEditor('commit');
          }
          return;
        }
        if (isPinTarget(event.target) !== null) return;
        state.down = { x: event.clientX, y: event.clientY };
        state.region = null;
        try { event.preventDefault(); event.stopPropagation(); } catch (error) { /* ignore */ }
      }

      function onPointerMove(event) {
        if (!state.active) return;
        if (state.editor !== null) return;
        if (state.down !== null && state.region === null) {
          var dx = event.clientX - state.down.x;
          var dy = event.clientY - state.down.y;
          if (dx * dx + dy * dy > 36) {
            state.region = { startX: state.down.x, startY: state.down.y, x: event.clientX, y: event.clientY };
          }
        }
        if (state.region !== null) {
          var region = state.region;
          var left = Math.min(region.startX, event.clientX);
          var top = Math.min(region.startY, event.clientY);
          place(regionBox, left + window.scrollX, top + window.scrollY,
            Math.abs(event.clientX - region.startX), Math.abs(event.clientY - region.startY));
          hide(hoverBox);
          return;
        }
        if (state.down !== null) { hide(hoverBox); return; }
        updateHover(event.clientX, event.clientY);
      }

      function onPointerUp(event) {
        if (!state.active) return;
        if (event.button !== undefined && event.button !== 0 && event.pointerType !== 'touch') return;
        if (state.editor !== null) return;
        if (state.region !== null) {
          var rect = finishRegionAt(event);
          hide(regionBox);
          state.region = null;
          state.down = null;
          if (rect !== null) {
            try { event.preventDefault(); event.stopPropagation(); } catch (error) { /* ignore */ }
            createAnnotation(payloadForRegion(rect));
          }
          return;
        }
        if (state.down === null) return;
        var down = state.down;
        state.down = null;
        if (Math.abs(event.clientX - down.x) > 6 || Math.abs(event.clientY - down.y) > 6) return;
        var node = elementAt(event.clientX, event.clientY);
        try { event.preventDefault(); event.stopPropagation(); } catch (error) { /* ignore */ }
        if (node !== null && isAnnotatableElement(node) === true) createAnnotation(payloadForElement(node));
        else createAnnotation(payloadForPoint(event.clientX, event.clientY));
      }

      function onClick(event) {
        if (!state.active) return;
        var pin = isPinTarget(event.target);
        if (pin !== null) {
          try { event.preventDefault(); event.stopPropagation(); } catch (error) { /* ignore */ }
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          var id = '';
          try { id = pin.getAttribute('data-dsh-annotate-id') || ''; } catch (error) { id = ''; }
          if (id !== '') openEditorById(id);
          return;
        }
        if (state.editor !== null) return;
        try { event.preventDefault(); event.stopPropagation(); } catch (error) { /* ignore */ }
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      }

      function onKeyDown(event) {
        if (!state.active) return;
        if (event.isComposing === true) return;
        if (event.key !== 'Escape') return;
        try { event.preventDefault(); event.stopPropagation(); } catch (error) { /* ignore */ }
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        if (state.editor !== null) closeEditor('cancel');
        else stop();
      }

      function onPointerCancel() {
        state.region = null;
        state.down = null;
        hide(regionBox);
      }

      function installListeners() {
        if (installListeners.done === true) return;
        installListeners.done = true;
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerCancel, true);
        window.addEventListener('click', onClick, true);
        window.addEventListener('keydown', onKeyDown, true);
      }

      function dispose() {
        try {
          window.removeEventListener('pointerdown', onPointerDown, true);
          window.removeEventListener('pointermove', onPointerMove, true);
          window.removeEventListener('pointerup', onPointerUp, true);
          window.removeEventListener('pointercancel', onPointerCancel, true);
          window.removeEventListener('click', onClick, true);
          window.removeEventListener('keydown', onKeyDown, true);
        } catch (error) { /* ignore */ }
        try { if (state.editor && state.editor.el) state.editor.el.remove(); } catch (error) { /* ignore */ }
        for (var index = 0; index < state.records.length; index += 1) {
          var record = state.records[index];
          try { if (record.boxEl) record.boxEl.remove(); } catch (error) { /* ignore */ }
          try { if (record.pinEl) record.pinEl.remove(); } catch (error) { /* ignore */ }
        }
        state.records = [];
        state.editor = null;
        state.active = false;
        try { if (layer && layer.parentElement) layer.remove(); } catch (error) { /* ignore */ }
        layer = null;
        captureLayer = null;
        hoverBox = null;
        regionBox = null;
        installListeners.done = false;
        try { delete window[KEY]; } catch (error) { window[KEY] = undefined; }
      }

      function status() {
        var info = pageInfo();
        var records = [];
        for (var index = 0; index < state.records.length; index += 1) {
          var record = state.records[index];
          records.push({
            id: record.id,
            index: record.index,
            kind: record.kind,
            label: recordLabel(record),
            comment: record.comment,
            editing: record.editing === true,
            draft: record.draft === true,
          });
        }
        return {
          alive: true,
          active: state.active,
          editorOpen: state.editor !== null,
          editingId: state.editor === null ? null : state.editor.recordId,
          revision: state.revision,
          count: records.length,
          records: records,
          url: info.url,
          title: info.title,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          scroll: { x: window.scrollX, y: window.scrollY },
        };
      }

      function collect() {
        var records = [];
        for (var index = 0; index < state.records.length; index += 1) {
          var record = state.records[index];
          records.push({
            id: record.id,
            index: record.index,
            kind: record.kind,
            label: recordLabel(record),
            comment: record.comment,
            payload: record.payload,
          });
        }
        return {
          revision: state.revision,
          active: state.active,
          editorOpen: state.editor !== null,
          editingId: state.editor === null ? null : state.editor.recordId,
          records: records,
          url: pageInfo().url,
          title: pageInfo().title,
        };
      }

      function stop() {
        if (state.editor !== null) closeEditor('commit');
        state.active = false;
        state.down = null;
        state.region = null;
        hide(hoverBox);
        hide(regionBox);
        renderHud();
        if (layer) layer.style.display = 'none';
        return { ok: true };
      }

      var api = {
        version: 4,
        dispose: dispose,
        start: function (options) {
          var value = options || {};
          state.hud = value.hud || {};
          state.active = true;
          state.down = null;
          state.region = null;
          ensureLayer();
          layer.style.display = 'block';
          hide(hoverBox);
          hide(regionBox);
          installListeners();
          renderHud();
          return { ok: true };
        },
        stop: stop,
        status: status,
        pull: status,
        collect: collect,
        openEditor: openEditorById,
        closeEditor: closeEditor,
        remove: function (id) { return removeRecord(String(id)); },
        clear: function () { return clearRecords(); },
        setVisible: function (visible) {
          ensureLayer();
          layer.style.display = visible ? 'block' : 'none';
          return { ok: true };
        },
        flash: function (id) {
          var record = findRecord(String(id));
          if (record === null || !record.boxEl) return { ok: false };
          var box = record.boxEl;
          box.style.borderColor = '#f59e0b';
          box.style.backgroundColor = 'rgba(245,158,11,0.18)';
          window.setTimeout(function () {
            if (box && box.style) {
              box.style.borderColor = 'rgba(37,99,235,0.9)';
              box.style.backgroundColor = 'rgba(37,99,235,0.10)';
            }
          }, 900);
          return { ok: true };
        },
        prepareCapture: function (id) {
          var record = findRecord(String(id));
          if (record === null) return { ok: false, reason: 'missing' };
          var payload = record.payload || {};
          var rect = null;
          if (payload.kind === 'element' && payload.selector) {
            try {
              var node = document.querySelector(payload.selector);
              if (node && typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
                var nodeRect = node.getBoundingClientRect();
                rect = { x: nodeRect.left, y: nodeRect.top, width: nodeRect.width, height: nodeRect.height };
              }
            } catch (error) { rect = null; }
          }
          if (!rect && payload.docRect) {
            var docRect = payload.docRect;
            var left = Math.max(0, docRect.x + docRect.width / 2 - window.innerWidth / 2);
            var top = Math.max(0, docRect.y + docRect.height / 2 - window.innerHeight / 2);
            window.scrollTo(left, top);
            rect = { x: docRect.x - window.scrollX, y: docRect.y - window.scrollY, width: docRect.width, height: docRect.height };
          }
          if (!rect) return { ok: false, reason: 'not-found' };
          if (!(rect.width > 0) || !(rect.height > 0)) {
            rect = { x: rect.x - 100, y: rect.y - 70, width: 200, height: 140 };
          }
          return {
            ok: true,
            rect: rect,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          };
        },
      };

      window[KEY] = api;
    }

    const RUNTIME_SOURCE = '(' + runtimeMain.toString() + ')();';

    function fill(template, params) {
      if (typeof template !== 'string') return '';
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
        params && params[key] !== undefined && params[key] !== null ? String(params[key]) : match
      ));
    }

    function sleep(ms) {
      return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get() { return state; },
        set(patch) {
          const next = typeof patch === 'function' ? patch(state) : Object.assign({}, state, patch);
          if (next === state || next === undefined) return;
          state = next;
          listeners.forEach((listener) => {
            try { listener(); } catch (error) { /* ignore */ }
          });
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        },
      };
    }

    function initialState(sessionId) {
      const pending = loadPendingState(sessionId);
      return {
        open: false,
        active: false,
        editorOpen: false,
        editingId: null,
        revision: -1,
        records: [],
        hint: null,
        hintKind: 'info',
        pageUrl: '',
        pageTitle: '',
        sending: false,
        pendingCount: pending === null ? 0 : pending.items.length,
        pendingItems: pending === null ? [] : pending.items,
        pendingReports: pending === null ? [] : pending.reports,
        liveSignature: '',
        liveReportSignature: '',
        lastReport: null,
      };
    }

    function useStore(store) {
      const [value, setValue] = React.useState(store.get);
      React.useEffect(() => store.subscribe(() => setValue(store.get())), [store]);
      return value;
    }

    function cssEscape(value) {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
      return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
    }

    function visibleRect(element) {
      try {
        if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return null;
      } catch (error) { /* ignore */ }
      const rect = element.getBoundingClientRect();
      if (rect.width <= 4 || rect.height <= 4) return null;
      return rect;
    }

    const PENDING_STORAGE_PREFIX = 'dsh.web-annotation.pending.v2.';
    const LEGACY_PENDING_PREFIX = 'dsh.web-annotation.pending.';

    function sanitizePendingItems(value) {
      if (!Array.isArray(value)) return [];
      const result = [];
      for (const entry of value) {
        if (entry === null || typeof entry !== 'object') continue;
        if (typeof entry.comment !== 'string' || entry.comment.trim() === '') continue;
        result.push({
          kind: entry.kind === 'region' ? 'region' : 'element',
          label: typeof entry.label === 'string' ? entry.label : '',
          comment: entry.comment,
          url: typeof entry.url === 'string' ? entry.url : '',
          title: typeof entry.title === 'string' ? entry.title : '',
        });
      }
      return result;
    }

    function sanitizePendingReports(value) {
      if (!Array.isArray(value)) return [];
      const result = [];
      for (const entry of value) {
        if (entry === null || typeof entry !== 'object') continue;
        if (typeof entry.mdPath !== 'string' || entry.mdPath === '') continue;
        result.push({
          mdPath: entry.mdPath,
          jsonPath: typeof entry.jsonPath === 'string' ? entry.jsonPath : '',
          dir: typeof entry.dir === 'string' ? entry.dir : '',
          url: typeof entry.url === 'string' ? entry.url : '',
          title: typeof entry.title === 'string' ? entry.title : '',
          sourceFile: typeof entry.sourceFile === 'string' ? entry.sourceFile : '',
        });
      }
      return result;
    }

    function loadPendingState(sessionId) {
      try {
        if (typeof sessionId !== 'string' || sessionId === '') return null;
        try { window.localStorage.removeItem(LEGACY_PENDING_PREFIX + sessionId); } catch (error) { /* ignore */ }
        const raw = window.localStorage.getItem(PENDING_STORAGE_PREFIX + sessionId);
        if (raw === null) return null;
        const data = JSON.parse(raw);
        if (data === null || typeof data !== 'object') return null;
        const items = sanitizePendingItems(data.items);
        if (items.length === 0) return null;
        return { items: items, reports: sanitizePendingReports(data.reports) };
      } catch (error) {
        return null;
      }
    }

    function savePendingState(sessionId, items, reports) {
      try {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        if (!Array.isArray(items) || items.length === 0) {
          window.localStorage.removeItem(PENDING_STORAGE_PREFIX + sessionId);
          return;
        }
        window.localStorage.setItem(PENDING_STORAGE_PREFIX + sessionId, JSON.stringify({
          items: items,
          reports: Array.isArray(reports) ? reports : [],
        }));
      } catch (error) { /* ignore */ }
    }

    function clearPendingState(sessionId) {
      try {
        if (typeof sessionId !== 'string' || sessionId === '') return;
        window.localStorage.removeItem(PENDING_STORAGE_PREFIX + sessionId);
        window.localStorage.removeItem(LEGACY_PENDING_PREFIX + sessionId);
      } catch (error) { /* ignore */ }
    }

    function createPlugin(ctx) {
      const controller = ctx.get('sidebarRight');
      const stores = new Map();
      const composerActions = new Map();
      const liveSaveTimers = new Map();
      const liveSaveBusy = new Map();
      const focus = { element: null };

      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-web-annotation: locale');
      const t = ctx.locale.bind(LOCALE_NS);

      ctx.effect(() => {
        const style = document.createElement('style');
        style.setAttribute('data-plugin-css', 'dsh-web-annotation');
        style.textContent = CSS_TEXT;
        document.head.appendChild(style);
        return () => { style.remove(); };
      }, 'dsh-web-annotation: styles');

      ctx.effect(() => {
        const onFocusIn = (event) => {
          const target = event.target;
          if (target && target.tagName === 'WEBVIEW' && target.hasAttribute && target.hasAttribute('data-sidebar-browser-frame')) {
            focus.element = target;
          }
        };
        document.addEventListener('focusin', onFocusIn, true);
        return () => document.removeEventListener('focusin', onFocusIn, true);
      }, 'dsh-web-annotation: focus tracking');

      function storeFor(sessionId) {
        let store = stores.get(sessionId);
        if (store === undefined) {
          store = createStore(initialState(sessionId));
          stores.set(sessionId, store);
        }
        return store;
      }

      function resolveBrowserTarget(sessionId) {
        if (typeof sessionId !== 'string' || sessionId === '') return { element: null, reason: 'no-browser' };
        let root = null;
        try {
          root = document.querySelector('[data-sidebar-right-session="' + cssEscape(sessionId) + '"]');
        } catch (error) { root = null; }
        if (root === null) return { element: null, reason: 'no-browser' };
        const candidates = [];
        const views = root.querySelectorAll('webview[data-sidebar-browser-frame]');
        for (const view of views) {
          if (view.closest('[hidden]') !== null) continue;
          if (visibleRect(view) === null) continue;
          candidates.push(view);
        }
        if (candidates.length === 0) {
          const expanded = root.hasAttribute('data-sidebar-right-open') || root.querySelector('[data-sidebar-right-open]') !== null;
          return { element: null, reason: expanded ? 'no-browser' : 'collapsed' };
        }
        const focused = candidates.find((view) => view === focus.element);
        const preferred = focused || candidates[0];
        focus.element = preferred;
        return { element: preferred, reason: 'ok' };
      }

      function hudTexts() {
        return {
          editorPlaceholder: t('editor.placeholder'),
          editorDelete: t('editor.delete'),
          editorConfirm: t('editor.confirm'),
        };
      }

      function rtCall(view, expression) {
        return view.executeJavaScript('window.' + RUNTIME_KEY + ' ? window.' + RUNTIME_KEY + '.' + expression + ' : null');
      }

      async function ensureRuntime(view) {
        if (typeof view.executeJavaScript !== 'function') return false;
        let currentVersion = -1;
        try {
          currentVersion = await view.executeJavaScript('window.' + RUNTIME_KEY + ' && window.' + RUNTIME_KEY + '.version ? window.' + RUNTIME_KEY + '.version : -1');
        } catch (error) { currentVersion = -1; }
        if (currentVersion === RUNTIME_VERSION) return true;
        try {
          await view.executeJavaScript(RUNTIME_SOURCE + ';true');
        } catch (error) {
          return false;
        }
        try {
          return (await view.executeJavaScript('window.' + RUNTIME_KEY + ' && window.' + RUNTIME_KEY + '.version === ' + RUNTIME_VERSION)) === true;
        } catch (error) {
          return false;
        }
      }

      async function openMode(sessionId) {
        const store = storeFor(sessionId);
        const state = store.get();
        if (state.sending) return;
        const target = resolveBrowserTarget(sessionId);
        if (target.element === null) {
          store.set({
            open: true,
            active: false,
            editorOpen: false,
            hint: target.reason === 'collapsed' ? t('hint.collapsed') : t('hint.noBrowser'),
            hintKind: 'warn',
          });
          return;
        }
        const view = target.element;
        let pageUrl = '';
        let pageTitle = '';
        try { pageUrl = view.getURL() || ''; } catch (error) { /* ignore */ }
        try { pageTitle = view.getTitle() || ''; } catch (error) { /* ignore */ }
        const ready = await ensureRuntime(view);
        if (!ready) {
          store.set({ open: true, active: false, hint: t('hint.injectFailed'), hintKind: 'error', pageUrl, pageTitle });
          return;
        }
        try {
          await rtCall(view, 'start(' + JSON.stringify({ hud: hudTexts() }) + ')');
        } catch (error) {
          store.set({ open: true, active: false, hint: t('hint.injectFailed'), hintKind: 'error' });
          return;
        }
        store.set({
          open: true,
          active: true,
          suspended: false,
          editorOpen: false,
          editingId: null,
          revision: -1,
          records: [],
          hint: null,
          pageUrl,
          pageTitle,
        });
      }


      async function pollOnce(sessionId) {
        const store = storeFor(sessionId);
        const state = store.get();
        if (!state.open) return;
        const target = resolveBrowserTarget(sessionId);
        if (target.element === null) {
          if (state.open) {
            store.set({
              open: false,
              active: false,
              sending: false,
              editorOpen: false,
              editingId: null,
              records: [],
              revision: -1,
              hint: t('hint.pageGone'),
              hintKind: 'warn',
            });
          }
          return;
        }
        const view = target.element;
        let snapshot = null;
        try {
          snapshot = await rtCall(view, 'pull()');
        } catch (error) {
          snapshot = null;
        }
        if (snapshot === null || snapshot === undefined) {
          const ready = await ensureRuntime(view);
          if (!ready) return;
          try { snapshot = await rtCall(view, 'pull()'); } catch (error) { snapshot = null; }
          if (snapshot === null || snapshot === undefined) return;
        }
        const patch = {};
        if (typeof snapshot.url === 'string' && snapshot.url !== state.pageUrl && snapshot.url !== '') {
          patch.pageUrl = snapshot.url;
          if (state.records.length > 0) {
            patch.records = [];
            patch.revision = -1;
            patch.hint = t('hint.pageGone');
            patch.hintKind = 'warn';
          }
        }
        if (typeof snapshot.title === 'string' && snapshot.title !== '' && snapshot.title !== state.pageTitle) {
          patch.pageTitle = snapshot.title;
        }
        if (snapshot.active !== undefined && snapshot.active !== state.active) patch.active = snapshot.active;
        if (snapshot.suspended !== undefined && snapshot.suspended !== state.suspended) patch.suspended = snapshot.suspended;
        if (snapshot.editorOpen !== undefined && snapshot.editorOpen !== state.editorOpen) patch.editorOpen = snapshot.editorOpen;
        if (snapshot.editingId !== undefined && snapshot.editingId !== state.editingId) patch.editingId = snapshot.editingId;
        const changed = snapshot.revision !== state.revision;
        if (changed || state.records.length !== (snapshot.count || 0)) {
          try {
            const collected = await rtCall(view, 'collect()');
            if (collected !== null && collected !== undefined) {
              patch.records = collected.records;
              patch.revision = collected.revision;
            }
          } catch (error) { /* ignore */ }
        }
        if (Object.keys(patch).length > 0) store.set(patch);
        if (state.open === true && state.sending !== true) {
          syncPendingLive(sessionId).catch(() => { /* ignore */ });
          scheduleLiveSave(sessionId);
        }
        if (snapshot.active === false && state.open === true && state.sending !== true) {
          await finalizeAndAttach(sessionId);
        }
      }

      /** Null-rendering seat: keeps the composer write face and the runtime poll loop. */
      function BridgeView(props) {
        const sessionId = props.sessionId;
        const actions = props.inputActions;
        if (typeof sessionId === 'string' && sessionId !== '' && actions !== undefined) {
          composerActions.set(sessionId, actions);
        }
        const store = storeFor(sessionId);
        const state = useStore(store);
        React.useEffect(() => {
          if (!state.open || typeof sessionId !== 'string' || sessionId === '') return undefined;
          let disposed = false;
          const tick = () => {
            if (disposed) return;
            pollOnce(sessionId).catch(() => { /* ignore */ });
          };
          const timer = window.setInterval(tick, 250);
          tick();
          return () => {
            disposed = true;
            window.clearInterval(timer);
          };
        }, [state.open, sessionId, store]);
        return null;
      }

      function committedRecords(records) {
        if (!Array.isArray(records)) return [];
        return records.filter((record) => record !== null && record !== undefined && typeof record.comment === 'string' && record.comment.trim() !== '');
      }

      function itemFromRecord(record, pageUrl, pageTitle) {
        return {
          kind: record.kind === 'region' ? 'region' : 'element',
          label: record.label || '',
          comment: record.comment || '',
          url: pageUrl || '',
          title: pageTitle || '',
        };
      }

      /** One consolidated report text for every pending annotation, across batches. */
      function buildMergedText(items, reports) {
        const lines = [];
        lines.push('网页批注（共 ' + items.length + ' 条）');
        lines.push('');
        let lastUrl = null;
        items.forEach((item, index) => {
          if (item.url !== lastUrl) {
            if (lastUrl !== null) lines.push('');
            lines.push('页面：' + (item.title || '') + (item.url === '' ? '' : '（' + item.url + '）'));
            const sourceFile = (Array.isArray(reports) ? reports : []).find((report) => report.url === item.url && report.sourceFile !== '');
            if (sourceFile !== undefined) lines.push('页面源文件（推断）：' + sourceFile.sourceFile);
            lastUrl = item.url;
          }
          lines.push((index + 1) + '. [' + (item.kind === 'region' ? '区域' : '元素') + '] ' + (item.label || '') + '：' + item.comment);
        });
        if (Array.isArray(reports) && reports.length > 0) {
          lines.push('');
          lines.push('完整批注报告：' + reports.map((report) => report.mdPath).join('；'));
          lines.push('批注数据：' + reports.map((report) => report.jsonPath).join('；'));
          lines.push('截图目录：' + reports.map((report) => report.dir).join('；'));
        } else {
          lines.push('');
          lines.push('（报告文件未生成）');
        }
        return lines.join('\n');
      }

      async function pushPendingText(sessionId, items, reports) {
        const count = items.length;
        if (count <= 0) {
          await clearPendingChip(sessionId);
          clearPendingState(sessionId);
          return { ok: true, consumed: false, count: 0, text: '' };
        }
        const text = buildMergedText(items, reports);
        let result = { ok: false, consumed: false };
        try { result = await postPending(sessionId, text, count, false); } catch (error) { result = { ok: false, consumed: false }; }
        if (result.consumed === true) {
          await endAnnotationSession(sessionId, true);
          return { ok: false, consumed: true, count: count, text: text };
        }
        if (result.ok === true) savePendingState(sessionId, items, reports);
        return { ok: result.ok === true, consumed: false, count: count, text: text };
      }

      /** Keep the Host pending text in sync with the live committed annotations. */
      async function syncPendingLive(sessionId) {
        const store = storeFor(sessionId);
        const state = store.get();
        if (state.open !== true) return;
        const committed = committedRecords(state.records);
        const signature = (state.pageUrl || '') + '|' + committed.map((record) => record.id + ':' + record.comment).join('||');
        if (signature === state.liveSignature) return;
        const liveItems = committed.map((record) => itemFromRecord(record, state.pageUrl, state.pageTitle));
        const items = (state.pendingItems || []).concat(liveItems);
        const pushed = await pushPendingText(sessionId, items, state.pendingReports || []);
        if (pushed.consumed === true) return;
        store.set({ pendingCount: items.length, liveSignature: signature });
      }

      /** Exit annotation mode: save files, then merge this batch into the pending report. */
      async function finalizeAndAttach(sessionId) {
        const store = storeFor(sessionId);
        const state = store.get();
        if (state.sending === true) return;
        const target = resolveBrowserTarget(sessionId);
        if (target.element === null) {
          store.set({ sending: false, open: false, active: false, editorOpen: false, editingId: null, records: [], revision: -1 });
          return;
        }
        const view = target.element;
        store.set({ sending: true });
        let collected = null;
        try {
          if (state.editorOpen === true) {
            try { await rtCall(view, 'closeEditor()'); } catch (error) { /* ignore */ }
          }
          collected = await rtCall(view, 'collect()');
        } catch (error) {
          collected = null;
        }
        if (collected === null || collected === undefined || !Array.isArray(collected.records) || collected.records.length === 0) {
          try { await rtCall(view, 'clear()'); } catch (error) { /* ignore */ }
          try { await rtCall(view, 'stop()'); } catch (error) { /* ignore */ }
          store.set({ sending: false, open: false, active: false, editorOpen: false, editingId: null, records: [], revision: -1 });
          return;
        }
        let saved = null;
        try {
          const payload = await buildPayload(view, sessionId, collected);
          saved = await postReport(payload);
        } catch (error) {
          saved = null;
        }
        const newItems = collected.records.map((record) => itemFromRecord(record, collected.url, collected.title));
        const items = (state.pendingItems || []).concat(newItems);
        const reports = (state.pendingReports || []).filter((report) => report.live !== true);
        if (saved !== null && typeof saved.mdPath === 'string' && saved.mdPath !== '') {
          reports.push({
            mdPath: saved.mdPath,
            jsonPath: typeof saved.jsonPath === 'string' ? saved.jsonPath : '',
            dir: typeof saved.dir === 'string' ? saved.dir : '',
            url: typeof collected.url === 'string' ? collected.url : '',
            title: typeof collected.title === 'string' ? collected.title : '',
            sourceFile: typeof saved.sourceFile === 'string' ? saved.sourceFile : '',
          });
        }
        const pushed = await pushPendingText(sessionId, items, reports);
        try { await rtCall(view, 'clear()'); } catch (error) { /* ignore */ }
        try { await rtCall(view, 'stop()'); } catch (error) { /* ignore */ }
        if (pushed.ok !== true) {
          const fallbackText = buildMergedText(items, reports);
          const inserted = insertComposer(composerActions.get(sessionId), fallbackText);
          if (inserted !== true) {
            try { await navigator.clipboard.writeText(fallbackText); } catch (error) { /* ignore */ }
          }
          clearPendingState(sessionId);
          store.set({ sending: false, open: false, active: false, editorOpen: false, editingId: null, records: [], revision: -1, pendingCount: 0, pendingItems: [], pendingReports: [], liveSignature: '' });
          return;
        }
        store.set({
          sending: false,
          open: false,
          active: false,
          editorOpen: false,
          editingId: null,
          records: [],
          revision: -1,
          pendingCount: items.length,
          pendingItems: items,
          pendingReports: reports,
          liveSignature: '',
          liveReportSignature: '',
        });
      }

      async function postPending(sessionId, text, count, append) {
        try {
          const response = await fetch('/dsh-annotate/pending', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionId, text: text, count: count, append: append === true }),
          });
          let data = null;
          try { data = await response.json(); } catch (error) { data = null; }
          if (response.ok && data !== null && data.ok === true) return { ok: true, consumed: false };
          if (response.status === 409 && data !== null && data.error === 'consumed') return { ok: false, consumed: true };
          return { ok: false, consumed: false };
        } catch (error) {
          return { ok: false, consumed: false };
        }
      }

      async function clearPendingChip(sessionId) {
        try {
          await fetch('/dsh-annotate/pending/clear', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionId }),
          });
        } catch (error) { /* ignore */ }
      }

      /** Stop the live annotation session (optionally persisting its still-open batch first). */
      async function endAnnotationSession(sessionId, saveLive) {
        const timer = liveSaveTimers.get(sessionId);
        if (timer !== undefined) {
          window.clearTimeout(timer);
          liveSaveTimers.delete(sessionId);
        }
        const store = storeFor(sessionId);
        if (saveLive === true) {
          try { await persistLiveBatch(sessionId, false); } catch (error) { /* ignore */ }
        }
        try {
          const target = resolveBrowserTarget(sessionId);
          if (target.element !== null) {
            try { await rtCall(target.element, 'stop()'); } catch (error) { /* ignore */ }
            try { await rtCall(target.element, 'clear()'); } catch (error) { /* ignore */ }
          }
        } catch (error) { /* ignore */ }
        clearPendingState(sessionId);
        store.set({
          sending: false,
          open: false,
          active: false,
          editorOpen: false,
          editingId: null,
          records: [],
          revision: -1,
          pendingCount: 0,
          pendingItems: [],
          pendingReports: [],
          liveSignature: '',
          liveReportSignature: '',
        });
      }

      /** Debounced report save for a still-open batch, so sending mid-annotation carries files. */
      function scheduleLiveSave(sessionId) {
        if (liveSaveTimers.has(sessionId)) return;
        const timer = window.setTimeout(() => {
          liveSaveTimers.delete(sessionId);
          saveLiveReport(sessionId).catch(() => { /* ignore */ });
        }, 500);
        liveSaveTimers.set(sessionId, timer);
      }

      /** Save the current open batch as a report; publish=true also syncs the Host pending text. */
      async function persistLiveBatch(sessionId, publish) {
        const store = storeFor(sessionId);
        const state = store.get();
        if (state.open !== true || state.sending === true) return false;
        const committed = committedRecords(state.records);
        if (committed.length === 0) return false;
        const signature = (state.pageUrl || '') + '|' + committed.map((record) => record.id + ':' + record.comment).join('||');
        if (signature === state.liveReportSignature) return true;
        if (liveSaveBusy.get(sessionId) === true) {
          if (publish === true) scheduleLiveSave(sessionId);
          return false;
        }
        const target = resolveBrowserTarget(sessionId);
        if (target.element === null) return false;
        const view = target.element;
        liveSaveBusy.set(sessionId, true);
        try {
          let collected = null;
          try { collected = await rtCall(view, 'collect()'); } catch (error) { collected = null; }
          if (collected === null || collected === undefined || !Array.isArray(collected.records)) return false;
          const records = committedRecords(collected.records);
          if (records.length === 0) return false;
          const pageUrl = typeof collected.url === 'string' && collected.url !== '' ? collected.url : state.pageUrl;
          const pageTitle = typeof collected.title === 'string' ? collected.title : state.pageTitle;
          let saved = null;
          try {
            const payload = await buildPayload(view, sessionId, { url: pageUrl, title: pageTitle, records: records });
            saved = await postReport(payload);
          } catch (error) {
            saved = null;
          }
          if (saved === null || typeof saved.mdPath !== 'string' || saved.mdPath === '') return false;
          const fresh = store.get();
          if (fresh.open !== true) return false;
          store.set({ liveReportSignature: signature });
          if (publish !== true || fresh.sending === true) return true;
          const entry = {
            mdPath: saved.mdPath,
            jsonPath: typeof saved.jsonPath === 'string' ? saved.jsonPath : '',
            dir: typeof saved.dir === 'string' ? saved.dir : '',
            url: pageUrl,
            title: pageTitle,
            sourceFile: typeof saved.sourceFile === 'string' ? saved.sourceFile : '',
            live: true,
          };
          const reports = (fresh.pendingReports || []).filter((report) => report.live !== true).concat([entry]);
          const liveItems = committedRecords(fresh.records).map((record) => itemFromRecord(record, fresh.pageUrl, fresh.pageTitle));
          const items = (fresh.pendingItems || []).concat(liveItems);
          const pushed = await pushPendingText(sessionId, items, reports);
          if (pushed.consumed === true) return false;
          store.set({
            pendingReports: reports,
            pendingCount: items.length,
            liveReportSignature: signature,
            liveSignature: signature,
          });
          return true;
        } catch (error) {
          return false;
        } finally {
          liveSaveBusy.delete(sessionId);
        }
      }

      async function saveLiveReport(sessionId) {
        await persistLiveBatch(sessionId, true);
      }

      async function captureAnnotation(view, id) {
        if (typeof view.capturePage !== 'function') return null;
        let prepared = null;
        try {
          prepared = await rtCall(view, 'prepareCapture(' + JSON.stringify(id) + ')');
        } catch (error) {
          return null;
        }
        if (prepared === null || prepared === undefined || prepared.ok !== true || !prepared.rect) return null;
        const viewport = prepared.viewport || { width: 0, height: 0 };
        const padding = 10;
        const x = Math.max(0, Math.floor(prepared.rect.x - padding));
        const y = Math.max(0, Math.floor(prepared.rect.y - padding));
        const rightLimit = viewport.width > 0 ? viewport.width : prepared.rect.x + prepared.rect.width + padding;
        const bottomLimit = viewport.height > 0 ? viewport.height : prepared.rect.y + prepared.rect.height + padding;
        const right = Math.max(x + 1, Math.min(rightLimit, Math.ceil(prepared.rect.x + prepared.rect.width + padding)));
        const bottom = Math.max(y + 1, Math.min(bottomLimit, Math.ceil(prepared.rect.y + prepared.rect.height + padding)));
        const width = Math.floor(right - x);
        const height = Math.floor(bottom - y);
        if (width < 4 || height < 4) return null;
        await sleep(140);
        try {
          const image = await view.capturePage({ x, y, width, height });
          if (image && typeof image.toDataURL === 'function') return image.toDataURL();
        } catch (error) {
          return null;
        }
        return null;
      }

      async function buildPayload(view, sessionId, collected) {
        const annotations = collected.records.map((record) => ({
          kind: record.kind,
          label: record.label,
          comment: record.comment,
          selector: record.payload.selector || '',
          tag: record.payload.tag || '',
          text: record.payload.text || '',
          html: record.payload.html || '',
          hints: record.payload.hints || {},
          styles: record.payload.styles || {},
          rect: record.payload.rect || null,
          docRect: record.payload.docRect || null,
          elements: record.payload.elements || null,
          image: null,
        }));
        try { await rtCall(view, 'setVisible(false)'); } catch (error) { /* ignore */ }
        try {
          for (let index = 0; index < collected.records.length; index += 1) {
            const image = await captureAnnotation(view, collected.records[index].id);
            if (image !== null) annotations[index].image = image;
          }
        } finally {
          try { await rtCall(view, 'setVisible(true)'); } catch (error) { /* ignore */ }
        }
        return {
          sessionId,
          page: { url: collected.url, title: collected.title },
          annotations,
        };
      }

      async function postReport(payload) {
        const response = await fetch(SAVE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        let data = null;
        try { data = await response.json(); } catch (error) { /* ignore */ }
        if (!response.ok || data === null || data.ok !== true) {
          const reason = data && data.error ? data.error : 'HTTP ' + response.status;
          throw new Error(reason);
        }
        return data;
      }

      function insertComposer(inputActions, text) {
        if (!inputActions || typeof inputActions.insertText !== 'function') return false;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const span = typeof inputActions.captureInsertion === 'function' ? inputActions.captureInsertion() : undefined;
            if (inputActions.insertText(text, span) === true) return true;
          } catch (error) { /* retry */ }
        }
        return false;
      }



      function penMark() {
        return h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
          h('path', {
            d: 'M4.8 19.2l1-4.2L16 4.8a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.9 18.2l-4.1 1z',
            fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linejoin': 'round',
          }),
          h('path', { d: 'M13.9 6.9l3.2 3.2', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round' }));
      }

      function iconMark() {
        return h('svg', { viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' },
          h('rect', { x: '6', y: '10', width: '52', height: '40', rx: '6', fill: 'none', stroke: 'currentColor', 'stroke-width': '5' }),
          h('path', { d: 'M14 19h28M14 28h18', stroke: 'currentColor', 'stroke-width': '5', 'stroke-linecap': 'round' }),
          h('rect', { x: '30', y: '31', width: '20', height: '14', rx: '4', fill: 'currentColor' }),
          h('circle', { cx: '48', cy: '14', r: '7', fill: '#f59e0b' }));
      }

      /** Locate the open right-Sidebar strip and whether a loaded browser page is visible in it. */
      function findChromeTarget() {
        const panels = document.querySelectorAll('[data-sidebar-right-session][data-sidebar-right-open]');
        for (const panel of panels) {
          const sessionId = panel.getAttribute('data-sidebar-right-session');
          if (typeof sessionId !== 'string' || sessionId === '') continue;
          const panelRect = panel.getBoundingClientRect();
          if (panelRect.width <= 0 || panelRect.height <= 0) continue;
          const strip = panel.querySelector('[data-dockkit-strip]');
          if (strip === null) continue;
          let pageVisible = false;
          const views = panel.querySelectorAll('webview[data-sidebar-browser-frame]');
          for (const view of views) {
            const viewRect = view.getBoundingClientRect();
            if (viewRect.width <= 4 || viewRect.height <= 4) continue;
            let url = '';
            try { url = view.getURL() || ''; } catch (error) { url = ''; }
            if (url !== '' && url.startsWith('about:') !== true) { pageVisible = true; break; }
          }
          return { strip: strip, sessionId: sessionId, pageVisible: pageVisible };
        }
        return null;
      }

      /**
       * The annotation entry control lives in the right-Sidebar strip, before the
       * split control. The shipped sidebar declares no extension seat for its strip
       * chrome, so this component owns one foreign-DOM child it inserts and keeps
       * re-anchored; it disappears when no browser page is open in the column.
       */
      function ChromeView() {
        React.useEffect(() => {
          const container = document.createElement('div');
          container.setAttribute('data-web-annotation-chrome', '');
          container.style.display = 'none';
          container.style.alignItems = 'center';
          container.style.flex = 'none';
          container.style.position = 'relative';
          try { container.style.setProperty('-webkit-app-region', 'no-drag'); } catch (error) { /* ignore */ }
          const badge = document.createElement('span');
          badge.style.cssText = 'position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#2563eb;color:#fff;font:600 9px/14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;pointer-events:none;display:none;box-sizing:border-box';
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'dsh-ann-chrome-btn';
          button.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M6.3 4.1 L19.4 11.3 L13.2 12.7 L10.4 19.4 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>';
          container.appendChild(button);
          container.appendChild(badge);

          let currentSession = null;
          let currentStore = null;
          let unsubscribe = null;

          const updateButton = () => {
            const state = currentStore === null ? null : currentStore.get();
            const open = state !== null && state.open === true;
            const sending = state !== null && state.sending === true;
            const count = state === null ? 0 : (open === true
              ? (Array.isArray(state.records) ? state.records.length : 0)
              : (state.pendingCount || 0));
            button.classList.toggle('is-active', open);
            button.disabled = sending;
            const label = open ? t('chrome.exit') : t('chrome.enter');
            button.title = label;
            button.setAttribute('aria-label', label);
            button.setAttribute('aria-pressed', open ? 'true' : 'false');
            badge.textContent = count > 0 ? String(count) : '';
            badge.style.display = count > 0 ? 'block' : 'none';
          };
          const onPointerDown = (event) => { event.stopPropagation(); };
          const onClick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const sessionId = currentSession;
            if (sessionId === null || currentStore === null) return;
            const state = currentStore.get();
            if (state.sending) return;
            if (state.open === true) {
              finalizeAndAttach(sessionId).catch(() => { /* ignore */ });
            } else {
              openMode(sessionId).catch(() => { /* ignore */ });
            }
          };
          button.addEventListener('pointerdown', onPointerDown, true);
          button.addEventListener('click', onClick, true);

          const sync = () => {
            const target = findChromeTarget();
            if (target === null) {
              container.style.display = 'none';
              return;
            }
            const store = storeFor(target.sessionId);
            const open = store.get().open === true;
            if (!target.pageVisible && !open) {
              container.style.display = 'none';
              return;
            }
            if (container.parentElement !== target.strip) {
              const split = target.strip.querySelector('[data-dockkit-split-button]');
              let anchor = split;
              while (anchor !== null && anchor.parentElement !== null && anchor.parentElement !== target.strip) anchor = anchor.parentElement;
              if (anchor !== null && anchor.parentElement === target.strip) target.strip.insertBefore(container, anchor);
              else target.strip.insertBefore(container, target.strip.firstChild);
            }
            container.style.display = 'inline-flex';
            if (currentSession !== target.sessionId || currentStore !== store) {
              currentSession = target.sessionId;
              currentStore = store;
              if (unsubscribe !== null) unsubscribe();
              unsubscribe = store.subscribe(updateButton);
            }
            updateButton();
          };
          const timer = window.setInterval(sync, 400);
          sync();
          return () => {
            window.clearInterval(timer);
            if (unsubscribe !== null) unsubscribe();
            button.removeEventListener('pointerdown', onPointerDown, true);
            button.removeEventListener('click', onClick, true);
            container.remove();
          };
        }, []);
        return null;
      }

      /** The composer-side attachment chip: one per pending annotation batch. */
      function ChipView(props) {
        const sessionId = props.sessionId;
        const store = storeFor(sessionId);
        const state = useStore(store);
        const count = state.pendingCount;
        const rowRef = React.useRef(null);
        const chipRef = React.useRef(null);

        React.useEffect(() => {
          if (typeof sessionId !== 'string' || sessionId === '') return undefined;
          const initial = store.get();
          if (Array.isArray(initial.pendingItems) && initial.pendingItems.length > 0) {
            pushPendingText(sessionId, initial.pendingItems, initial.pendingReports || []).catch(() => { /* ignore */ });
          }
          let disposed = false;
          const tick = async () => {
            if (disposed) return;
            try {
              const response = await fetch('/dsh-annotate/pending?sessionId=' + encodeURIComponent(sessionId));
              if (!response.ok) return;
              const data = await response.json();
              if (disposed || data === null || typeof data.count !== 'number') return;
              if (data.consumed === true) {
                endAnnotationSession(sessionId, true).catch(() => { /* ignore */ });
                return;
              }
              const current = store.get();
              if (data.count === current.pendingCount) return;
              if (data.count <= 0) {
                clearPendingState(sessionId);
                store.set({ pendingCount: 0, pendingItems: [], pendingReports: [], liveSignature: '' });
                return;
              }
              store.set({ pendingCount: data.count });
            } catch (error) { /* ignore */ }
          };
          const timer = window.setInterval(tick, 1500);
          tick();
          return () => {
            disposed = true;
            window.clearInterval(timer);
          };
        }, [sessionId, store]);

        React.useEffect(() => {
          const row = rowRef.current;
          if (row === null) return undefined;
          const align = () => {
            try {
              const cards = Array.from(document.querySelectorAll('[data-composer-card]'));
              let card = null;
              for (const candidate of cards) {
                const rect = candidate.getBoundingClientRect();
                if (rect.width > 40 && rect.height > 20) { card = candidate; break; }
              }
              if (card === null) { row.style.paddingLeft = ''; return; }
              const cardRect = card.getBoundingClientRect();
              const rowRect = row.getBoundingClientRect();
              const offset = Math.max(0, Math.round(cardRect.left - rowRect.left));
              row.style.paddingLeft = offset + 'px';
              if (chipRef.current !== null) {
                chipRef.current.style.maxWidth = Math.max(140, Math.round(cardRect.width)) + 'px';
              }
            } catch (error) { /* ignore */ }
          };
          align();
          const timer = window.setInterval(align, 700);
          window.addEventListener('resize', align);
          return () => {
            window.clearInterval(timer);
            window.removeEventListener('resize', align);
          };
        }, [count]);

        if (typeof sessionId !== 'string' || sessionId === '' || count <= 0) return null;
        return h('div', { className: 'dsh-ann-chip-row', ref: rowRef },
          h('div', { className: 'dsh-ann-chip', ref: chipRef, title: t('chip.title') },
            penMark(),
            h('span', { className: 'dsh-ann-chip-label' }, fill(t('chip.label'), { count: count })),
            h('button', {
              type: 'button',
              className: 'dsh-ann-chip-remove',
              title: t('chip.remove'),
              'aria-label': t('chip.remove'),
              onClick: () => {
                clearPendingChip(sessionId).catch(() => { /* ignore */ });
                endAnnotationSession(sessionId, false).catch(() => { /* ignore */ });
              },
            }, '×')));
      }

      function apply(ctx) {
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'web-annotation-chrome',
          order: 40,
        }, ChromeView)), 'dsh-web-annotation: chrome control');
        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'web-annotation-composer-bridge',
          order: 16,
        }, BridgeView)), 'dsh-web-annotation: composer bridge');
        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'web-annotation-chip',
          order: 17,
        }, ChipView)), 'dsh-web-annotation: composer chip');
      }

      return { apply };
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight'],
      apply(ctx) {
        createPlugin(ctx).apply(ctx);
      },
    };
  },
});
