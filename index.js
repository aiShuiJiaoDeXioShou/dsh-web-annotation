/**
 * Host half of the Web Page Annotations bundle.
 *
 * The Client half collects annotations from the right-Sidebar Browser tab and
 * posts them here. This half persists the raw data, the cropped screenshots and
 * a human/model readable Markdown report under `$DSH_HOME/annotations/...`, and
 * keeps the latest batch as pending context that the next sent user message
 * carries automatically.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SAVE_PATH = '/dsh-annotate/save';
const STATUS_PATH = '/dsh-annotate/status';
const PENDING_PATH = '/dsh-annotate/pending';
const PENDING_CLEAR_PATH = '/dsh-annotate/pending/clear';
const MAX_BODY_BYTES = 48 * 1024 * 1024;
const MAX_ANNOTATIONS = 40;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_CHARS = 40000;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', '0.0.0.0']);

export const inject = ['webServer'];

export function apply(ctx, config) {
  const root = annotationRoot(config);
  /** One pending annotation batch per Session, waiting for the next sent message. */
  const pending = new Map();
  /** Sessions whose pending batch was just folded into a sent message: blocks stale re-posts. */
  const consumed = new Map();
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SAVE_PATH,
    handler: (req, res) => {
      handleSave(ctx, req, res, root).catch((error) => {
        respond(res, 500, { ok: false, error: messageOf(error) });
      });
    },
  }), 'dsh-web-annotation: save route');
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: (req, res) => {
      respond(res, 200, { ok: true, plugin: 'web-annotation', root, pid: process.pid });
    },
  }), 'dsh-web-annotation: status route');
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PENDING_PATH,
    handler: (req, res) => {
      handlePending(req, res, pending, consumed).catch((error) => {
        respond(res, 500, { ok: false, error: messageOf(error) });
      });
    },
  }), 'dsh-web-annotation: pending route');
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PENDING_CLEAR_PATH,
    handler: (req, res) => {
      handlePendingClear(req, res, pending, consumed).catch((error) => {
        respond(res, 500, { ok: false, error: messageOf(error) });
      });
    },
  }), 'dsh-web-annotation: pending clear route');
  ctx.effect(() => ctx.on('agent/pre-step', (payload, next) => handlePreStep(pending, consumed, payload, next)), 'dsh-web-annotation: pre-step attach');
  ctx.effect(() => ctx.on('agent/turn-stopping', (payload) => {
    clearPendingFor(pending, payload);
  }), 'dsh-web-annotation: turn cleanup');
  ctx.effect(() => ctx.on('agent/error', (payload) => {
    clearPendingFor(pending, payload);
  }), 'dsh-web-annotation: error cleanup');
  ctx.effect(() => ctx.on('agent/disposed', (payload) => {
    clearPendingFor(pending, payload);
  }), 'dsh-web-annotation: dispose cleanup');
}

function isRecentlyConsumed(consumed, sessionId, windowMs) {
  try {
    const at = consumed === undefined || consumed === null ? undefined : consumed.get(sessionId);
    if (typeof at !== 'number') return false;
    const age = Date.now() - at;
    return age >= 0 && age < windowMs;
  } catch (error) {
    return false;
  }
}

function clearPendingFor(pending, payload) {
  try {
    const agentId = payload && payload.agent ? String(payload.agent.id) : '';
    if (agentId !== '') pending.delete(agentId);
  } catch (error) { /* ignore */ }
}

/**
 * Waterfall: fold a pending annotation batch into the visible user message that
 * enters the step. The agent loop commits exactly the messages returned by the
 * decision, so extending the user message content here makes the annotation part
 * of the durable user message itself. The plugin therefore never appends to the
 * session log on its own: identity, validation and persistence stay with the
 * loop, and the chat renders the annotation like any other message text.
 */
