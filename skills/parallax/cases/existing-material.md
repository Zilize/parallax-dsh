# Existing material — supplement, narrow, regroup or revisit without starting over

Use this workflow as a reference, adapting or skipping steps to match the user's
question, prior work and evidence. Tool contracts are in
`guides/tool-contracts.md`. Examples in Chinese and English are equivalent; use
only the user's language in the conversation.

"Existing material" is either this conversation's set graph (`inspect`) or
papers the user provides — a list of ids or titles, a bibliography, an
exported Parallax JSON file. Sets of other conversations are not addressable;
material from elsewhere enters this conversation as a `seed` of its arXiv ids.

## Recommended approach

1. Resolve the intended material and the requested change: fill gaps,
   regroup, broaden, narrow or discuss. Reuse agreed boundaries and prior
   findings. Inspect actual members (`members`), not just a node's name. Ask
   only if the intended object or research boundary is materially ambiguous.
   For provided papers, `seed` their ids; report the ones not in the corpus
   (outside the harvest) and handle them by reading, not by silently dropping
   them.
2. Inspect the evidence appropriate to the change. For gap finding, compare
   current coverage with the research purpose and verify plausible omissions in
   representative abstracts. For grouping, determine the useful dimension from
   the request and whether overlap is appropriate. For a scientific question,
   read the relevant papers rather than reorganizing or supplementing by
   default.
3. Take the applicable branch, not all branches:
   - **Supplement / broaden**: build routes for the specific gaps,
     `subtract` the existing set from them to see only additions, verify that
     additions meet the boundary (screen them with the same criteria when the
     existing set was screened), then `union` the accepted additions with the
     existing set. Use external discovery for a demonstrated source gap.
   - **Regroup**: `classify` the existing node; check representative
     assignments and the `uncertain` / `other` papers. Do not retrieve more
     papers or hand-build large seed lists for grouping.
   - **Narrow**: apply the user's actual condition — a rule for a metadata
     condition (date, category, keyword), `trial` + `judge` for a semantic one.
     Review consequential exclusions instead of optimizing the count.
   - **Discuss**: answer from the available papers and read further only as
     needed.
4. Check the resulting members and report the meaningful change from the
   starting material. Unchanged criteria can support judging only additions (a
   `judge` node's `resume` judges only new papers); a changed boundary may
   require revisiting earlier inclusions and exclusions. Nodes are immutable:
   say that the result is a new set derived from the original, which itself is
   unchanged.
5. Stop when the requested gaps or reorganization have been addressed at the
   agreed depth, or the scientific question has a supported answer. Explain
   unresolved access or coverage limits.

## Requests and continuation examples

User: "这份清单还缺哪些相关工作？" / "What is missing from this list?" Locate the
intended set or seed the provided list, infer its research purpose from context
and inspect coverage. Search plausible gaps and subtract what is already
present. Do not treat everything outside it as a gap: explain why an addition
belongs. If the purpose is unclear, discuss the most consequential boundary with
examples rather than ask the user to define a taxonomy.

User: "把这些论文按方法分组。" / "Group these papers by approach." Classify
within the existing scope; do not search for new papers. Choose `multi_label`
when approaches overlap. Uncertain papers are unresolved, not automatically
irrelevant.

User: "把这份列表扩充一下。" / "Broaden that list." Continue from the
conversation's graph and respect the agreed inclusion criteria. Judge new
candidates, review additions and any changed conclusions. If the user then asks
a scientific question, follow it into discussion using the papers already
available.

User: "新抓了一周数据，之前那个集合更新一下。" / "I harvested another week; update
that set." Rule filters re-evaluate on their own; `inspect` shows new
`undecided` papers on judging nodes, and `resume` judges only those. Report what
the new papers add.
