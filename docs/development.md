# 开发指南

本文面向想修改 Parallax 或参考它编写 dsh 插件的开发者。使用说明见 [README](../README.md)。

## 目录结构

```
package.json            # 双清单：dsh.bundle（配置层）+ dsh.client（浏览器半边）
cordis.patch.yml        # bundle 的配置层：把 Parallax 这一行插进 profile
build.mjs               # 两半边的构建（esbuild）
smoke.mjs               # 宿主半边的冒烟测试（不依赖 Cordis，不联网）
skills/parallax/        # 随包分发的研究 skill：SKILL.md + guides/ + cases/
src/
  index.ts              # 宿主半边入口：打开 SQLite，注册工具、路由和 skill
  host.ts               # 宿主 API 的结构类型 + 工具 / 路由共用的小工具
  tool-args.ts          # 模型工具参数校验
  wait.ts               # 进程内条件等待（抓取、判定、事件长轮询共用）
  settings.ts           # Jev 与网络设置；jev-defaults.ts 是两端共用的默认值
  taxonomy.ts           # arXiv 学科表与类别校验（两端共用）
  tools.ts              # 只读工具 parallax
  dsh-jobs.ts           # 把模型发起的工作注册成 dsh 后台 job
  ingest/               # arXiv OAI-PMH：客户端、存储、运行器、路由、parallax_ingest 工具
  sets/                 # 集合图：存储与求值、Jev 协议与判定任务、路由、parallax_set 工具、导出
  skills/provider.ts    # 打包 skill provider
  client/               # 浏览器半边：右侧栏四个标签页、头部入口、命令菜单
```

浏览器半边只用 `import type` 引用宿主模块里的类型，两端的接口形状因此只有一份定义；
运行时代码只共享 `taxonomy.ts` 和 `jev-defaults.ts` 这类纯数据模块。

## 常用命令

```sh
npm install
npm run build       # lib/index.js（宿主 ESM）+ lib/client.js（浏览器 CJS 工厂）
npm run watch       # 改代码自动重建
npm run typecheck   # tsc --noEmit，两半边一起检查（开启了未使用变量检查）
npm run smoke       # 对已构建的 lib/index.js 跑冒烟测试（先 build）
```

`watch` 下 dsh 会监听 bundle 文件变化：浏览器半边热替换，不用重启；宿主半边的改动需要重启
App 或触发一次 profile 重组。

> esbuild 的 JS API 会 spawn 子进程，在某些受限沙箱里会被拒绝（EPERM）；
> 那种环境里直接运行 `node_modules/@esbuild/<平台>/esbuild` 并带上同样的参数即可。

## dsh 插件模型

dsh 的插件是一个 Cordis 插件：导出 `apply(ctx)`，所有能力通过 `ctx` 注册，卸载时自动回收。
一个包可以同时有两个半边：

| 半边 | 运行位置 | 入口 | 注册方式 |
|---|---|---|---|
| 宿主半边 | dsh 的 Node 进程（桌面主进程 / CLI） | `package.json` 的 `.` → `lib/index.js` | `cordis.patch.yml` 插入一行 |
| 浏览器半边 | Web GUI 页面 | `dsh.client` + `exports["./client"]` → `lib/client.js` | 外壳自动扫描，无需额外配置 |

### 浏览器半边的模块契约

浏览器半边**不是**普通 ES 模块。外壳用一张冻结的模块表 + 惰性 CJS 工厂加载它：

```js
window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  // ……CommonJS 产物……
  return module.exports;
} });
```

`require` 只能命中外壳模块表里的包（随 dsh 版本变化，`build.mjs` 里的 `PLATFORM_MODULES`
需要与目标版本保持一致）：

```
react  react/jsx-runtime  react-dom  react-dom/client  @deepseek-ai/cordis  zod
@tanstack/react-virtual  @deepseek-ai/dsh-client-store  @deepseek-ai/dsh-client-ui-slots
@deepseek-ai/dsh-client-ui-primitives  @deepseek-ai/dsh-client-ui-dockkit
```

**React 必须 external**：插件自带一份 React 会出现两个实例，hooks 立刻报错。React Flow、
elkjs、lucide-react 这类表外的库直接打进包里。

### `inject` 必须声明全部用到的服务

Cordis 里访问未声明的服务会直接抛错：`cannot get property "<key>" without inject`。
浏览器半边要声明 `slots`、`sidebarRightTabs`、`sidebarRight`、`locale`、`commandUi`、`sessions`；
宿主半边至少要 `connection`。浏览器半边抛出的错误会让整个 Web 启动失败，聚合错误里只剩
`web boot: 1 entry did not activate`，所以 `src/client/main.tsx` 的 `apply` 会捕获并打印真实原因。

### 宿主 ↔ 浏览器通信