async function handlePreStep(pending, consumed, payload, next) {
  const decision = await next();
  try {
    if (decision === null || decision === undefined || decision.kind !== 'enter' || !Array.isArray(decision.messages)) return decision;
    const agentId = payload && payload.agent ? String(payload.agent.id) : '';
    const item = agentId === '' ? undefined : pending.get(agentId);
    if (item === undefined) return decision;
    if (item.applied === true) return decision;
    const messages = decision.messages.slice();
    let index = -1;
    for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
      const message = messages[cursor];
      if (message !== null && message !== undefined && message.role === 'user'
        && message.source !== null && message.source !== undefined && message.source.kind === 'user') {
        index = cursor;
        break;
      }
    }
    if (index < 0) return decision;
    const message = messages[index];
    const content = Array.isArray(message.content) ? message.content : [];
    if (content.some((block) => block !== null && block !== undefined && typeof block.text === 'string' && block.text.includes('【网页批注】'))) {
      item.applied = true;
      try { pending.delete(agentId); } catch (error) { /* ignore */ }
      return decision;
    }
    messages[index] = Object.assign({}, message, {
      content: content.concat([{ type: 'text', text: '\n\n【网页批注】\n' + item.text }]),
    });
    item.applied = true;
    try { pending.delete(agentId); } catch (error) { /* ignore */ }
    try { consumed.set(agentId, Date.now()); } catch (error) { /* ignore */ }
    return Object.assign({}, decision, { messages });
  } catch (error) {
    return decision;
  }
}

async function handlePending(req, res, pending, consumed) {
  if (req.method === 'GET') {
    let sessionId = '';
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      sessionId = url.searchParams.get('sessionId') || '';
    } catch (error) {
      sessionId = '';
    }
    if (!isSessionId(sessionId)) {
      respond(res, 400, { ok: false, error: 'invalid-session' });
      return;
    }
    const item = pending.get(sessionId);
    respond(res, 200, {
      ok: true,
      count: item === undefined ? 0 : item.count,
      consumed: isRecentlyConsumed(consumed, sessionId, 15000),
    });
    return;
  }
  if (req.method !== 'POST') {
    respond(res, 405, { ok: false, error: 'method-not-allowed' });
    return;
  }
  const raw = await readBody(req, 1024 * 1024);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    respond(res, 400, { ok: false, error: 'invalid-json' });
    return;
  }
  if (body === null || typeof body !== 'object') {
    respond(res, 400, { ok: false, error: 'invalid-payload' });
    return;
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!isSessionId(sessionId)) {
    respond(res, 400, { ok: false, error: 'invalid-session' });
    return;
  }
  // A batch was just attached to a sent message: refuse stale re-posts from the
  // still-open annotation session instead of queuing the same notes again.
  if (isRecentlyConsumed(consumed, sessionId, 8000)) {
    respond(res, 409, { ok: false, error: 'consumed' });
    return;
  }
  const count = Math.max(0, Math.floor(Number(body.count) || 0));
  const text = clipText(typeof body.text === 'string' ? body.text : '', MAX_PENDING_CHARS);
  if (count <= 0 || text === '') {
    respond(res, 400, { ok: false, error: 'empty-annotations' });
    return;
  }
  const current = pending.get(sessionId);
  if (body.append === true && current !== undefined) {
    current.text = clipText(current.text + '\n\n' + text, MAX_PENDING_CHARS);
    current.count += count;
    if (consumed !== undefined && consumed !== null) consumed.delete(sessionId);
    respond(res, 200, { ok: true, count: current.count });
    return;
  }
  pending.set(sessionId, { text, count });
  if (consumed !== undefined && consumed !== null) consumed.delete(sessionId);
  respond(res, 200, { ok: true, count });
}

async function handlePendingClear(req, res, pending, consumed) {
  if (req.method !== 'POST') {
    respond(res, 405, { ok: false, error: 'method-not-allowed' });
    return;
  }
  const raw = await readBody(req, 1024 * 1024);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    respond(res, 400, { ok: false, error: 'invalid-json' });
    return;
  }
  const sessionId = body !== null && typeof body === 'object' && typeof body.sessionId === 'string' ? body.sessionId : '';
  if (!isSessionId(sessionId)) {
    respond(res, 400, { ok: false, error: 'invalid-session' });
    return;
  }
  pending.delete(sessionId);
  if (consumed !== undefined && consumed !== null) consumed.delete(sessionId);
  respond(res, 200, { ok: true, count: 0 });
}

function isSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,120}$/u.test(value);
}

/** Resolve the durable annotation root; `config.annotationsRoot` wins when set. */
function annotationRoot(config) {
  const configured = config && typeof config.annotationsRoot === 'string' ? config.annotationsRoot.trim() : '';
  if (configured !== '') return path.resolve(configured);
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh');
  return path.join(home, 'annotations');
}

async function handleSave(ctx, req, res, root) {
  try {
    if (req.method !== 'POST') {
      respond(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    const raw = await readBody(req, MAX_BODY_BYTES);
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      respond(res, 400, { ok: false, error: 'invalid-json' });
      return;
    }
    if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.annotations)) {
      respond(res, 400, { ok: false, error: 'invalid-payload' });
      return;
    }
    const result = await persistReport(ctx, root, payload);
    respond(res, 200, { ok: true, ...result });
  } catch (error) {
    respond(res, 500, { ok: false, error: messageOf(error) });
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('annotation payload is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function persistReport(ctx, root, payload) {
  const sessionId = safeId(payload.sessionId);
  const page = normalizePage(payload.page);
  const annotations = normalizeAnnotations(payload.annotations);
  const createdAt = new Date();
  const stamp = createdAt.toISOString().replace(/[:.]/gu, '-').slice(0, 19);
  const dir = path.join(root, sessionId, stamp);
  await fs.mkdir(dir, { recursive: true });

  const workspace = findWorkspacePath(ctx, sessionId);
  const inferred = inferSourcePath(workspace, page.url);
  const sourceFile = inferred === undefined ? undefined : await existingFile(inferred, workspace);

  const images = [];
  for (let index = 0; index < annotations.length; index += 1) {
    const annotation = annotations[index];
    const decoded = decodeImage(annotation.image);
    if (decoded === null) continue;
    const name = `${String(index + 1).padStart(2, '0')}.${decoded.ext}`;
    await fs.writeFile(path.join(dir, name), decoded.buffer);
    images.push(name);
    annotation.imageFile = name;
  }

  const report = buildMarkdown({ createdAt, page, sourceFile, annotations, sessionId });
  const mdPath = path.join(dir, 'report.md');
  const jsonPath = path.join(dir, 'annotations.json');
  await fs.writeFile(mdPath, report, 'utf8');
  const data = {
    createdAt: createdAt.toISOString(),
    sessionId,
    page,
    sourceFile: sourceFile === undefined ? null : sourceFile,
    annotations: annotations.map((annotation) => ({
      ...annotation,
      image: undefined,
    })),
    files: images,
  };
  await fs.writeFile(jsonPath, JSON.stringify(data, null, 2), 'utf8');

  return {
    dir,
    mdPath,
    jsonPath,
    annotationCount: annotations.length,
    imageCount: images.length,
    sourceFile: sourceFile === undefined ? null : sourceFile,
    composerText: buildComposerText({ page, sourceFile, annotations, mdPath, jsonPath, dir }),
  };
}

function normalizePage(page) {
  const value = page !== null && typeof page === 'object' ? page : {};
  return {
    url: clipText(value.url, 4096),
    title: clipText(value.title, 300),
  };
}

function normalizeAnnotations(list) {
  const result = [];
  for (const entry of list.slice(0, MAX_ANNOTATIONS)) {
    if (entry === null || typeof entry !== 'object') continue;
    const kind = entry.kind === 'region' ? 'region' : 'element';
    const normalized = {
      kind,
      label: clipText(entry.label, 200),
      comment: clipText(entry.comment, 4000),
      selector: clipText(entry.selector, 1000),
      tag: clipText(entry.tag, 60),
      text: clipText(entry.text, 500),
      html: clipText(entry.html, 2000),
      hints: entry.hints !== null && typeof entry.hints === 'object' ? {
        id: clipText(entry.hints.id, 200),
        classes: clipText(entry.hints.classes, 300),
        testId: clipText(entry.hints.testId, 200),
        ariaLabel: clipText(entry.hints.ariaLabel, 300),
        role: clipText(entry.hints.role, 80),
      } : undefined,
      styles: entry.styles !== null && typeof entry.styles === 'object' ? normalizeStyles(entry.styles) : undefined,
      rect: normalizeRect(entry.rect),
      docRect: normalizeRect(entry.docRect),
      elements: Array.isArray(entry.elements)
        ? entry.elements.slice(0, 8).map((element) => ({
          selector: clipText(element && element.selector, 1000),
          label: clipText(element && element.label, 200),
          tag: clipText(element && element.tag, 60),
          text: clipText(element && element.text, 300),
        })).filter((element) => element.selector !== '')
        : undefined,
      image: typeof entry.image === 'string' && entry.image.length < MAX_IMAGE_BYTES * 2 ? entry.image : undefined,
    };
    result.push(normalized);
  }
  return result;
}

function normalizeStyles(styles) {
  const result = {};
  const keys = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'padding', 'margin', 'border', 'borderRadius', 'display', 'gap', 'textAlign', 'opacity', 'width', 'height'];
  for (const key of keys) {
    const value = styles[key];
    if (typeof value === 'string' && value !== '') result[key] = clipText(value, 120);
  }
  return result;
}

