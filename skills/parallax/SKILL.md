---
name: parallax-skills
description: Build and review literature sets from the local Parallax arXiv corpus. Use for surveys, topic coverage, method or trend searches, lineage questions, solution evidence, reading lists, or regrouping known papers. Scopes the question, probes keyword routes, builds an auditable set graph, screens or classifies with the Jev judge, and answers from verified papers.
whenToUse: The user asks for literature discovery, a reading list, a survey, a method/topic landscape, trend or lineage tracing, or a reviewed set of papers.
---

# Parallax set builder (DSH plugin)

This is the playbook and document index. Activation loads this file only: no
guide or case body is preloaded. Load documents with:

```
parallax({ action: "doc", path: "guides/tool-contracts.md" })
```

Valid paths are `SKILL.md`, `guides/<name>.md` and `cases/<name>.md`.
**Load `guides/tool-contracts.md` before the first `parallax_set` or
`parallax_ingest` call**: it
holds the action contracts, the rule grammar and the Jev cost rules.

## Setup and first use

Read `guides/getting-started.md` when the user asks how to use or set up
Parallax, or when `parallax status` shows an empty corpus, no category scope
or an unharvested window. Read it as well when harvesting stalls or Jev
reports a missing key, a rejected key or HTTP 451. You can set the category
scope and proxy and run harvests yourself with `parallax_ingest`, asking first
before saved-setting changes or long harvests. Only the Jev API key is the
user's to enter, in the Settings tab.

## Before choosing a research strategy

For a research task, read the closest matching case (listed under
**Documents**) before committing the main strategy, unless its contents are
already in the current context. A small probe to resolve what the task means
may come first. Exact paper lookup and a direct follow-up on evidence already
read need no new case unless the task changes. Reading a case and executing
every step it suggests are different: read it, then adapt its workflow to the
actual question.

Read a guide when its decision arises, not all guides at activation. Reuse a
document's contents while they are available; a filename or a record of a
past read is not the document body. After compaction, load needed guidance
again. A changed question may call for a different case; do not restart
completed research just to follow its workflow.

## What this plugin can and cannot do

The local corpus is a **subset of arXiv**: only the days harvested in the
Parallax ingest tab, for its category scope. It has titles, authors, dates,
categories and abstracts — **no full text, no citation graph, no embeddings,
no code links**. Recall is keyword-only (substring or whole-word), plus
category and submission-date filters.

- `parallax_ingest`: harvesting and setup — `status` (scope, running job,
  proxy, whether a Jev key is set), `coverage` (which days are harvested),
  `harvest` / `wait` / `cancel`, `jobs` / `job`, `configure` (category scope,
  proxy). Free but slow; runs one at a time in the background, and you are
  notified when it ends.
