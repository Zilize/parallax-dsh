# Topic coverage — a vague monthly request versus an exhaustive field review

Use this workflow as a reference, adapting or skipping steps to match the user's
question, prior work and evidence. Tool contracts are in
`guides/tool-contracts.md`. Examples in Chinese and English are equivalent; use
only the user's language in the conversation.

## Recommended approach

1. Establish the research boundary, time scope and intended use from context.
   Resolve only ambiguities that materially affect inclusion or the amount of
   work. A request for a few representative readings can move to
   `cases/reading-shortlist.md`; a request for review coverage warrants a broader
   omissions check. Check `parallax status`: a window beyond the vouched
   submission-date range is a coverage limit to state up front.
2. Identify established names, alternate formulations and relevant
   subproblems. Recall is keyword-only, so vocabulary is the coverage: probe
   each formulation and read representative abstracts. Distinguish a
   terminology gap from genuinely different research before narrowing the
   scope. Do not convert one convenient keyword or category into the field
   definition.
3. For an agreed coverage task, build the graph: one scoped root
   `rule_filter`, one child per adopted route, `union` of the routes. Use
   `subtract` to see what an additional route contributes before adopting it.
   Counts and probe samples alone do not deliver the corpus. Check expected
   families or known representative works that are absent (`parallax paper`,
   or a `seed`); use external discovery for a concrete source gap under
   `guides/retrieval.md`, and document what cannot be verified instead of
   claiming the corpus covers all literature.
4. If delivering a curated body of papers, write inclusion/exclusion criteria,
   `trial` them on the merged set, `judge`, and review borderline and
   consequential decisions (`guides/screening.md`). For a short answer, read
   and verify the selected papers without a Jev job. Group only when it serves
   a real user need; comprehensive coverage alone is not a request for
   classification.
5. Explain the evidenced scope and findings at the requested depth. Name the
   final set for the canvas; distinguish selected examples from its members.
   Stop when the agreed scope has been checked through appropriate routes,
   important omissions have been investigated and remaining limits are
   explicit. Diminishing useful additions support stopping, not a claim of
   exhaustive coverage. Do not keep searching to reach a target count or fill a
   predetermined taxonomy.

When several screening passes or corrections contribute to one result, keep
them as nodes downstream of each other and answer from the final node. Audit
with `inspect` that every adopted route reaches it; silently reverting to the
first pass loses both valid additions and auditability.

## Scope decisions and examples

User: "找六月的世界模型论文。" / "Find June's world-model papers." Start with a
small date-bounded probe if useful. If the breadth ambition is unclear and
changes the work, ask one grounded question: "Are you aiming for broad
coverage, or a few papers to read closely?" Do not ask which keywords to use or
whether to export. If the user already said "as complete as possible for a
review", proceed without that question.

One phrase cannot define the field. Probe alternate names and distinct
families when warranted (for this topic, action-conditioned video prediction,
learned dynamics and interactive simulation are examples, not a fixed list),
each as its own route inside the June scope. Preserve the month. Do not drop a
discovered relevant family merely because it lacks the original phrase. Inspect
noisy results before adding restrictive categories. Merge the checked routes
and screen only under the research boundary. Do not add a citation hunt for
recent papers by default.

For "the entire field, as comprehensively as possible", establish a reasonable
field boundary and time scope through concise dialogue if missing. Use
subproblems and terminology internally to check omissions; this is not an
instruction to classify. Screen relevance when a curated result requires it,
and be honest about corpus coverage: older years are mostly outside the
harvested window. A survey or benchmark may be central to a field review; do
not impose a methods-only criterion. Follow a user's conceptual question into
discussion; exporting is not the next mandatory step.

## Example of a short, grounded exchange (adapt to observed results)

Assistant after a small probe: "六月的相关工作不少，除了直接叫世界模型的论文，
还有一些以动作预测、交互视频等名称发表。你更希望尽量梳理完整，还是先看几篇代表作？"
If using `ask_user_question`, two options can be "尽量全面梳理" and "先看代表作",
with descriptions explaining breadth versus focused reading. Neither option
implies classification, export or a particular subfield. Do not add four
unrelated choices or a long catalogue of titles before this question.

User: "全面一些，写综述用。" Continue investigating coverage; do not ask about
keywords or export. Later, a specific finding may warrant: "这几篇只把视频生成
作为模拟环境，没有验证控制能力。我先把它们与直接用于决策的工作区分开，避免在综述
里混为一谈。" Ask about inclusion only if the answer matters and is not already
clear.

## Equivalent English exchange

Assistant after observing the same evidence: "June's papers include work
described as action prediction and interactive video, alongside papers called
world models. Are you aiming for broad coverage, or a few representative papers
to read?" Options: "Broad coverage" / "Representative reading", with brief
descriptions about the research purpose, not tool operations.
User: "Broad coverage — I'm writing a review." Continue checking omissions.

## Keep the coverage choice neutral

Good option descriptions: "尽量少漏掉相关论文，并核查容易遗漏的工作" / "Look
broadly for relevant papers and check likely omissions"; "挑几篇互补的论文，解释
为什么值得读" / "Choose a few complementary papers and explain why to read them".
Bad: "全面检索并按子方向分类" / "Comprehensive coverage, grouped by subfield".
The bad option bundles grouping — a paid classification — into breadth.
Selecting it does not establish a need for classification; do not use your own
leading wording to justify extra work.

"全面一些，写综述用" / "Broad coverage, for a review" → check omissions and
inclusion criteria; no automatic classification.
"只保留真正用世界模型做规划的" / "Keep only papers that actually use world models
for planning" → trial and judge when a curated set is needed.
"把这些论文按方法整理成几组" / "Organize these papers into groups by method" →
classification is useful; do not repeat the search without a reason.