仓库内插件通常用代码生成的 Remote；out-of-tree 插件跑不了那套 codegen，所以 Parallax 用
`ctx.connection.fetch.register()` 注册 `/api/parallax/...` 精确路由。这条路在浏览器 HTTP 和
桌面壳两种载体上都能走通。路由只匹配精确路径，参数一律放在查询串或 JSON body 里。

### 右侧栏标签页

```ts
// 1. 注册一种标签页类型（按 kind 打开）
ctx.sidebarRightTabs.register({ id: 'Parallax/canvas', kind: 'parallax', priority: 'builtin', title: () => '…' })
// 2. 面板主体挂在 keyed 槽位上，key 就是上面的 id；作用域是会话，能拿到 sessionId
ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'Parallax/canvas' }, ParallaxPane)
// 3. 打开（会同时展开右栏）
ctx.sidebarRight.openTab('parallax')
```

槽位可能属于尚未激活的包，`register` 会在槽位声明前抛错；`mountSlot` 会短暂重试。

### 研究 skill 与命令

- 宿主半边用 `ctx.skills.registerProvider` 注册一个打包 skill。目录只放 `SKILL.md` 的一行
  description，正文在 `/parallax-skills` 调用时注入；`guides/`、`cases/` 由模型按需通过
  `parallax action=doc` 读取。这样常驻上下文的成本只有一行，正文只有一份。
- 浏览器半边在输入框的 `+` 菜单里注册命令 `parallax`，点击在草稿里切换 `/parallax-skills`。
  命令和 skill 不能同名：客户端会把与命令同名的 `/name` 行当作命令处理，这一行不会作为提示词发出，
  skill 也就不会注入。

### 后台 job

模型发起的抓取和 Jev 判定会注册成 dsh 后台 job（`ctx.jobs`，见 `src/dsh-jobs.ts`）。宿主据此在
会话头部显示进度和停止按钮，结束时给发起的 agent 发送会话内通知；job 的取消钩子只调用插件自己的
取消逻辑。宿主没有 `jobs` 服务时，模型改用工具的 `wait` 动作。

## 实现要点

### 存储

宿主半边直接使用 `node:sqlite`（Node ≥ 22.5 自带，无需原生编译），数据库位于
`$DSH_HOME/storages/parallax.db`。`DatabaseSync` 是同步 API；抓取每一页在一个不跨 await 的短事务里提交，
避免长事务吞掉其他路由的写入。

### 集合代数（`src/sets/`）

- **一个对话 = 一条构建流**（按根会话；subagent 的写入归到父对话的流）。
- **集合不可变**：算子、参数和父边在创建时固定，改动就是新节点；用 8 位短代号寻址。
- **成员不落库为事实**：每个节点按缓存键（算子、参数、父节点键、判定版本，读语料的节点再加语料版本）
  惰性重算，物化到 `set_members`。抓取每提交一页就推进语料版本，下游节点自动跟随。
- **判定是唯一的事实**（`set_decisions`，每篇每节点一行）。父集合变大后，新论文显示为待判，
  `resume` 只判新增；判定任务逐请求落库，失败、取消、重启都保留已付费的结果。
- **Jev 协议**：精筛每篇一个 Noul（p ≥ 0.5 保留）；单标签分类每篇一个 Choice（+ other，
  置信度 < 0.8 为待确认）；多标签每篇 × 每类一个 Noul，一篇一请求（≥ 0.8 接纳，0.2–0.8 为边缘）。
  请求按题数、字节和估算 token 上限打包，证据不截断，回包严格校验。
- **并发与批大小**：一次只跑一个判定任务，任务内同时在途的请求数和每个请求最多装的论文数都在设置页可调
  （默认 6 和 30，上限 16 和 60），每次运行开始时读取。每轮取的候选数会随之放大，保证每个 worker 都有活干。

### arXiv 抓取

- 按 OAI **datestamp**（记录最后一次元数据变更）逐日抓取，而不是按投稿日。改过版的论文会挪到更晚的
  datestamp，所以只补抓一段历史日期会漏掉之后改过版的论文。`publishedCompleteness` 只承认
  **连续抓满**的 datestamp 区间对应的投稿日期。
- 两次请求间隔至少 4 秒（arXiv 的要求），503/429 按 `Retry-After` 退避。
- Node 自带的 `fetch` 不读取 `HTTPS_PROXY`。`src/ingest/network.ts` 只为抓取和 Jev 请求单独配置
  undici dispatcher（不改全局，不影响宿主和其他插件）；优先级为设置页代理 → `HTTPS_PROXY` /
  `HTTP_PROXY`（遵守 `NO_PROXY`）→ 直连。只支持 HTTP 代理，不支持 SOCKS。

## 隔离测试环境

不想动日常使用的 `~/.dsh` 时：

```powershell
$env:DSH_HOME = "$PWD\.dsh-test"
dsh --profile ptest --from-default-profile web
dsh plugin --profile ptest add .
dsh --profile ptest --no-open --port 38999
```

`.dsh-test/` 已在 `.gitignore` 里。
