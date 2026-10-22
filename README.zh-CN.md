<div align="center">

<a href="https://parallax.ink"><img src="docs/images/banner.svg" alt="Parallax — Auditable arXiv literature sets, built by your agent" width="100%"></a>

<h3>让 Agent 在本地 arXiv 语料里找全文献</h3>

<p>
  <img alt="DeepSeek Harness plugin" src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-4a7dea?style=flat-square">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-2554c7?style=flat-square">
  <img alt="Node.js ≥ 22.5" src="https://img.shields.io/badge/Node.js-%E2%89%A5%2022.5-3c873a?style=flat-square&logo=nodedotjs&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Local SQLite" src="https://img.shields.io/badge/storage-local%20SQLite-0f80cc?style=flat-square&logo=sqlite&logoColor=white">
</p>

<p>
  <a href="https://parallax.ink"><img alt="在线体验 Parallax" src="https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-parallax.ink-4a7dea?style=for-the-badge"></a>
</p>

<p>
  <a href="#快速开始">快速开始</a> ·
  <a href="#使用">使用</a> ·
  <a href="docs/development.md">开发指南</a> ·
  <a href="https://parallax.ink">在线体验</a>
</p>

<p><a href="README.md">English</a> · <b>简体中文</b></p>

</div>

---

**Parallax 是一个 DeepSeek Harness（dsh）插件，用来让 Agent 在本地 arXiv 语料里找全文献。** 它把 arXiv 元数据抓到本地 SQLite，Agent 用关键词召回、合并、相减、AI 精筛和分类这些集合操作完成检索，每个中间集合都显示在 dsh 的右侧栏里，可以点开查看。

<p align="center">
  <img src="docs/images/node-graph.gif" alt="一张集合图：多路召回合并成候选集，AI 精筛留下匹配的论文，AI 分类再按主题分组" width="720">
  <br>
  <sub>一张典型的集合图：多路召回 → 合并 → AI 精筛 → AI 分类。图中的语义检索节点来自 Parallax 在线版，本插件用关键词召回。</sub>
</p>

通用 Agent 通过黑盒的 web search API 做开放网络检索，只能拿到 top-k，回答不了“这个方向到底有多少篇论文”，还要花不少开销清洗噪音。Parallax 反过来做：Agent 在一份边界清楚的语料上全量召回，每个中间结果都留成一个可以查看的集合，逐篇判定交给 Jev 这种直接输出校准概率的判别模型，而不是让 LLM 写自由文本的结论。

- **本地 arXiv 语料**：按日抓取你关心的学科，覆盖日历清楚标出哪些日子已经在库里。
- **可审计的集合图**：每一步都是一个不可变节点，留下了什么、去掉了什么、为什么，都看得见。
- **AI 精筛与分类**：Jev 几分钟就能判完几千篇论文，先抽样试判再全量判定，同一篇论文不会重复付费。
- **自带研究 Skill**：一套文献检索 playbook，覆盖精读清单、主题综述、方法与趋势检索，用到时才加载。

语料、集合图、判定结果全部存在你本机的一个 SQLite 文件里。

## 检索结构

论文检索跟信息流推荐不太一样，漏斗式的“召回 → 粗筛 → 精筛”不够用：

- **需要多路召回**：一个主题往往有好几种叫法，每种叫法一路关键词，召回后要合并去重；
- **需要复核和补充**：不管人还是 Agent，第一轮检索都可能有疏漏，复核时要能把误纳入的条目批量剔除，把漏掉的补回来。

合并、去重、剔除，天然就是集合运算。所以 Parallax 里 Agent 操作的基本单元是**论文集合**，每个集合是图上一个不可变的节点：

- **语料根**：用一个虚拟对象表示检索起点（某个学科范围、某段时间的本地语料），不需要把全库条目物化成一个集合；
- **规则筛选**：按 arXiv 分类、提交时间、关键词（标题 / 摘要 / 作者，子串或整词匹配）过滤；
- **点名清单**：直接列出 arXiv id，适合把已知论文、或者复核时漏掉的论文补进来；
- **合并 / 相减**：多路召回取并集，误纳入的论文做差集剔除；
- **AI 精筛**：Agent 根据你的意图写出纳入 / 排除标准，Jev 给每篇论文一个纳入概率，默认 p ≥ 0.5 保留；
- **AI 分类**：把精筛后的集合分成 2–12 类，支持单标签和多标签（一篇论文可以同时属于两类）。

精筛是普通 LLM 又慢又贵的环节：它要给每篇论文写一段结论，长批次的结构化输出也容易出格式错误。Jev 直接用概率回答类型化的问题，所以更快，也更便宜：

