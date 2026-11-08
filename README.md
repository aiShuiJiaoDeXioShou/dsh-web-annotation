# dsh-web-annotation · 网页批注

在 DeepSeek Harness 桌面端**右侧边栏的 Browser 标签页**里批注网页：点选元素、点击空白位置或框选区域，写下修改意见；结束批注时，批注文字会**直接写进当前会话的输入框**，你可以在发送前继续编辑。

- 无需再截图、圈画、手打元素描述；
- 不生成 Markdown 报告、不落盘、不改写会话日志——批注就是你自己的输入框草稿；
- 批注气泡里可以**添加图片**（选择文件或直接粘贴），结束后作为普通图片附件随消息发出。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 0.2 版的变化

这是基于 [HXwHSJS/dsh-web-annotation](https://github.com/HXwHSJS/dsh-web-annotation) 的 TypeScript 重写版：

| 项 | 0.1.x | 0.2.x |
| --- | --- | --- |
| 批注去向 | 写入磁盘报告 + 下一条消息时由 Host 合并 | **直接写入输入框**，不再有报告文件与 Host 中间件 |
| 截图 | 每条批注自动 `capturePage` 并落盘 | 不再自动截图；需要图片时手动添加/粘贴 |
| 图片 | 不支持 | 每条批注最多 4 张图片，作为消息图片附件发送 |
| 代码 | 单文件 JS，无构建 | TypeScript + esbuild，`src/shared` / `src/client` 分层，带测试 |
| 重复进入批注 | 退出后再次打开，元素选择可能失效 | 每次打开都重新注入并重启运行时，已加回归测试 |
| Host 半 | HTTP 路由 + `agent/pre-step` 改写消息 | 空 Host 入口，纯客户端插件 |

## 功能

- **连续批注**：点选元素、点空白位置（「点击位置」批注）、拖动框选区域；保存后可以接着批注下一条。
- **就地编辑**：气泡里输入意见，`Enter` 保存、`Shift+Enter` 换行、`Esc` 取消；已保存的批注点编号可重新编辑，`✓` 保存、垃圾桶删除。
- **图片批注**：气泡底栏「添加图片」可选择 PNG / JPEG / WebP / GIF（每条最多 4 张、单张 ≤ 8MB），也可以直接在输入框里粘贴图片；缩略图可单独删除。
- **写入输入框**：退出批注或点「写入输入框」后，插件把这一批批注拼成一段紧凑文字插入输入框；图片则挂到输入框的附件栏。输入框正忙时会保留页面上的批注，等你空闲后重试。
- **多批合并**：多次批注、多个页面得到的批注会依次追加到同一份输入框草稿，按页面分组，不会覆盖你自己已经输入的内容。
- **页面干扰抑制**：批注模式下一层透明捕获层挡住页面自身的悬浮弹层/链接跳转；跨域 iframe 可按整个元素/区域批注。

## 安装

要求：DSH 桌面端 **≥ 0.2.2-rc.1**（在 0.2.2-rc.1 上开发验证）。

### 从源码安装（本 fork）

```sh
git clone git@github.com:aiShuiJiaoDeXioShou/dsh-web-annotation.git
cd dsh-web-annotation
npm ci
npm run build          # 生成 client/client.js
dsh plugin --profile <profile> add "link:$PWD"
```

安装/更新后重启 DSH。

### 插件管理页

1. 先在上面的仓库里 `npm ci && npm run build`；
2. 打开 DSH 的**设置 → 插件**，选择本地目录/tgz 安装；
3. 完全退出并重新打开 DSH。

### 开发模式

```sh
npm ci
npm run check     # typecheck + build + tests
npm run build     # 仅重新构建客户端 bundle
```

仓库里的 `client/client.js` 是构建产物，会随提交一起更新；`link:` 安装时 DSH 直接读取它。

## 使用

1. 在会话右侧打开 **Browser** 标签页并访问任意 `http(s)` 页面；
2. 点击侧栏控件条上的**批注图标**（分栏按钮左侧）进入批注模式；
3. 点元素 / 点空白处 / 拖动框选，在气泡里写意见，需要的话点「添加图片」或粘贴图片，`Enter` 保存；继续下一条；
4. 再点一次批注图标（或点输入框上方「写入输入框」）结束这批批注；
5. 批注文字已经出现在输入框里，图片也在附件栏，按正常方式发送即可。

页面内按 `Esc` 也会结束批注模式并把当前批注写入输入框。

## 写入输入框的内容

```text
网页批注（2 条）

页面：控制台（https://example.com/#dashboard）
1. [元素] `button.export` 「导出」：按钮颜色太浅，和背景对比度不够
2. [区域] 框选区域 640×240：这块留白太大，压缩一半

（本批含 1 张图片，已作为附件加入输入框）
```

只保留定位元素所需的最少信息（选择器 + 可见文本 + 你的意见），不再附带 HTML、样式快照和报告路径，比 0.1.x 的消息明显更短。

## 隐私与安全

- **无外网请求、无遥测**；0.2 版没有任何 Host HTTP 路由。
- 不再向磁盘写报告、截图或批注数据；批注只存在于页面内存、输入框草稿和 DSH 自己的会话存储里。
- 图片通过 DSH 的 Conversation/attachment 服务进入输入框附件栏，和用户手动添加图片走同一条路径。
- 批注模式会向当前 `<webview>` 注入运行时并读取被批注页面的 DOM 信息；只在批注模式启用时运行。

## 已知限制

- 仅桌面端（依赖右侧边栏 Browser 的 Electron `<webview>`）；Web 版右侧栏是跨域 iframe，无法注入。
- 批注控件所在的那排侧栏按钮没有官方插件扩展位，靠实测 DOM 插入并持续校正；DSH 升级若改了这一排结构可能需要小修。
- 气泡固定用浅色卡片，暂不跟随宿主深色主题。
- 跨域 iframe 内部、closed Shadow DOM、Canvas 内部对象无法精确批注。
- 页面导航/刷新后页面内标记会丢失（已经写入输入框的内容不受影响）。
- 输入框处于提交中/只读状态时不会写入，页面上的批注会保留以便重试。

## 兼容性

| 项 | 值 |
| --- | --- |
| DSH | 0.2.2-rc.1（验证基线） |
| 平台 | Desktop（macOS 已验证；代码平台无关） |
| 运行时依赖 | 无 |
| 构建 | esbuild（仅开发时需要） |

## 开发

```sh
npm ci
npm run check
```

目录：

- `src/shared/` — 纯数据类型、输入框文案格式化、图片解码；
- `src/client/runtime.ts` — 注入网页的运行时（元素/区域选择、气泡、图片）；
- `src/client/controller.ts` — 每会话状态机（打开/结束/轮询、写入输入框、附加图片）；
- `src/client/ui.tsx` — 侧栏批注按钮与输入框上方的批注状态条；
- `tests/` — `node:test` 离屏测试，覆盖选择手势、重启回归、图片与写入逻辑。

设计说明见 [docs/REFACTOR.md](docs/REFACTOR.md)；DSH 0.2.2 客户端/输入框/附件 API 的调研记录（含 file:line 证据）见 [docs/dsh-api-notes.md](docs/dsh-api-notes.md)。

## License

MIT，见 [LICENSE](LICENSE)。
