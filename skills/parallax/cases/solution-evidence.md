# Solutions and evidence — answer the research question, not just find titles

Use this workflow as a reference, adapting or skipping steps to match the user's
question, prior work and evidence. Tool contracts are in
`guides/tool-contracts.md`. Examples in Chinese and English are equivalent; use
only the user's language in the conversation.

## Recommended approach for choosing a method

1. Translate the problem into the outcome and constraints that affect method
   choice: available data, labels, compute, latency or deployment conditions.
   Reuse known constraints; ask only the most consequential missing question.
   Do not make the user choose a method family before they understand the
   alternatives.
2. Search for approaches to the problem, including established alternatives
   and simple baselines — in the corpus for recent arXiv work, externally for
   older or non-arXiv sources. If the user names a method, apply
   `cases/method-search.md` to distinguish actual use from a passing citation.
   Read abstracts to identify plausible routes; similarity, recency and
   citation counts do not prove suitability.
3. Read the methods and experiments needed to test suitability (`web_fetch`
   the papers; the corpus holds abstracts only). Compare assumptions, data
   regime, evaluation protocol, resource needs and failure conditions against
   the user's constraints. Do not rank numbers from incompatible benchmarks as
   though they were one experiment. Missing evidence remains unknown, not a
   pass.
4. When implementation matters, find the official project/repository or other
   primary source externally (the corpus has no code links; a comments field
   sometimes names one). Distinguish official code, third-party code, a
   promised release and no verified implementation. Check relevant
   instructions, dependencies, weights/data availability and stated hardware
   requirements. A link or license alone does not establish reproducibility;
   do not say code runs or results reproduce unless actually verified. Do not
   install or run external code merely to answer a literature request.
5. Recommend a small number of options conditionally: why each fits, the
   tradeoff, and what evidence or small evaluation would resolve remaining
   uncertainty. Stop when the important alternatives and constraints are
   sufficiently checked; if none is supported, explain the specific evidence
   gap.

This is a reading task, usually without a set or a Jev job. Build a set only
when the candidate pool is large enough that screening it is the honest way to
find the alternatives.

Example: "我的标注数据很少，想找有代码的方法。" / "I have little labeled data
and need a method with code." Clarify the task if unknown, then compare
suitable routes under that data regime. Mark verified code availability
separately from evidence of effectiveness. An available implementation may be
worth trying without being the best-performing or reproducible choice.

## Recommended approach for checking a claim

Turn the claim into the conditions and outcomes that would support or challenge
it. Search neutrally for both evidence and counterevidence; do not presuppose
two opposing camps. Read the relevant baselines, ablations and limitations,
checking whether apparent disagreement comes from different settings. A Jev
screen can narrow candidates to papers that test the claim, but only reading
establishes what they found. Answer with the scope supported by the evidence
and identify what remains unresolved. Stop when that bounded conclusion is
justified, not when equal numbers of positive and negative papers have been
collected.

User: "标注数据有限，应该尝试哪种方法？" / "Which approach should I try with
limited labeled data?" Identify the material constraints (task, data, compute
or deployment) from context. Ask the one missing constraint that changes the
recommendation, using an initial probe if useful. Compare candidate methods by
assumptions and relevant evaluations. Read experiments before claiming
superiority; incompatible benchmarks cannot be ranked as equivalent.

User: "加入记忆能改善长时一致性吗？" / "Does adding memory improve long-horizon
consistency?" Search for evidence and counterevidence, baselines and ablations.
Distinguish author claims from results and your interpretation. A pile of
papers containing both terms is not an answer. If evidence is insufficient,
describe what is missing and investigate where feasible. A focused comparison,
a qualified answer or an experiment suggestion can be the outcome.