<p align="center">
  <img src="docs/images/speed-race.gif" alt="精筛 10,000 篇论文：Jev 约 2 分钟，通用 LLM 约 20 分钟" width="720">
  <br>
  <sub>精筛 10,000 篇论文：Jev 约 2 分钟，通用 LLM 约 20 分钟（LLM 用时按 1,000 篇的实测估算）。</sub>
</p>

整张图会实时画在右侧栏的「集合画布」里，点任意一个节点就能看到它留下了哪些论文、排除了哪些、每篇的判定概率是多少。

相比让 Agent 在对话里用文本或 JSON 记账，把集合放在数据库和索引上有两个好处：一是能处理更大的规模（单次 Jev 判定最多两万篇候选）；二是把大规模、确定性的工作交给程序，可以对抗模型幻觉，也不怕上下文压缩时丢掉中间细节。每个节点都不可变，改动就是新节点，所以整条推理链会原样留在图上。

## 插件版还是在线版

这个插件是 Parallax 的本地开源版。[Parallax 在线版](https://parallax.ink)用的是同一套集合图检索，语料更大，检索前后的工作也更完整：

| | 本插件 | Parallax 在线版 |
|---|---|---|
| **语料** | 自己抓取需要的学科和日期 | arXiv 全学科自 2020 年以来的论文，开箱即用 |
| **召回** | 关键词、类别、日期 | 关键词、类别、日期，外加语义检索 |
| **精筛与分类** | Jev，需要自己的 API key | Jev |
| **检索之后** | 把集合导出成 JSON | **基于检索结果生成领域综述**，还有论文阅读界面和日报 / 周报 / 月报 |
| **在哪里用** | 你的电脑，DeepSeek Harness 里 | 浏览器打开即用，不用安装 |

想让数据全部留在本地，或者想自己改造检索流程，用插件版；只是想先感受一下 Parallax 的检索，直接去 [Parallax 在线版](https://parallax.ink)注册试用。

## 快速开始

> 只是想先试试？[Parallax 在线版](https://parallax.ink)不用安装，也不用自己抓数据。

### 准备

- 已安装 DeepSeek Harness，并有一个带 Web UI（`@deepseek-ai/dsh-web-app`）的 profile
- Node.js ≥ 22.5（插件直接使用内置的 `node:sqlite`，不需要编译原生模块）
- 一个 Jev API key，用于 AI 精筛和分类（可选：没有它，规则检索和集合运算照常可用）

### 构建

```sh
git clone https://github.com/Zilize/parallax-dsh.git
cd parallax-dsh
npm install
npm run build
```

### 安装到 profile

dsh 的 **profile** 是一套命名的运行配置（加载哪些插件和组件），对应 `~/.dsh/profiles/` 下的一个文件夹。不同的 dsh 入口用各自的 profile，常见的安装里桌面 App 用 `desktop`，网页版用 `web`，终端界面用 `dsh-tui`。在 `parallax-dsh` 目录里，把插件装进你在用的那个 profile：

```sh
dsh plugin --profile desktop add .
```

然后重启桌面 App。如果你是从命令行启动 dsh，就用这个 profile 启动：

```sh
dsh --profile <profile>
```

> 新建的 profile 默认只有基础组件。如果没有 Web UI，先运行
> `dsh --profile <profile> --from-default-profile web` 重置成 web 模板，再执行 `add`。

### 首次配置

点会话头部的 Parallax 图标旁的下拉箭头 → **设置**：

| 设置项 | 说明 |
|---|---|
| **arXiv 抓取学科** | 抓取范围，比如 `cs.CL`、`cs.AI`，或者整组 `cs.*`。抓取日历按这组学科计算覆盖。 |
| **Jev 判别模型** | API key 存在 dsh 的凭据文件里，不进插件数据库，浏览器端也拿不到。还可以调并发请求数（默认 2）和每个请求的论文数（默认 60）。 |
| **网络** | 抓取和 Jev 请求共用的 HTTP 代理。Node 自带的 `fetch` 不认 `HTTPS_PROXY`，需要代理的网络里请在这里填，比如 `http://127.0.0.1:7890`。 |

学科范围和代理也可以直接让 Agent 帮你设置；API key 只能在设置页填，免得进了对话记录。

## 使用

### 一次典型的检索

在输入框里输入 `/parallax-skills`（或者从 `+` 菜单选「文献检索」），然后正常描述你的问题：

```
/parallax-skills 帮我梳理一下 10 月上半月 LLM Agent 规划方向的新论文，整理一份精读清单
```

Agent 大致会这么做：

1. 先看本地语料覆盖了哪些日期；这段时间没抓过的话，提议补抓，抓取进度会在「数据抓取」页实时显示；
2. 用几次免费的探查（probe）摸清论文分布，再按不同叫法建几路关键词召回，合并成候选集；
3. 写出纳入 / 排除标准，先抽一小批样本试判，看看边缘论文判得对不对，调整标准后再全量精筛；
4. 精筛结束后读一读边缘的保留和排除结果，问你要不要按方法、任务之类的维度做 AI 分类；
5. 最后基于读过的摘要作答，你需要文件的话再导出 JSON。

整个过程你都可以在右侧栏看着集合图一点点长出来。如果发现某一路召回不对，直接告诉 Agent，它会建新节点修正，而不是悄悄改掉旧结果。

### 右侧栏

| 标签页 | 内容 |
|---|---|
| **历史检索** | 每个建过集合的对话一张卡片，点开就是那次检索的集合图 |
| **数据抓取** | 全年覆盖日历（已完成 / 部分覆盖 / 未抓取）、抓取对话框和任务记录 |
| **集合画布** | 当前对话的集合图：选中节点看论文，点信息按钮看节点详情、导出 JSON；也可以展开成大图 |
| **设置** | 抓取学科、Jev 判别模型、网络代理 |

### Agent 能用的工具

| 工具 | 作用 |
|---|---|
| `parallax` | 只读：语料覆盖情况、关键词检索、按 id 取论文全文摘要、按需加载研究 Skill 的文档 |
| `parallax_set` | 集合图：探查、建节点、试判、精筛、分类、翻看成员、等待 / 续判 / 取消、导出 |
| `parallax_ingest` | 抓取：查看覆盖、启动 / 等待 / 取消抓取、任务记录、设置学科和代理 |

Agent 发起的抓取和判定会注册成 dsh 的后台任务：会话头部能看到进度和停止按钮，任务结束时 Agent 会收到通知，不用一直守着。

研究 Skill 本身也随包分发（`skills/parallax/`）：一份 playbook 加上按场景拆开的指南，覆盖入门选读、主题综述、方法检索、趋势跟踪、引用脉络、方案取证等。常驻上下文的只有一行描述，正文和指南都是用到时才加载。

### 导出格式

导出就是这个集合的论文列表，一项一篇论文：

```json
[
  {
    "id": "2610.20603",
    "title": "…",
    "authors": ["Xiaoli Xu", "Zhengtao Wu"],
    "published_at": "2026-10-14T17:59:48.000Z",
    "primary_category": "cs.CV",
    "categories": ["cs.CV"],
    "abstract": "…",
    "abs_url": "https://arxiv.org/abs/2610.20603v1",
    "pdf_url": "https://arxiv.org/pdf/2610.20603v1.pdf"
  }
]
```

## 数据、成本与隐私

- **数据在本地**：语料、集合图和判定结果都在 `$DSH_HOME/storages/parallax.db`（默认 `~/.dsh`）。
- **只连两个地方**：抓取访问 `oaipmh.arxiv.org`，按 arXiv 的要求每次请求间隔至少 4 秒；AI 精筛和分类访问你配置的 Jev 地址，只发送论文的标题、摘要、作者、日期、分类，以及纳入标准。
- **判定只付一次钱**：每个 Jev 判定按篇落库，任务失败、取消或重启后，续判只处理还没判过的论文。
- **密钥不落库**：Jev API key 由 dsh 凭据服务保管，也可以用环境变量 `PARALLAX_JEV_API_KEY` 提供。

## 局限

- 语料只有 arXiv 的**元数据和摘要**，没有全文、引用关系，也没有向量；召回靠关键词，同一概念的不同叫法需要 Agent 分几路去召。语义召回可以用 [Parallax 在线版](https://parallax.ink)。
- 本地语料只包含你抓过的日期和学科，不等于整个 arXiv（在线版自带 2020 年以来 arXiv 全学科的语料）。另外，OAI 接口是按 **datestamp**（记录最后一次元数据变更的日期）给数据的，不是投稿日：一篇论文改过版就会挪到更晚的日期。所以 Agent 只把**连续抓满**的那段时间当作完整覆盖，覆盖不全会影响结论时，会在回答里说明。
- Jev 只给概率、不给理由，而且按请求计费。Skill 要求 Agent 先试判、再全量判定，并亲自读一读边缘论文的摘要。

## 开发

```sh
npm run watch       # 改代码自动重建，浏览器半边热替换
npm run typecheck   # 类型检查（两半边一起）
npm run smoke       # 宿主半边冒烟测试（先 build）
```

插件结构、dsh 插件机制和一些踩过的坑，都写在[开发指南](docs/development.md)里。

## 许可证

[Apache License 2.0](LICENSE)
