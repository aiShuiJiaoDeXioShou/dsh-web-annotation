/**
 * Offline sanity harness for the annotation runtime embedded in client.js.
 *
 * It extracts runtimeMain() from the client bundle and drives it against a
 * minimal DOM stub: click/blank/region gestures, inline editor keyboard
 * behavior, pin reopen, deletion, capture preparation and teardown.
 *
 * Run with: node tests/runtime-harness.cjs   (or: npm test)
 */
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2] || path.join(__dirname, '..', 'client.js');
const source = fs.readFileSync(file, 'utf8');
const start = source.indexOf('function runtimeMain()');
const end = source.indexOf('\n    const RUNTIME_SOURCE =', start);
if (start < 0 || end < 0) {
  console.error('FAIL: could not locate runtimeMain');
  process.exit(1);
}
let body = source.slice(start, end).replace(/\s+$/u, '');
if (!body.endsWith('}')) {
  console.error('FAIL: runtimeMain slice incomplete');
  process.exit(1);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: ok === true });
  console.log(`${ok === true ? 'PASS' : 'FAIL'} ${name}${ok === true ? '' : ` :: ${JSON.stringify(detail)}`}`);
}

function makeElement(tag) {
  const attributes = {};
  const element = {
    tagName: String(tag || 'div').toUpperCase(),
    nodeType: 1,
    id: '',
    style: {},
    value: '',
    placeholder: '',
    children: [],
    parentElement: null,
    isConnected: false,
    innerText: '',
    textContent: '',
    outerHTML: '<div></div>',
    scrollHeight: 42,
    offsetWidth: 260,
    offsetHeight: 84,
    classList: { length: 0 },
    handlers: {},
    setAttribute(key, value) { attributes[key] = String(value); },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(attributes, key); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(attributes, key) ? attributes[key] : null; },
    appendChild(child) { this.children.push(child); child.parentElement = this; child.isConnected = true; return child; },
    contains(target) {
      if (target === this) return true;
      for (const child of this.children) if (child.contains && child.contains(target)) return true;
      return false;
    },
    remove() {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
      this.isConnected = false;
    },
    addEventListener(type, handler) { (this.handlers[type] = this.handlers[type] || []).push(handler); },
    dispatch(type, event) {
      for (const handler of this.handlers[type] || []) handler(event);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    getBoundingClientRect() { return { left: 12, top: 20, width: 120, height: 32 }; },
    scrollIntoView() {},
    focus() {},
    setSelectionRange() {},
  };
  return element;
}

const created = [];
const documentElement = makeElement('html');
const bodyElement = makeElement('body');
const targetElement = makeElement('button');
targetElement.innerText = '主操作按钮';
targetElement.textContent = '主操作按钮';

const documentShim = {
  documentElement,
  body: bodyElement,
  head: makeElement('head'),
  title: '离屏测试页',
  createElement: (tag) => { const element = makeElement(tag); created.push(element); return element; },
  querySelectorAll: () => [],
  querySelector: () => null,
  elementFromPoint: () => targetElement,
  addEventListener() {},
  removeEventListener() {},
};

