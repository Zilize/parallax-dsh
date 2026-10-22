# Tracing predecessors and follow-ups

Use this case when the user asks where a named idea came from or how it
developed. Tool contracts are in `guides/tool-contracts.md`.

The corpus has **no citation graph** and no full text, so lineage is read, not
queried:

1. Verify the seed paper and the method the user means (`parallax paper`, or an
   external lookup when it predates the harvest).
2. Read its related-work and reference sections (`web_fetch` arXiv HTML).
   Predecessors usually live outside the harvested window; look them up
   externally and read the relevant passages.
3. For follow-ups, search the corpus for the method's name, abbreviation and
   the paper's distinctive terminology (a `rule_filter` route, optionally
   inside a date scope after the seed's submission), and use an external
   citation index for papers outside the harvest. Record which source supplied
   each relationship.
4. Read the relevant passages before claiming inheritance: shared terminology
   or publication dates are not enough. Distinguish technical predecessors,
   extensions, applications, critiques and merely related work. State
   uncertainty when the original text cannot be verified.

Do not promise exhaustive citing-paper lists, citation counts or graph
coverage. A missing search result does not establish that there are no
follow-ups. For a reusable working set, `seed` the verified ids and combine
them with keyword routes, screening, `union` or `subtract` as appropriate.
Preserve the requested date range. Stop once the requested relationships are
explained with evidence.
