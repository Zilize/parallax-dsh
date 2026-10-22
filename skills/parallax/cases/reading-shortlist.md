# Entering a field, selected reading and exact lookup

Use this workflow as a reference, adapting or skipping steps to match the user's
question, prior work and evidence. Tool contracts are in
`guides/tool-contracts.md`. Examples in Chinese and English are equivalent; use
only the user's language in the conversation.

## Entering an unfamiliar field

User: "我想入门这个领域，应该读什么？" / "I want to get started in this field.
What should I read?" The outcome is orientation and a usable reading route, not
a set. Adapt this starting strategy to existing context; it is not a mandatory
sequence of tool calls.

1. Infer the learning purpose and prerequisites. Ask one question only if, for
   example, learning the concepts versus implementing a method would
   substantially change the choices. Do not ask a newcomer to choose unfamiliar
   subfields before explaining them. If the topic itself is ambiguous, resolve
   that boundary first.
2. Find an orientation source: a relevant survey, tutorial or course reading
   list, usually through `web_search` (the corpus holds only harvested arXiv
   days and no tutorials). Read its scope, date and actual contents. Extract the
   central problems, main approaches and established terms — these become your
   keywords. Cross-check consequential divisions against another source or
   representative papers; one survey's taxonomy is not the field's consensus.
   If no useful survey exists, build a modest outline from verified
   representative works and say so.
3. Find complementary foundational and representative papers. Follow
   references when they explain the origin of an essential idea; search the
   corpus by the corresponding terms for recent representative work. Add recent
   work when it helps explain the current state, not merely because it is new.
4. Read abstracts before selection; read introductions or related work
   (`web_fetch`) to substantiate claims about origins, prerequisites and
   technical links. Evaluate relevance, learning value and complementarity.
   Citation counts (external) are supporting clues only: do not sort by count,
   use a universal cutoff, or treat low/missing counts as grounds for
   exclusion. A heavily cited dataset, survey and original method serve
   different roles. Do not claim a work is first or foundational without
   evidence of that contribution.
5. Give a short map of the field and a small reading route at the requested
   depth. Explain what each choice teaches, why it comes at that point and any
   essential prerequisite. An accessible explanation may precede a difficult
   original paper.

Older foundations are usually outside the harvested corpus: that is expected,
not a gap to report at length. Label which recommendations came from external
sources only when it matters to the user (for example, when they want the set
in the canvas).

Stop when the core questions and approaches relevant to the user's purpose have
checked examples and the reading order has an evidence-based rationale.
Investigate a consequential missing foundation; do not keep collecting
near-duplicate papers or run Jev over a field to produce an introductory list.

Example: "我有监督学习基础，想了解强化学习。" / "I know supervised learning and
want to understand reinforcement learning." Use that background without another
intake question. Establish the basic problem and the relevant method families
from checked teaching/survey material, then choose complementary readings that
bridge the prerequisite gap. Explain the progression; do not substitute the most
cited papers or this year's releases. If the user then asks to implement one
approach, follow `cases/solution-evidence.md`.

## A bounded reading shortlist or exact lookup

User: "推荐五篇帮助我理解这个主题的论文。" / "Recommend five papers to
understand this topic." Use the user's background and purpose to choose
complementary, representative works, explaining reading order and prerequisites
where useful. Do not deliver hundreds of papers or start a Jev job. Clarify
background only if it changes recommendations. Recent is not synonymous with
foundational or best for learning.

User supplies an exact title or identifier: `parallax paper` for an id, or a
`parallax search` on distinctive title words; look it up externally if it is
not in the corpus. Do not expand citations, create a broad survey or ask about
coverage. If the title is ambiguous, use observed candidates to disambiguate.

A shortlist needs no set. Create a `seed` only when the user wants to keep
working with those papers in the canvas (screen around them, compare, export).

For a three-paper request, a useful result is three titles with links, a short
account of their different questions, and a suggested reading order. Do not
append another ten titles or repeat the retrieval history. Avoid quoting
abstract benchmark numbers to make a recommendation look rigorous; explain why
each work serves the reader. If asked about those numbers or experimental
superiority, read the actual evidence.
