# Screening and evidence

Read this before writing Jev criteria, running a trial or a judge/classify
job, reviewing decisions, or screening without Jev.

## What Jev is

Jev answers typed questions with calibrated probabilities. It reads the
title and abstract of each paper (plus authors, date and categories for
screening) and nothing else: no full text, no external context, **no written
reasons**. A probability is a screening signal — a decision you still own, not
evidence for a claim about the paper. Every request costs the user money.

## Write the criteria first

The `criteria` text is everything Jev knows about the task. Write it in plain
language, in the user's terms:

- **Include** — what a paper must be or do: its own core contribution, not
  terms it merely mentions ("proposes or evaluates a method for X", "reports
  experiments on Y").
- **Exclude** — explicit exclusions, including publication type and adjacent
  topics. Do not let "core tasks" silently exclude datasets, benchmarks or
  surveys unless the user said so; say which roles are in scope.
- **Borderline** — how to treat mention-only, application-only or partial
  matches.

Judge against the user's boundary, not an idealized narrower field. Keep the
wording stable once trialled; a changed boundary is a new `judge` node, never
an edit.

## Calibrate with `trial`

Run `trial` on the merged candidate set (the node you will judge), not on one
route. It judges an even sample and stores nothing. Inspect:

- the obvious positives and negatives — are any wrong?
- the borderline band (≈0.3–0.7) — read those full abstracts yourself (the
  trial output lists the ids as a ready `parallax` `paper` call); a trimmed
  abstract is not enough to overrule a score;
- the projected kept count — does it fit the purpose?

If decisions are wrong, fix the cause: vague criteria, a missing exclusion, or
a route bringing in a different field (fix the route instead). Trial again
with the revised wording, then `judge` with exactly that wording. Do not hand
the user a known noisy keyword set as the finished relevant-paper list;
screening exists to remove that noise.

## After `judge`

- Judging runs in the background; continue with independent work until you
  are notified that it ended (`guides/tool-contracts.md`, Background runs).
- Read `members` of the kept set around the lower scores and `excluded` around
  the upper scores: these are the decisions most likely to be wrong.
- Review **consequential exclusions** — papers a reader would expect, or
  exclusions that shape the answer's claim — by reading the abstract (and the
  paper, when the abstract is silent).
- A sharp count drop is a reason to inspect, not proof of improvement.
- Then offer grouping: unless the user already asked for or declined one, ask
  once with `ask_user_question` whether to split the screened set with
  「AI 分类」. Propose 2–4 concrete groupings read off the kept papers (method
  family, task or setting, evidence type …) as options, plus "no grouping";
  the user's choice becomes the categories. Do not classify without a yes.

## Correcting decisions

There are no per-paper edits. Corrections are new nodes, so the graph shows
them:

- wrongly excluded papers → `seed` of those ids, then `union` with the kept set;
- wrongly kept papers → `seed` of those ids, then `subtract` from the kept set;
- a systematic error → revise the criteria and `judge` again on the same parent.

Name correction nodes for what they did ("人工补回 3 篇", "manual removals").

## Classification

`classify` is for an established grouping need: method family, problem
setting, evidence type. It is a view of a screened set, not a substitute for
the inclusion check. Write each category's criteria as distinctly as an
inclusion criterion; overlapping categories call for `multi_label`. Check
representative assignments and the `uncertain` / `other` papers. A broad or
ambiguous grouping should be proposed to the user rather than silently
imposed. Multi-label sends one request per paper, so prefer screening first.

## Without Jev

If no Jev key is configured (or it is rejected), tell the user once that AI
screening needs a key in the Parallax Settings tab; if Jev answers HTTP 451,
tell them it is blocked in their region and a proxy fixes it; you can save
one with `parallax_ingest configure` once they give you its HTTP port
(`guides/getting-started.md`). Then continue:

- For a small set, read the abstracts yourself: `members` with
  `full_abstract: true` (10 per page), or `parallax` `paper` with `ids` for
  specific papers. Do not decide on a trimmed abstract.
- For a large set, split the ids into chunks of 20–40 and give each
  `subagent` the exact criteria, its chunk's metadata and abstracts, and a
  required output: `[{id, decision: "include"|"exclude"|"uncertain", reason}]`.
  Validate that each returned id set equals the input chunk; retry failed
  chunks.
- Record the result as nodes: `seed` the included ids (and, if useful, the
  uncertain ones separately). Keep reasons for consequential decisions in the
  answer, not in the graph.

## Evidence discipline

- An abstract supports a relevance decision; it does not support a detailed
  experimental comparison. Read methods and results (`web_fetch` arXiv HTML)
  before comparing.
- Do not infer mechanisms from titles. Do not invent benchmark numbers.
- Do not present a Jev probability as a finding, and do not describe a paper as
  verified when only Jev read it.
- `uncertain` is never counted as included.
