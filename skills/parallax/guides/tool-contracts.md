# Tool contracts

Read this before the first `parallax_set` or `parallax_ingest` call. Only the
tools named here are real; call only tools that are visible in the current
session.

## `parallax` — corpus and documents (read-only, free)

- `action:"status"` — paper count, harvested category scope, and the
  **submission-date completeness** line: the only date range the corpus
  vouches for. Harvests run by OAI update date, so earlier submission dates are
  partial (only papers revised inside harvested days appear).
- `action:"search"` — quick keyword recall: every whitespace-separated term
  must appear (substring, case-insensitive) in title, abstract or authors;
  optional `from` / `to` (submission dates) and `categories`; up to 50 papers
  with abstracts. Use it for lookups and orientation; use `parallax_set probe`
  for route design.
- `action:"paper"` — full metadata and the **untrimmed abstract**, by `id` or
  `ids` (up to 20 per call). `search` and `members` trim long abstracts and
  mark the cut with `[trimmed; …]`; the ending (results, scope, limits) is
  often what decides inclusion, so read the full abstract before deciding a
  borderline paper or recommending one.
- `action:"doc"` — load `SKILL.md`, `guides/<name>.md` or `cases/<name>.md`.

## `parallax_ingest` — harvesting and setup

Drives the Ingest tab: the same runs, coverage calendar and job list the user
sees. Harvesting is free but slow (arXiv requires a pause between requests).
When to ask the user first, and how to choose days: `guides/getting-started.md`.

| action | parameters | result |
|---|---|---|
| `status` | — | category scope, paper count, submission-date completeness, running/latest job, proxy in use, Jev key configured or not |
| `coverage` | `from?`, `to?` (default the last 30 days) | runs of `done` / `partial` (with missing categories) / `missing` / `failed` (with error) / `running` days, for the saved scope |
| `jobs` | `limit?` (≤50, default 10) | recent runs: range, categories, days done/skipped, records, new/updated, network, error |
| `job` | `id?` (default latest) | one run, including the current day and any retry in progress |
| `harvest` | `from`, `to` (≤366 days), `categories?` | starts a background run and returns its job id; `categories` replaces the saved scope; the user's Ingest tab opens on the run's year |
| `wait` | `timeout_seconds?` (≤1800, default 300) | fallback when the harvest is not a background job: blocks until no run is going, then shows the latest job |
| `cancel` | `id?` | stops the running job; the unfinished day is left `failed` |
| `configure` | `categories?`, `proxy?` | saves the scope and/or the HTTP proxy (`""` clears it) |

- Days are OAI datestamp days, not submission dates; days already covered for
  the scope are skipped; one run at a time (a second `harvest` fails while
  one is running).
- Categories: exact codes (`cs.CL`, `physics.acc-ph`) or group wildcards
  (`cs.*`), validated against the arXiv taxonomy.
- Proxy: `http://host:port` (`host:port` alone is accepted). SOCKS is
  rejected. It applies to the next harvest run and Jev request.
- The Jev API key cannot be set through this tool.

## Background runs

`parallax_ingest harvest` and `parallax_set judge` / `classify` / `resume`
run in the background. When the host provides background jobs, the result
says "runs as background job `<id>`":

- You are notified in-session when the run ends (an idle conversation is
  woken), with its outcome and summary. Keep working on independent steps;
  do not call `wait` or poll `job` / `inspect` for it.
- If you are genuinely blocked on it, use the host's `job_output` with
  `wait: true` on that job id.
- The run also appears in the session header's job list, where the user can
  stop it. Stopping it there, with `job_kill`, or by closing the
  conversation goes through Parallax's own cancel: a harvest leaves the
  unfinished day failed, and judging keeps the judgements already made.
- A run already in flight when you call `resume` is not registered again.

When the result does not name a background job (an older host), use the
tool's own `wait` action when the next step needs the result, and keep
working otherwise.

## `parallax_set` — the conversation's set graph

### Model

- **One flow per conversation.** Subagents write into their parent
  conversation's flow, so their work appears on the same graph. Sets of other
  conversations are not addressable.
- **Sets are immutable nodes** referenced by an 8-letter `code` (from the
  action output or `inspect`). Any change is a new node; nothing is edited or
  deleted. Name every node in the user's language, describing what it holds.
- **Members are derived, not stored.** A `rule_filter` re-evaluates when new
  days are harvested, and everything downstream follows. Jev judgements are
  the only stored facts; after the parent grows, the new papers show up as
  `undecided` until `resume`.
- **Single-parent discipline.** `rule_filter`, `judge`, `classify` take one
  `parent`; `subtract` takes one `base` and one `remove`; only `union` merges
  (2–32 `parents`). Merge first, then screen.
- A node holds at most 200,000 papers; a Jev run judges at most 20,000
  candidates. Narrow with rules first.

### Free actions

| action | parameters | result |
|---|---|---|
| `inspect` | — | every node: code, operator, size, parents, definition, judging progress |
| `probe` | `parent?`, `scope?`, `rules?` | dry run of a rule filter: count, year and primary-category distribution, newest/oldest samples, coverage note; stores nothing |
| `create` `op:"rule_filter"` | `name`, `parent?`, `scope?`, `rules?` | without `parent` it filters the whole corpus (its scope is drawn as the corpus root) |
| `create` `op:"seed"` | `name`, `ids` (1–500 arXiv ids) | named papers; ids missing from the corpus are dropped and reported |
| `create` `op:"union"` | `name`, `parents` (2–32 codes) | merged, first-seen order |
| `create` `op:"subtract"` | `name`, `base`, `remove` | `base` minus `remove` |
| `members` | `set`, `status?`, `offset?`, `limit?` (≤50), `full_abstract?` | papers with abstracts (trimmed to ~700 chars and marked; `full_abstract:true` gives untrimmed abstracts, ≤10 per page) and any Jev judgement |
| `wait` | `set?`, `timeout_seconds?` (≤1800) | fallback when judging is not a background job: blocks until it finishes, then reports the nodes |
| `cancel` | `set` | stops a running Jev job; judgements made so far stay |
| `export` | `set` | writes `parallax/exports/<name>-<code>.json` in the workspace; returns the path |

