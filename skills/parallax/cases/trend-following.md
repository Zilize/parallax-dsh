# Trend following — recent papers and changes over time

Use this workflow as a reference, adapting or skipping steps to match the user's
question, prior work and evidence. Tool contracts are in
`guides/tool-contracts.md`. Examples in Chinese and English are equivalent; use
only the user's language in the conversation.

## Recommended approach

1. Establish the topic and time window from context. Distinguish a recent
   snapshot from a comparison against an earlier period; a snapshot does not
   need an intake question about historical baselines. Check the window against
   `parallax status`: the corpus vouches only for its complete submission-date
   range, and its newest papers are as recent as the last harvested day. If the
   window is not harvested, harvest it with `parallax_ingest` (asking first
   for a long window or a scope change, per `guides/getting-started.md`) and
   use external discovery while it runs.
2. Find recent candidates with checked topic names and formulations, as routes
   inside a dated scope. If the reading purpose is open and the probe reveals a
   substantial body of work, resolve representative overview versus coverage
   before choosing a sample-only answer (see below). For coverage, build the
   graph and follow `cases/topic-coverage.md` for omissions and curation. For a
   representative update, read abstracts and select complementary
   developments, not just similarly worded papers.
3. For each possible development, identify what changed: the problem
   addressed, method, evaluation, capability or limitation. Read the sections
   supporting that claim (`web_fetch`). If describing a shift from past
   practice, find and read a relevant earlier baseline under comparable scope —
   often outside the harvest, so externally. If that comparison cannot be
   established, narrow the claim to what the recent papers demonstrate.
4. Check important counterexamples and gaps. Use external discovery when the
   harvest window, venue coverage or a missing named work limits the answer;
   follow `guides/retrieval.md`.
5. Present a few verified developments with representative links and remaining
   limitations. Separate demonstrated results, authors' proposals and your
   synthesis. Stop when each selected finding has adequate evidence for the
   requested depth. Do not pad a brief update with every hit.

Example: "这个方向最近半年有什么新进展？" / "What's new in this direction over
the last six months?" Search that window and identify candidate contributions.
Before saying an approach has replaced an older one, inspect earlier work and
contrary recent examples; otherwise describe the new approach and its evidence
without claiming field-wide adoption.

User: "世界模型最近有哪些变化？" / "What has changed in world models
recently?" Determine the reference point from context; ask only if material.
Probe recent work and, when claiming change, a comparable earlier period. Keep
topic definitions and source coverage comparable. Distinguish genuinely new
directions from new names for existing ideas. Counts do not establish a trend,
importance or progress.

If only recent papers were inspected, call it a recent snapshot, not a
demonstrated historical trend. Partial months, harvest gaps (the
submission-date range in `parallax status`) and unequal windows limit
quantitative comparisons.

User: "上个月读过这些论文，最近有什么值得关注的新工作？" / "I read these papers
last month; anything new worth following?" Use the known reading baseline
(`seed` it if you will subtract it), find meaningful additions and explain what
they change. Do not rebuild the same reading list.

"Keep me updated" is distinct from a one-off trend answer. The plugin has no
monitoring or schedule of its own; never promise ongoing updates because a
search succeeded. Rule-filter nodes do re-evaluate when new days are
harvested, so a later conversation turn can harvest the new days, `inspect`
the same graph, and `resume` judging for the new papers.

## A monthly search with an open reading purpose

User: "查一下这个月最新的世界模型相关工作" / "Find this month's latest work on
world models." Resolve the current month, check it is harvested, and run a
small scoped probe. If the results cover many papers and distinct research
questions, ask one grounded question before treating a few sampled papers as
the finished answer: "这个月的相关论文不少，涉及交互视频、机器人规划和评测。
你想先看几篇代表作了解进展，还是把相关论文整理成可逐篇浏览的集合，方便后续筛选和阅读？"
Equivalent English: "This month's papers cover interactive video, robot
planning and evaluation. Would you like a few representative papers to
understand recent progress, or a browsable set of relevant papers for further
screening and reading?" Adapt the fields to observed evidence. Options
describe reading purpose only: "代表作速览" / "Representative overview" and
"梳理可浏览的论文集合" / "Browsable paper set". The latter builds the set in the
Parallax canvas; do not bundle grouping or export into it.

- Representative overview: read selected abstracts, substantiate the findings
  at the requested depth and give a compact answer. No set is required.
- Browsable set: resolve a material inclusion boundary if needed, build routes
  in the month's scope, screen noisy candidates under the agreed boundary with
  Jev, review decisions and omissions, and answer with a concise synthesis
  naming the set. Classification needs its own purpose.

If the user already asked for a brief update, complete coverage, or a set,
follow that instruction without repeating this choice.

## Avoid turning a qualitative question into a batch analytics job

For "what changed between May and June?", start by identifying a few possible
changes and verifying representative papers from both periods. Do not classify
hundreds of candidates with Jev just to make a percentage table: keyword
choice, harvest gaps and category scope bias the candidate set, so neither
counts nor within-month shares estimate field-wide prevalence. If quantitative
trends are requested, establish a defensible corpus and method first and
separate observed sample statistics from general claims. Otherwise give a
bounded qualitative comparison and explain uncertainty in plain language.