function normalizeRect(rect) {
  if (rect === null || typeof rect !== 'object') return undefined;
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : 0);
  return {
    x: number(rect.x),
    y: number(rect.y),
    width: number(rect.width),
    height: number(rect.height),
  };
}

function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n\s]+)$/u.exec(dataUrl);
  if (match === null) return null;
  let buffer;
  try {
    buffer = Buffer.from(match[2].replace(/\s/gu, ''), 'base64');
  } catch {
    return null;
  }
  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) return null;
  const ext = match[1] === 'image/png' ? 'png' : match[1] === 'image/jpeg' ? 'jpg' : 'webp';
  return { buffer, ext };
}

function findWorkspacePath(ctx, sessionId) {
  try {
    const registry = ctx.get('workspaceRegistry');
    if (registry === undefined || registry === null || typeof registry.list !== 'function') return undefined;
    const workspace = registry.list().find((entry) => Array.isArray(entry.sessionIds) && entry.sessionIds.includes(sessionId));
    return workspace !== undefined && typeof workspace.path === 'string' ? workspace.path : undefined;
  } catch {
    return undefined;
  }
}

function inferSourcePath(workspace, pageUrl) {
  if (typeof workspace !== 'string' || workspace === '' || typeof pageUrl !== 'string' || pageUrl === '') return undefined;
  try {
    const url = new URL(pageUrl);
    if (!LOCAL_HOSTS.has(url.hostname)) return undefined;
    let relative = decodeURIComponent(url.pathname || '/').replace(/^\/+/u, '');
    if (relative === '' || relative.endsWith('/')) relative += 'index.html';
    const base = path.resolve(workspace);
    const absolute = path.resolve(base, relative);
    if (absolute !== base && !absolute.startsWith(base + path.sep)) return undefined;
    return { absolute, relative: path.relative(base, absolute).split(path.sep).join('/') };
  } catch {
    return undefined;
  }
}

async function existingFile(source, workspace) {
  try {
    const info = await fs.stat(source.absolute);
    if (!info.isFile()) return undefined;
    return source.relative.startsWith('..') ? source.relative : `./${source.relative}`;
  } catch {
    return undefined;
  }
}

