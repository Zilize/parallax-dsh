# Getting started

Read this when the user asks how to use Parallax or how to set it up, when
`parallax status` shows an empty corpus or no category scope, when the
requested window is not harvested, when the user says harvesting is stuck or
slow, or when Jev reports a missing key, a rejected key or HTTP 451.

You can do most setup yourself with `parallax_ingest` (contract in
`guides/tool-contracts.md`): set the category scope and proxy, start, watch
and cancel harvests. The Jev API key is the exception: only the user can
enter it, in the Settings tab. Everything you do through the tool also shows
in the Parallax panel, and starting a harvest opens the 「数据抓取」 / Ingest
calendar on its own, so the user can watch progress there. Do not tell them to
open it.

## The panel

The Parallax panel sits in the right sidebar. Its tabs, as they appear in
Chinese / English:

- 「数据抓取」 / **Ingest**: a calendar showing which days are harvested,
  the 「抓取」 / Harvest button that starts a run, and the 「任务记录」 /
  Jobs list. Day states are 「已完成」 Done, 「部分覆盖」 Partial,
  「未抓取」 Not harvested.
- 「集合画布」 / **Build graph**: this conversation's set graph. Selecting a
  node lists its papers; 「导出 JSON」 / Export JSON writes the set to a file.
- 「历史检索」 / **History**: the set graphs of earlier conversations.
- 「设置」 / **Settings**: 「arXiv 抓取学科」 arXiv categories,
  「Jev 判别模型」 Jev judge model (API key, base URL, model) and 「网络」
  Network (proxy).

In the composer's `+` menu, the 「文献检索」 / literature row attaches this
skill to the next message.

## First-run checks

`parallax_ingest status` shows the scope, paper count, running job, proxy and
whether a Jev key is set, all in one call. Use it (or `parallax status`)
before the first research step of a conversation. Then:

1. **No category scope**: propose a scope that fits the question (for
   example `cs.CL` for NLP, or `cs.*` for computer science in general) and
   save it with `configure` once the user agrees.
2. **Empty corpus, or the requested window not harvested**: check
   `coverage` for that window, then harvest it (see when to ask, below).
   While it runs, start external discovery and label those papers external.
3. **Corpus present**: name the submission-date range it vouches for, only
   when that matters to the question, and carry on.

Mention setup once, at the point where it limits the answer. Do not repeat it
on every turn and do not lead the answer with it.

## Harvesting

### When to ask first

Start a harvest without asking when the user asked for one, or when the
question needs a short gap (up to about a week) in the current scope. Say in
one line what you started.

Ask first, with a single `ask_user_question` naming the date range and scope,
when the harvest would:

- change the category scope (it is saved, and days harvested under the old
  scope then count as partial);
- span more than about a week, or use a broad scope such as `cs.*` across
  many days. arXiv requires a pause between requests, so a broad month can
  take a long time.

Never change the scope or the proxy just to make one search work without the
user agreeing; both are saved settings.

### Running it

1. `coverage` for the window: it lists runs of done, partial, missing and
   failed days, with the missing categories and errors.
2. `harvest` with `from` / `to` (inclusive, at most 366 days). Days already
   covered for the scope are skipped, so you can harvest a range that
   overlaps done days. Only one run happens at a time; if one is running,
   let it finish or ask the user before cancelling it.
3. Keep working on external discovery or other parts of the task. The
   harvest runs as a background job and you are notified when it ends
   (`guides/tool-contracts.md`, Background runs).
4. When it ends, read the notice: failed days are listed. Run
   `parallax status` again before relying on the new days. Sets built
   earlier in the conversation pick up the new papers on their own; an AI
   screening node needs `resume` for them.

### Choosing days

- Days are **OAI update dates**, not submission dates. A paper revised later
  moves to a later day. Papers submitted from date D onward are complete only
  once **every day from D to the present** is harvested. Back-filling an old
  window alone misses papers revised since then. Tell the user this when they
  ask for an old window.
- For "recent work", harvest from the start of the window up to today.
- Coverage is keyed by the category set. After the scope changes, earlier
  days count as partial and are harvested again for the missing categories
  only.
- A wider category scope costs more time per day. Prefer the categories the
  question needs.

## Proxy

One setting covers both arXiv harvesting and Jev requests (`configure` with
`proxy`, or Settings → 「网络」 / Network → 「代理地址」 / Proxy URL). When it
is empty, the `HTTPS_PROXY` / `HTTP_PROXY` environment variables are used;
when neither is set, requests go out directly. `status` shows which applies.

Suspect the network when:

- a job stays at 0 records, or `job` shows repeated retries with
  `request timed out` on a direct connection;
- Jev answers HTTP 451 (not available from this region).

Ask the user for their proxy's HTTP port before saving one; do not guess a
port. Tell them:

- A Windows system proxy is **not** picked up automatically, so its HTTP
  port must be entered, e.g. `http://127.0.0.1:7890`.
- Only HTTP proxies work, not SOCKS. For Clash-style clients, use the
  mixed or HTTP port.

After saving it, cancel a stuck run if one is going, then harvest again: the
proxy applies from the next run.

## Jev API key

AI screening (「AI 精筛」) and AI classification (「AI 分类」) need a Jev
API key. Each request is billed to the user's key. Keyword search, rule
filters, set operations, harvesting and the canvas all work without one.

- `parallax_ingest status` tells you whether a key is configured. If the
  research plan depends on AI screening and none is, say once that it needs
  a key, entered in Settings → 「Jev 判别模型」 → API key, and that it is
  paid.
- Never ask the user to paste the key into the conversation; it would stay
  in the transcript. A key supplied through the `PARALLAX_JEV_API_KEY`
  environment variable takes precedence over the Settings field.
- On a missing or rejected key, tell the user once, then screen by reading as
  described in `guides/screening.md` (Without Jev). On HTTP 451, see the
  proxy above.

## Explaining the overall flow

When the user asks how Parallax works, describe it as what they do and what
they get, briefly and in their language:

1. Pick arXiv categories and harvest the days you need, either in the panel
   or by asking the assistant to do it.
2. Ask a research question in the conversation, using 「文献检索」 from the
   `+` menu.
3. The assistant searches the local corpus, builds sets and, with a Jev key,
   screens them by AI. Browse and check the results in 「集合画布」,
   including the papers AI screening excluded or left undecided.
4. Export a set as JSON when you need a file. Earlier conversations' graphs
   stay in 「历史检索」.

Do not list tool names, actions, set codes or internal nodes in this
explanation.