const windowListeners = new Map();
const windowShim = {
  document: documentShim,
  location: { href: 'http://127.0.0.1:8123/annotation-demo/ui-preview.html' },
  innerWidth: 430,
  innerHeight: 900,
  scrollX: 0,
  scrollY: 120,
  setTimeout: (fn) => setTimeout(fn, 0),
  clearTimeout: (id) => clearTimeout(id),
  addEventListener(type, handler) { if (!windowListeners.has(type)) windowListeners.set(type, []); windowListeners.get(type).push(handler); },
  removeEventListener() {},
  getComputedStyle: () => ({
    color: 'rgb(27, 29, 34)', backgroundColor: 'rgb(49, 85, 198)', fontSize: '14px', fontWeight: '400',
    border: '0px none rgb(0, 0, 0)', borderRadius: '9px', padding: '0px 16px', margin: '0px',
    display: 'inline-block', width: '104px', height: '34px', lineHeight: '20px', textAlign: 'center', opacity: '1', gap: 'normal',
  }),
  CSS: { escape: (value) => String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1') },
  scrollTo: (x, y) => { windowShim.scrollX = x; windowShim.scrollY = y; },
};

global.window = windowShim;
global.document = documentShim;
global.location = windowShim.location;

new Function('window', 'document', `return (${body})();`)(windowShim, documentShim);
const api = windowShim.__DSH_WEB_ANNOTATE__;
check('runtime registered', api !== undefined && api !== null);
if (!api) process.exit(1);
check('runtime version 4', api.version === 4, api.version);

function fireWindow(type, event) {
  for (const handler of windowListeners.get(type) || []) handler(event);
}
function baseEvent(extra) {
  return Object.assign({
    preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
    isComposing: false, shiftKey: false, key: '', code: '',
  }, extra);
}
function lastTextarea() {
  for (let index = created.length - 1; index >= 0; index -= 1) {
    if (created[index].tagName === 'TEXTAREA') return created[index];
  }
  return null;
}
function findPin(id) {
  return created.find((element) => element.getAttribute('data-dsh-annotate') === 'pin' && element.getAttribute('data-dsh-annotate-id') === id) || null;
}
function commitEditor(text) {
  const textarea = lastTextarea();
  if (!textarea) return false;
  if (text !== undefined) textarea.value = text;
  textarea.dispatch('keydown', baseEvent({ key: 'Enter', code: 'Enter' }));
  return true;
}

check('start ok', api.start({ hud: { element: 'x', hint: 'y', editing: 'e', suspended: 's', editorPlaceholder: 'p', editorHint: 'h' } }).ok === true);
let snapshot = api.status();
check('active after start', snapshot.active === true && snapshot.editorOpen === false, snapshot);

// click selects an element and opens the inline editor with a draft annotation
fireWindow('pointerdown', baseEvent({ clientX: 40, clientY: 60 }));
fireWindow('pointermove', baseEvent({ clientX: 40, clientY: 60 }));
fireWindow('pointerup', baseEvent({ clientX: 40, clientY: 60 }));
snapshot = api.status();
check('click created a draft annotation', snapshot.count === 1, snapshot);
check('inline editor opened', snapshot.editorOpen === true && snapshot.editingId === 'a1', snapshot);
check('draft record has an element payload kind', snapshot.records[0] && snapshot.records[0].kind === 'element', snapshot.records[0]);

// Enter commits the note
check('textarea exists', lastTextarea() !== null);
commitEditor('主按钮颜色太浅，换成深一点的品牌蓝');
snapshot = api.status();
check('Enter saved the note', snapshot.editorOpen === false && snapshot.records[0].comment.includes('品牌蓝'), snapshot.records[0]);
check('record is no longer a draft', snapshot.records[0] && snapshot.records[0].draft === false, snapshot.records[0]);

// collect carries the full payload
let collected = api.collect();
check('collect returns payload', collected.records.length === 1 && typeof collected.records[0].payload.selector === 'string' && collected.records[0].payload.selector.length > 0, collected.records[0] && collected.records[0].payload.selector);

const prepared = api.prepareCapture('a1');
check('prepareCapture ok', prepared && prepared.ok === true && prepared.rect && prepared.rect.width === 120, prepared);

// clicking the pin reopens the editor and edits the saved note
const pin = findPin('a1');
check('pin rendered with record id', pin !== null);
fireWindow('click', baseEvent({ target: pin }));
snapshot = api.status();
check('pin click reopens editor', snapshot.editorOpen === true && snapshot.editingId === 'a1', snapshot);
commitEditor('改成深蓝 #1d4ed8');
snapshot = api.status();
check('pin edit updated the note', snapshot.records[0].comment.includes('#1d4ed8'), snapshot.records[0]);

// Clicking blank space creates a free point annotation
const originalFromPoint = documentShim.elementFromPoint;
documentShim.elementFromPoint = () => null;
fireWindow('pointerdown', baseEvent({ clientX: 300, clientY: 400 }));
fireWindow('pointerup', baseEvent({ clientX: 300, clientY: 400 }));
documentShim.elementFromPoint = originalFromPoint;
const pointStatus = api.status();
check('blank click creates a point annotation', pointStatus.count === 2 && pointStatus.records[1].label === '「点击位置」' && pointStatus.records[1].kind === 'element', pointStatus.records);
api.closeEditor('commit');
const afterPoint = api.status();
check('empty point annotation discarded', afterPoint.count === 1, afterPoint.records);

// drag becomes a region annotation; an empty note discards it
fireWindow('pointerdown', baseEvent({ clientX: 20, clientY: 30 }));
fireWindow('pointermove', baseEvent({ clientX: 220, clientY: 180 }));
fireWindow('pointerup', baseEvent({ clientX: 240, clientY: 200 }));
snapshot = api.status();
check('drag created a region annotation', snapshot.count === 2 && snapshot.records[1].kind === 'region', snapshot.records);
api.closeEditor('commit');
snapshot = api.status();
check('empty region note discarded', snapshot.count === 1, snapshot.records);

// outside pointerdown commits an open editor
api.openEditor('a1');
check('openEditor reopens', api.status().editorOpen === true);
const textarea = lastTextarea();
if (textarea) textarea.value = '外部点击保存';
fireWindow('pointerdown', baseEvent({ target: targetElement, clientX: 5, clientY: 5 }));
snapshot = api.status();
check('outside click closes editor', snapshot.editorOpen === false, snapshot);
check('outside click saved text', snapshot.records[0].comment === '外部点击保存', snapshot.records[0]);

// remove / clear / stop
api.remove('a1');
check('remove works', api.status().count === 0);
api.start({ hud: {} });
fireWindow('pointerdown', baseEvent({ clientX: 40, clientY: 60 }));
fireWindow('pointerup', baseEvent({ clientX: 40, clientY: 60 }));
check('annotation created again', api.status().count === 1);
api.clear();
check('clear works', api.status().count === 0);
api.stop();
check('stop leaves idle', api.status().active === false);

const failed = checks.filter((entry) => entry.ok !== true);
console.log(`\n${failed.length === 0 ? 'ALL PASS' : 'FAILURES: ' + failed.length} (${checks.length} checks)`);
process.exit(failed.length === 0 ? 0 : 1);