function buildMarkdown({ createdAt, page, sourceFile, annotations, sessionId }) {
  const lines = [];
  lines.push('# 网页批注报告');
  lines.push('');
  lines.push(`- 页面地址：${page.url === '' ? '（未知）' : page.url}`);
  lines.push(`- 页面标题：${page.title === '' ? '（未知）' : page.title}`);
  lines.push(`- 页面源文件（推断）：${sourceFile === undefined ? '（未推断）' : sourceFile}`);
  lines.push(`- 批注时间：${createdAt.toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`- 批注数量：${annotations.length}`);
  lines.push(`- 会话：${sessionId}`);
  lines.push(`- 原始数据：annotations.json`);
  lines.push('');
  annotations.forEach((annotation, index) => {
    const number = index + 1;
    if (annotation.kind === 'region') {
      const rect = annotation.docRect || annotation.rect || {};
      lines.push(`## ${number}. 区域：${formatSize(rect)}`);
    } else {
      lines.push(`## ${number}. 元素${annotation.label === '' ? ` <${annotation.tag}>` : annotation.label}`);
    }
    lines.push('');
    lines.push(`- 备注：${annotation.comment}`);
    if (annotation.kind === 'element') {
      if (annotation.selector !== '') lines.push(`- 选择器：\`${annotation.selector}\``);
      const hints = annotation.hints || {};
      if (hints.testId) lines.push(`- data-testid：\`${hints.testId}\``);
      if (hints.id) lines.push(`- id：\`${hints.id}\``);
      if (hints.classes) lines.push(`- class：\`${hints.classes}\``);
      if (hints.ariaLabel) lines.push(`- aria-label：${hints.ariaLabel}`);
      if (hints.role) lines.push(`- role：${hints.role}`);
      if (annotation.text) lines.push(`- 文本：${annotation.text}`);
      const rect = annotation.docRect || annotation.rect;
      if (rect) lines.push(`- 位置/尺寸（页面坐标）：x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}`);
      if (annotation.styles) {
        const styles = Object.entries(annotation.styles).map(([key, value]) => `${key}: ${value}`).join('; ');
        if (styles !== '') lines.push(`- 关键样式：${styles}`);
      }
      if (annotation.html) {
        lines.push('- DOM 片段：');
        lines.push('');
        lines.push('```html');
        lines.push(annotation.html);
        lines.push('```');
      }
    } else {
      const rect = annotation.docRect || annotation.rect;
      if (rect) lines.push(`- 位置/尺寸（页面坐标）：x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}`);
      if (annotation.selector) lines.push(`- 选区定位选择器（推断）：\`${annotation.selector}\``);
      if (Array.isArray(annotation.elements) && annotation.elements.length > 0) {
        lines.push('- 区域内元素：');
        for (const element of annotation.elements) {
          lines.push(`  - \`${element.selector}\` ${element.label === '' ? '' : `（${element.label}）`}`);
        }
      }
    }
    if (annotation.imageFile) lines.push(`- 截图：${annotation.imageFile}`);
    lines.push('');
  });
  return lines.join('\n');
}

function buildComposerText({ page, sourceFile, annotations, mdPath, jsonPath, dir }) {
  const lines = [];
  lines.push(`我在这页做了 ${annotations.length} 条网页批注：`);
  lines.push('');
  const title = page.title === '' ? '（无标题页面）' : page.title;
  lines.push(`页面：${title}（${page.url === '' ? '地址未知' : page.url}）`);
  if (sourceFile !== undefined) lines.push(`页面源文件（推断）：${sourceFile}`);
  lines.push('');
  annotations.forEach((annotation, index) => {
    const number = index + 1;
    const kind = annotation.kind === 'region' ? '区域' : '元素';
    lines.push(`${number}. [${kind}] ${annotation.label === '' ? '（无标签）' : annotation.label}：${annotation.comment}`);
  });
  lines.push('');
  lines.push(`完整批注报告：${mdPath}`);
  lines.push(`批注数据：${jsonPath}`);
  lines.push(`截图目录：${dir}`);
  return lines.join('\n');
}

function formatSize(rect) {
  const width = rect && typeof rect.width === 'number' ? Math.round(rect.width) : 0;
  const height = rect && typeof rect.height === 'number' ? Math.round(rect.height) : 0;
  return `${width}×${height}`;
}

function safeId(value) {
  const text = typeof value === 'string' ? value : '';
  return /^[A-Za-z0-9._-]{1,120}$/u.test(text) ? text : 'unknown-session';
}

function clipText(value, max) {
  if (typeof value !== 'string') return '';
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function respond(res, status, data) {
  if (res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}
