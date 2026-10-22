# Retrieval routes

Read this before designing keyword routes, choosing local versus external
discovery, or diagnosing missing coverage or query behavior.

## Local corpus versus external discovery

- `parallax status` first. It names the harvested categories and the
  submission-date range the corpus vouches for. Outside that range the corpus
  is partial; outside the harvested categories it is empty. Say so and use
  external discovery.
- Use the local corpus for harvested windows: `parallax_set probe` to design
  routes, `rule_filter` nodes to keep them. It is free and fast to iterate.
- Use `web_search` / `web_fetch` for older foundations, non-arXiv material
  (tutorials, courses, venue pages), full text, citations, code, and any
  window or category outside the corpus. External discovery does not imply
  corpus membership: `seed` drops ids that are not harvested.
- Never merge local and external results silently. Report external papers
  separately and label them external.

## Keyword-only recall

There is no semantic route: a paper that never uses your words is not found.
Compensate deliberately:

1. Write down the established names, abbreviations, spelling variants and
   common phrasings before searching — from the user's wording, a survey or
   representative abstracts you have read. Do not invent synonyms or treat a
   neighboring field as equivalent.
2. Prefer full phrases (`"diffusion model"`) and whole-word stems
   (`"diffus*"` in wildcard mode) over short substrings: `"GAN"` also matches
   "organ", `"RL"` matches "URL". Check the probe's samples for such noise.
3. Search title + abstract by default; `author` only for a named group;
   `source_id` only for id prefixes.
4. Read a handful of returned abstracts — especially the oldest and newest
   samples — for vocabulary you missed, then add it as a route or term.

## Designing routes

- Put the shared boundary (dates, categories) in one root `rule_filter` with a
  `scope`, then make each route a child `rule_filter` with its keyword rules.
  Every route then inherits the same window.
- Prefer 2–4 routes with distinct intent over near-duplicates: core names, the
  mechanism described in other words, an application phrasing.
- `categories` narrow noise when the field has stable arXiv categories; cross
  listings are included. Inspect noisy results before adding restrictive
  categories: a category can silently drop relevant work.
- `union` the adopted routes. `subtract(base: route B, remove: route A)` shows
  what B adds beyond A — read those papers before deciding B is worth keeping.
- The probe's year distribution exposes a truncated or skewed window; a route
  whose count is dominated by one unexpected category is usually noisy.

## Probes

A probe is a sample used to resolve meaning, coverage or feasibility: counts,
distributions and a few abstracts. Probes do not create sets and must not be
presented as one. Once a route is adopted, create it as a node so later steps
and the canvas use exactly that definition.

## Coverage and gaps

Keyword hits do not prove coverage. If a gap appears (a missing subfield, a
known paper absent), check why: is the paper outside the harvested window, or
does it use other words? Add a targeted route for a vocabulary gap; use
external lookup for a source gap. Known papers can be checked directly with
`parallax paper` or a `seed`.

For recent-work requests, harvested windows are the natural root. For older or
non-arXiv material, external sources are expected. For a broad coverage claim,
state the stopping reason and the coverage limit in the answer.

## Ids and versions

Seed ids are normalized (an `arXiv:` prefix and `vN` suffix are dropped). The
corpus keeps one row per paper with its v1 submission date and latest metadata;
a preprint and its published version are the same identity unless the venue
version materially changes the claim — say so when it matters.

## Citations

The corpus has no citation graph. For predecessors and follow-ups, read the
paper's related-work and reference sections (`web_fetch` arXiv HTML) and use
external citation sources; record which source supplied each relationship.
Verified ids can then become a `seed`.

## Stopping

Stop when the core questions and approaches relevant to the purpose have
checked examples, new routes add little that belongs, consequential gaps are
investigated, and the proposed inclusion boundary has evidence. Do not keep
collecting near-duplicates to reach a quota; do not screen a whole field with
Jev to produce an introductory list.