- `parallax` (read-only): `status` (what is harvested and which submission
  dates are complete), `search` (quick keyword recall), `paper` (one paper),
  `doc` (this skill's documents).
- `parallax_set`: this conversation's **set graph**. Free nodes — `seed`
  (named arXiv ids), `rule_filter` (scope + rules), `union`, `subtract`.
  Paid nodes — Jev `judge` (screening) and `classify` (2–12 categories), always
  calibrated with `trial` first. Plus `probe`, `inspect`, `members`, `wait`,
  `resume`, `cancel`, `export`.
- Jev returns calibrated probabilities from **title + abstract only**, never
  reasons, and costs the user money per request. It needs a Jev API key the
  user adds in the Parallax **Settings** tab; without one, AI screening and
  classification are unavailable (see the fallback in
  `guides/screening.md`).
- There are **no collections, favorites or delivery**. The set graph is the
  conversation's working record, visible to the user in the Parallax canvas.
  A set leaves the plugin only as an exported JSON file (`export`), when the
  user asks for a file.
- `web_search` / `web_fetch` cover what the corpus cannot: older or
  non-harvested papers, full text, citations, code, venues. External papers
  cannot enter a set unless their days are harvested; report them separately
  and label them external.

## How to research

1. **Establish the question before committing to a result.** Infer purpose,
   time scope, inclusion boundary and desired depth from the request and prior
   turns. Do not ask what is already clear and do not administer a
   questionnaire. Ask one grounded question (via `ask_user_question`) only when
   different plausible readings materially change which papers belong or how
   much work is useful.
2. **Check coverage, then search to resolve gaps.** `parallax status` tells you
   which submission dates the corpus can vouch for. Plan the established names
   and word forms before the first substantial search — keyword recall finds
   only the words you give it. Use the local corpus for harvested windows and
   external discovery for the rest. A probe is not a set: build nodes once the
   user needs a body of papers to screen, compare or organize.
3. **Choose screening, grouping or reading by the actual purpose.** A curated
   set with a shared inclusion condition needs screening when keyword results
   contain noise. Classification alone does not check an inclusion condition. A
   few recommendations can be answered by reading those papers, without a set.
4. **Match the answer to verified evidence.** Read abstracts before
   recommending; fetch and read the paper (arXiv HTML/PDF) before detailed
   method or result claims. A Jev probability is a screening signal, not
   evidence: review borderline and consequential decisions by reading. Keep
   unscreened results labelled as candidates.
5. **Answer at the requested depth.** Lead with what the papers show; use a
   few representative papers as evidence and mention the set (its name) when
   the user may want to browse it in the canvas. Enumerate every paper only
   when asked for a full list or a paper-by-paper comparison. For a brief
   overview, default to at most three findings and two to four papers
   **in total** across the answer, not per finding. Pick examples that satisfy
   the stated scope; do not recommend a borderline paper and retract it at the
   end. Comprehensive search does not require exhaustive narration.
6. **Use the user's language** for questions, progress, set names and answers;
   keep original paper titles. Describe findings, not codes, thresholds, tool
   calls or probabilities. Link a paper by its title, never by a raw URI. Do
   not announce skill activation, candidate pools or internal routes. Recover
   routine tool errors quietly; explain a failure only when it affects the
   result.

## Make the set canvas useful and understandable

The user sees this conversation's set graph in the Parallax **集合画布 /
Build graph** tab. Probes leave it empty; its content comes from the nodes you
create. When clarifying an open reading purpose, explain the useful outcome —
a browsable body of papers for continued screening and reading alongside the
conversation — without asking the user to choose tools or describing an
internal pipeline.

After creating a meaningful set, connect the answer to that actual result
briefly: name the node and explain one relevant interaction, such as selecting
a node in the canvas to browse its papers, or the excluded/undecided papers of
an AI screening node. Identify unscreened results as candidates. Mention the
canvas once, at the useful transition, not in every progress message.

For a paper-only answer (no set built), do not imply the canvas holds the
recommended papers. On the first such answer, say briefly that no set has been
assembled when the canvas's role would otherwise be unclear, and offer one
concrete continuation from these findings and the original scope (for
example, building and screening a set for the same window), unless the user
already declined set work. Do not repeat the offer on every follow-up.

When a step must be named, use the canvas's own words so the user can match it
to a card — in Chinese: 「规则筛选」 (rule_filter), 「点名清单」 (seed),
「集合合并」 (union), 「集合相减」 (subtract), 「AI 精筛」 (judge),
「AI 分类」 (classify) and 「分类结果」 (its output nodes); member statuses
「成员」, 「已排除」, 「待判」, 「其他」, 「不确定」. In English: Rule filter, Named
list, Union, Subtract, AI screening, AI classification, Class. Do not coin
variants such as 「关键词门」 or 「术语召回」, and do not show set codes in the
answer; refer to a node by its name.

## Documents

Read the closest case before choosing the main strategy; load a guide when its
decision arises. Do not preload all guides or cases.

- `guides/getting-started.md` — setup questions, empty or missing coverage,
  running and diagnosing harvests, proxy, Jev key, and explaining the panel
  and overall flow.
- `guides/tool-contracts.md` — **read before `parallax_set` or
  `parallax_ingest`**: actions,
  parameters, rule grammar, set semantics, Jev cost discipline, export format.
- `guides/intent-and-scope.md` — before resolving a material scope ambiguity,
  designing a clarification, or turning an open request into a bounded one.
- `guides/retrieval.md` — before designing keyword routes, choosing local
  versus external discovery, or diagnosing missing coverage.
- `guides/screening.md` — before writing Jev criteria, running a trial or a
  judge/classify job, reviewing decisions, or screening without Jev.
- `guides/review-and-delivery.md` — before auditing a set, resolving a
  mismatch between findings and the set, writing the answer or exporting.
- `cases/reading-shortlist.md` — entering a field, selected readings, exact
  title/id lookup.
- `cases/topic-coverage.md` — broad topic coverage or review preparation.
- `cases/method-search.md` — a method's innovations, applications, similar or
  competing approaches.
- `cases/trend-following.md` — recent developments or changes over time.
- `cases/citation-lineage.md` — predecessors and follow-ups.
- `cases/solution-evidence.md` — choosing a solution or checking a claim.
- `cases/existing-material.md` — supplementing, narrowing or regrouping papers
  already found or provided.

## Workflow

1. **Scope** — infer the research question and its four boundaries; ask one
   grounded question only if a boundary materially changes membership. Read
   the closest case before committing the strategy.
2. **Coverage + probe** — `parallax status` (empty or missing coverage →
   `guides/getting-started.md`), then `parallax_set probe` (or
   `parallax search`) for one or two routes; read some tail abstracts to see
   whether the corpus can answer or the window is missing.
3. **Routes** — one `rule_filter` node per distinct keyword route, inside a
   shared scope; `union` the adopted routes; `subtract` to see what a route
   adds. External routes stay in the answer, labelled external.
4. **Screen** — write criteria, `trial` on the merged candidates, revise,
   then `judge`; when notified that it ended, read borderline and
   consequential decisions.
   Without Jev, screen by reading and record the result as `seed` nodes.
5. **Group** — once 「AI 精筛」 has finished and been reviewed, unless the user
   already asked for or declined a grouping, ask once (`ask_user_question`)
   whether to classify the screened set, offering 2–4 concrete groupings
   drawn from its papers plus "no grouping". `classify` only on a yes.
6. **Review & answer** — `inspect` the graph, audit composition and evidence,
   answer from the verified papers. `export` only when the user wants a file.

## Judgment and stopping

Cases are reference strategies, not scripts or mandatory tool sequences.
Choose, skip, reorder or combine steps according to the question, prior
context, available evidence and requested depth. Do not add questions,
searches or paid Jev jobs merely to complete a case's checklist. This
flexibility does not waive explicit user constraints, evidence requirements or
tool contracts. Stopping criteria are purpose-based, not quotas of searches or
papers.

Chinese and English examples in the cases express equivalent intents, not
trigger phrases. Apply the same reasoning to paraphrases and either language,
and answer in the user's requested language (otherwise the conversation
language) — do not output both versions.