`status` for `members`: `member` (default) for any node; an AI screening node
also lists `excluded` and `undecided` (its parent's papers by judgement); an AI
classification node lists `undecided`, `other` and `uncertain`.

### Rules (ANDed)

```json
{ "type": "time_window", "from": "2024-01-01", "to": "2024-06-30" }
{ "type": "category", "categories": ["cs.LG", "stat.ML"], "primary_only": false }
{ "type": "keyword", "terms": ["world model", "learned simulator"], "fields": ["title", "abstract"], "match": "any", "mode": "literal" }
{ "type": "keyword", "terms": ["diffus*", "*former"], "mode": "wildcard" }
```

- `scope: {from?, to?, categories?}` is shorthand for a time window plus a
  category rule. Dates are **v1 submission dates**.
- `category` takes exact codes (`cs.LG`, `astro-ph.CO`, `hep-th`) or a group
  wildcard (`cs.*`); it matches any listed category unless `primary_only`.
- `keyword.fields` ⊆ `title`, `abstract`, `author`, `source_id` (default
  title + abstract); `match` `any` (default) or `all` across terms.
- `literal` (default): case-insensitive substring — `"transformer"` also
  matches "transformers", `"GAN"` matches "organ" (short terms are noisy:
  prefer full names or wildcard mode).
- `wildcard`: whole words; `*` only at either end of a 3–64 character
  letter/digit stem (`"LLM*"`, `"diffus*"`, `"*former"`). One word per term:
  `"world model*"` is invalid, use literal `"world model"`.
- Two rules with different keyword groups mean "group A AND group B"; one rule
  with several terms means "any of them" (or all, with `match:"all"`).

### Paid actions (Jev) — cost discipline

Every request is billed to the user's Jev key. Rules:

1. **Trial before judging.** `trial` with `parent`, `criteria`,
   `sample_size?` (≤40, default 20) judges an even sample and stores nothing.
   Read the scores and the **full** abstracts of surprising and borderline
   papers (0.3–0.7): the trial output ends with a ready
   `parallax({ action: "paper", ids: [...] })` call for the borderline ids;
   add any surprising ✓/✗ ids to it. Revise the criteria wording and trial
   again if needed.
2. **Judge once, on the merged candidates.** `judge` with `name`, `parent`,
   `criteria` — pass the exact criteria you trialled. Keeps papers with
   p ≥ 0.5; the node's members are the kept papers.
3. **Classify only for an established grouping need.** `classify` with
   `name`, `parent`, `mode` (`single_label`: one label per paper, `other` when
   none fits, `uncertain` below 0.8 confidence; `multi_label`: independent
   labels accepted at p ≥ 0.8; a paper with no accepted label is `uncertain`
   if some label scored 0.2–0.8, otherwise `other`), and `categories`:
   2–12 `{key, name, criteria}` (`key` matches `^[a-z][a-z0-9_]*$`; `other`
   and `uncertain` are reserved). Each category gets its own output node.
   Multi-label sends one request per paper — expensive on large parents.
4. Both return immediately and judge in the background; the canvas shows
   progress. See **Background runs** below for how you learn they ended.
5. `resume` judges only `undecided` papers (new since the last run, or left by
   a failed/stopped run). Never re-create a node to "retry".

Failures: no key → tell the user Jev needs an API key in the Parallax
**Settings** tab and continue without Jev (`guides/screening.md`); a rejected
key → same, with the error; HTTP 451 (region) → a proxy fixes it: ask the
user for their proxy's HTTP port and save it with `parallax_ingest configure`
(details: `guides/getting-started.md`), meanwhile continue without Jev; too
many candidates
→ narrow with rules first.

### Export format

`export` writes the set's papers as a plain JSON array, one item per paper
with its metadata: `id`, `title`, `authors` (array), `published_at`,
`primary_category`, `categories`, `abstract`, `abs_url`, `pdf_url`. It carries
no lineage or Jev judgements — the canvas shows how the set was built. Export
only when the user wants a file; the canvas already shows the set. Mention the returned path once.

## Other tools this skill uses

- `web_search` / `web_fetch` — external discovery and reading: arXiv HTML
  (`https://arxiv.org/html/<id>`) or abs pages, the arXiv API
  (`http://export.arxiv.org/api/query?...`), venue pages, citation indexes,
  project/code pages.
- `ask_user_question` — one grounded question when a scope boundary is material.
- `subagent` / `workflow` — parallel reading/verification of many papers, or
  screening by reading when Jev is unavailable. Give each subagent the exact
  criteria and its chunk of ids; require structured results; the parent alone
  creates nodes from validated results.
- `todo_write` — progress across multi-step research.
- `write` — a written report only when the user asks for a document.

## Corpus limits, restated

- Coverage claims follow `parallax status`: name the submission-date range the
  corpus vouches for; anything outside it is partial or external.
- No full text: method, experiment and result claims need `web_fetch` of the
  paper; if only the abstract was read, say so.
- No citation graph: predecessors and follow-ups come from reading reference
  sections and external citation sources.
- No semantic recall: a concept missing from your keywords is missing from the
  results. Plan word forms and alternative names deliberately.
