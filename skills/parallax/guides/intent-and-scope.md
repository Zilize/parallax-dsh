# Intent and scope

Read this before resolving a material scope ambiguity or designing a
clarification. The goal is to infer the boundary the user already implies, not
to administer an intake form.

## The four boundaries

Infer these from the request and prior turns:

1. **Purpose** — orientation, a reading list, a survey/review, a method
   landscape, a novelty/lineage check, or a decision.
2. **Time** — a period, "recent", a venue/year, or no bound. For a month
   without a year, use the most recent completed occurrence consistent with
   the conversation and state the assumption. Compare it with the
   submission-date range `parallax status` vouches for: a window outside it is
   a coverage limit to state, not a reason to change the user's window.
3. **Inclusion boundary** — what counts as in scope: task, method family,
   application, publication type, source. A topic name can hide a
   consequential boundary.
4. **Depth** — a handful of papers, a representative sample, a comprehensive
   set, or reading full texts.

## When to ask

Ask only when different plausible readings materially change which papers
belong or how much work is useful. Ask one question, preferably with two
distinct options, and include the most consequential boundary first:

- Do not bundle breadth, subfield, grouping and export into one multi-part
  question.
- Do not ask a newcomer to choose among unfamiliar subfields before explaining
  them.
- Do not ask permission for ordinary work: searching, reading abstracts,
  creating free set nodes. Ask before **paid** work only when its size is out
  of proportion to the request (thousands of papers for a quick question), or
  when the user has asked to approve costs.
- Do not ask whether to export; export when the user wants a file.
- A generic closing invitation ("anything else?") is not a scope question.
- If silence follows a question, do not treat it as a choice.

## How to ask

When clarification determines the current work, call `ask_user_question` and
wait for the answer. Do not put that decision in the last sentence of a final
answer and continue as if the user had chosen. A short lead-in may explain the
finding that raised the question. Plain-text optional directions are fine
after a complete answer when no reply is needed to finish the request; do not
turn every future idea into a form.

For exploratory research, ask exactly **one** decision now, normally with two
distinct options. The ability to send several questions is a ceiling, not a
target. If topic boundary and depth are both unstated, ask about the boundary
first, then make useful progress at a modest depth instead of asking another
intake question. Do not add a duplicate "include both" option when one option
already includes both families. Do not attach classification or export to an
option about scope.

Ask in the user's language from the first sentence. One real research
distinction is enough: do not fill option descriptions with title lists. Read
enough evidence before using a paper as an example of a side of the boundary,
or explain the distinction without naming one.

## A confirmed answer is working context

Once the user answers, apply it; do not ask breadth, grouping or export again.
If the user replies "今年，只看实时的，先推荐三篇" / "This year, live input only,
three papers first", proceed to three grounded choices: the three title links
and 1–2 useful sentences per paper, plus only a consequential caveat. No bonus
catalogue, process recap or unsolicited performance numbers. If the user asks
for a complete relevant set, resolve inclusion criteria, screen the noisy
candidates and review the resulting set.

## Examples

Adapt to the evidence and answer only in the user's language.

- "找六七月交互式视频生成的工作" / "Find June–July interactive video
  generation papers": if the probe shows both live generation responding to
  user input and offline generation with preset controls, ask "你主要关注生成中
  可实时操作的，还是也包括预先指定轨迹等条件的可控生成？" / "Do you mean live input
  during generation, or also generation with controls specified in advance?"
  Do not silently include both, build a set, then ask the user to narrow it.
- "只看生成过程中能实时响应操作的，挑三篇" / "Three papers on live input during
  generation": scope and depth are clear. Search, read the relevant abstracts
  and explain three choices. No intake question, no set, no Jev job.
- "尽量全面，写综述用" / "As complete as possible for a review": check omissions
  and inclusion criteria; this does not request classification. Ask a boundary
  question only if it changes inclusion, not which operator or threshold to
  use.
- "将已有论文按方法分组" / "Group my existing papers by method": grouping is
  requested. Classify the existing set (see `cases/existing-material.md`); do
  not start a fresh literature search.

## Broad requests

A broad request such as "find this month's related work" can mean a
representative overview or a comprehensive body of relevant papers. Run one or
two small probes and read representative abstracts; if more material exists
than a few recommendations can represent, ask one grounded question about
representative versus comprehensive coverage. Do not silently choose sampling.
A request for brevity controls answer length, not coverage: keep an agreed
scope and shorten the narration.

## Exact requests

An exact title or identifier, a specific paper question, or "recommend five
papers" has its own boundary. Do not expand it into a full survey or ask about
comprehensive coverage. For an ambiguous title, use observed candidates to
disambiguate. A paper missing from the corpus may still exist: look it up
externally before saying it cannot be found.

## Revising scope

When a later finding changes the research need, pause dependent work and
discuss the change. Do not restart completed work just to follow a case's
workflow. A changed scope is a new node (a new `rule_filter` or a `subtract`),
never a silent reinterpretation of an existing one; name nodes so the canvas
shows which scope each one applies.
