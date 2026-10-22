# Method search — verify similar approaches, competing work and applications

Use this workflow as a reference, adapting or skipping steps to match the user's
question, prior work and evidence. Tool contracts are in
`guides/tool-contracts.md`. Examples in Chinese and English are equivalent; use
only the user's language in the conversation.

## Recommended approach

1. Identify the relationship being requested: understanding a method, finding
   innovations to it, applying it to a particular problem, or finding similar
   technical approaches and competing/contemporaneous work. Infer from the
   actual wording and context; do not ask again when the relationship is
   explicit. For a broad ambiguous method name, inspect a few examples before
   asking one useful question. Preserve both theory and applications if the
   user wants that breadth.
2. Map the method's established full names, abbreviations and technical
   formulations — keyword recall only finds these words. For an application
   request, combine them with the problem's terminology (two keyword rules on
   one `rule_filter`: method AND problem). Inspect abstracts for acronym
   collisions and neighboring methods; similar wording is a discovery clue, not
   proof of the requested relationship.
3. Verify what each candidate actually does. Read the method section
   (`web_fetch`) when an abstract cannot distinguish introducing, modifying,
   applying, evaluating or merely citing the method. Keep relevant applications
   even if they introduce no new algorithm. If a curated set is requested,
   screen against that relationship (`trial`, then `judge`); a small shortlist
   can be checked directly without a set or a Jev job.
4. Investigate a consequential missing formulation or application with a
   targeted route, or external discovery when the harvest is the obstacle. Read
   related-work sections when they help resolve a specific relationship. If the
   user wants to choose an approach for their constraints, continue with
   `cases/solution-evidence.md`; for conceptual grounding, use
   `cases/reading-shortlist.md`.
5. Present the verified roles and contributions of a few representative works,
   or the reviewed set at the requested depth. Stop when the requested
   relationship is evidenced, important variants have been checked and
   remaining gaps are clear. Do not expand into every application of the method
   or rank by citation counts.

## From a technical idea to competing or contemporaneous work

User: "我用「技术思路」解决「具体问题」，找相近方法和竞争或同期工作，结合原文核实。"
/ "I use [technical idea] to solve [problem]. Find similar approaches and
competing or contemporaneous work, and verify them in the original papers."
This starts from an existing idea, unlike choosing methods for a problem. The
idea need not have an established name.

1. Extract the target task, core mechanism and material assumptions from the
   user's description or reference paper. Read the reference's method when
   needed; do not substitute your memory of its name. Separate essential
   features from optional implementation details. Reuse the stated date scope;
   if "contemporaneous" lacks a meaningful anchor and timing changes inclusion,
   ask one grounded question. Corpus dates are v1 submission dates; do not treat
   a recent revision as a newly introduced method.
2. Retrieve candidates using names, aliases and plain descriptions of the
   mechanism ("learned reward from preferences", not only "RLHF"), combined with
   the task where appropriate — different terminology can describe similar
   mechanisms, and nothing finds them for you but the words you search.
   `guides/retrieval.md` covers route design. Jev screening reads title and
   abstract only: it establishes plausible candidates, not verified method use.
   Keep plausible candidates whose abstracts omit a required detail for targeted
   reading, including consequential suspected exclusions (`members`
   `status:"excluded"` near the threshold). Do not tighten screening repeatedly
   to reach an arbitrary small count.
3. Prioritize likely direct competitors, ambiguous cases and important potential
   omissions for original-paper checks: `web_fetch` the arXiv HTML
   (`https://arxiv.org/html/<id>`, or the abs page and PDF when HTML is missing)
   and read the method and, when the claim requires it, experiments or
   appendices. For many papers, split the reading across `subagent`s with the
   exact questions to answer and the section evidence to quote. A search snippet
   or a related-work mention is a lead, not a check.
4. Keep each consequential review traceable in the answer: paper and link, role
   of the method, shared mechanism, material differences, task/assumption
   comparability, and the section supporting the claim. Keep evidence status
   separate from relationship: original-text verified, abstract-only, or
   unresolved. Full text that is unavailable or silent about the key fact does
   not prove absence. Verified corrections to the set become nodes
   (`guides/screening.md`).
5. Present the technical comparison with source locations, not just titles.
   Distinguish directly comparable competing approaches, the same method applied
   to other tasks, and different methods addressing the same task. These
   relations can overlap; do not force exclusive categories or bulk
   classification. State whether the method is introduced, modified, applied,
   evaluated as a baseline or merely cited. Every paper claimed as a confirmed
   similar approach needs original-text evidence; a verified subset does not
   verify the set. Stop at the agreed depth and disclose remaining candidates
   and source gaps. No matches is not proof that the idea is novel.

## Evidence boundary examples

These are hypothetical decision examples, not claims about particular papers.

| Candidate evidence | Expected handling |
|---|---|
| The abstract omits the method name; the method section implements the required mechanism. | Keep the candidate, confirm from that section. |
| The name appears only in related work or an experimental baseline. | Do not describe the paper's own method as using it; keep as a comparison lead only when useful. |
| The paper uses a different name for a similar mechanism. | Compare the actual operations and assumptions, cite the evidence and explain remaining differences. |
| The same mechanism solves a different task. | A related application, not automatically a direct competitor. |
| The same task is solved by a different mechanism. | An alternative approach, separate from same-method matches. |
| Jev excluded it at p ≈ 0.4 and the abstract is ambiguous. | Read it before treating the exclusion as settled. |
| Full text fails, omits the decisive fact, or only part of the set was read. | Keep those papers unresolved or abstract-only; report exactly which subset was verified. |

## Scope decisions and examples

User: "找用最优传输做域适应的论文。" / "Find papers using optimal transport for
domain adaptation." The application relationship is explicit: do not ask whether
they want applications. Build routes from the method's names ("optimal
transport", "Wasserstein", "Sinkhorn") AND the problem's ("domain adaptation",
"distribution shift"); read whether the method is actually used, not just cited.
Do not limit results to papers that introduce a new transport algorithm.

User: "我想找扩散方法相关的论文。" / "I want papers on diffusion methods." A
small probe may reveal method theory, sampling improvements and diverse
applications — and, as a substring, unrelated diffusion processes in physics or
networks. Ask the most useful distinction in natural language, perhaps with two
real examples: understanding the method itself or using it for a particular
problem? Do not ask five scope questions at once. If the user wants breadth,
preserve both innovations and applications and make their roles clear.

An acronym alone may collide with unrelated fields: pair it with the full name
or a category. For empirical claims, read the relevant evidence. Present what
each family contributes to the user's purpose, not the sequence of queries.
