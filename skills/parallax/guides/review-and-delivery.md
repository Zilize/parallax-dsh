# Review and answer

Read this before auditing a set, resolving a mismatch between findings and the
set, writing the answer, or exporting.

## Audit composition with `inspect`

Before answering from a set, check the graph:

1. Every adopted route is a node, and the final set descends from all of them
   (through `union`), not from just the first one.
2. Scope and dates are the same on every route, or the differences are
   deliberate and named.
3. Judging nodes are finished (no `undecided` left that the answer depends on);
   if the parent grew since, `resume` or state that new papers are unjudged.
4. Correction nodes (`seed` + `union` / `subtract`) are downstream of the
   judged set, so the final node includes them.
5. The final node is the one you describe, and its name says what it holds.

Composition checks are not relevance checks. Relevance comes from the
screening review in `guides/screening.md`.

## Audit evidence

- Re-read high-risk inclusions and consequential exclusions.
- Claims about a method's origin, mechanism or comparison need the source
  text (`web_fetch`), not a title, an abstract snippet or a Jev score.
- When dates conflict with source metadata, investigate; do not guess a
  revision history. Corpus dates are v1 submission dates.
- Keep unresolved gaps explicit rather than omitting them silently.

## Match the answer to the evidence

- A brief answer is a few essential findings and links, not a catalogue. For
  a brief overview, default to at most three findings and two to four papers
  in total across the answer, not per finding.
- Select examples that satisfy the stated scope; do not recommend a
  borderline paper as a match and retract it at the end.
- For a comprehensive set, lead with what the papers show, use a few
  representative papers as evidence, and name the set once so the user can
  browse it in the Parallax canvas.
- Enumerate every paper only when the user wants a full list or a
  paper-by-paper comparison.
- Do not repeat paper cards in the closing paragraph.
- Already explicit boundaries are constraints to apply, not questions to ask
  again.

## Answer shape for a non-trivial set

1. **Question and scope** — purpose, window, categories, sources.
2. **What the evidence shows** — 3–6 findings, each tied to specific papers.
3. **Coverage and limits** — the submission-date range the corpus vouches for,
   external routes, papers only Jev read, stopping reason, known gaps.
4. **The set** — its name, size, and how it was built in one sentence.

Not a tool log: no codes, thresholds, probabilities, raw recall lists or
repeated abstracts. Link papers by title, with the arXiv URL in the link.
When a step must be named, use the canvas's words listed in `SKILL.md`
(「规则筛选」, 「集合合并」, 「AI 精筛」 …).

## Closing the answer

Review a consequential gap with a concrete question, not "satisfied?" or a
generic menu of search, classify or export. (The one grouping question after
「AI 精筛」, with concrete groupings, is not such a menu: `guides/screening.md`.)
Follow a scientific follow-up
directly into discussion. For a paper-only answer, the one continuation offer
in `SKILL.md` applies; do not repeat it.
Write a document file only when the user asks for one.

## Export

The canvas already shows every set; there is no saving, collection or
delivery step. When the user wants a file (to share, archive or analyse),
`export` the final node and mention the returned path once. The JSON is the
set's paper list, one metadata item per paper. Do not
offer an export at the end of every answer.

## Language

Use the user's language for questions, progress, set names and answers; keep
original paper titles regardless of language.
