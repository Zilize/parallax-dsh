/**
 * arXiv subject taxonomy, generated from the OAI `ListSets` response:
 * 8 top-level groups and 158 category codes. A code is the arXiv category
 * itself (cs.LG, physics.acc-ph, astro-ph.CO, hep-th). OAI has a set per group
 * (`cs`) and per category (`cs:cs:LG`, `physics:astro-ph:CO`); a record's
 * setSpecs list every one of its categories, cross-lists included, so either
 * kind is complete for its codes. Harvests still filter locally.
 */

export const GROUPS = ["cs","econ","eess","math","physics","q-bio","q-fin","stat"] as const
export type Group = (typeof GROUPS)[number]

/** Official category codes per group — the picker's one-click fill. */
export const GROUP_TAGS: Record<Group, readonly string[]> = {
  "cs": ["cs.AI","cs.AR","cs.CC","cs.CE","cs.CG","cs.CL","cs.CR","cs.CV","cs.CY","cs.DB","cs.DC","cs.DL","cs.DM","cs.DS","cs.ET","cs.FL","cs.GL","cs.GR","cs.GT","cs.HC","cs.IR","cs.IT","cs.LG","cs.LO","cs.MA","cs.MM","cs.MS","cs.NA","cs.NE","cs.NI","cs.OH","cs.OS","cs.PF","cs.PL","cs.RO","cs.SC","cs.SD","cs.SE","cs.SI","cs.SY"],
  "econ": ["econ.EM","econ.GN","econ.TH"],
  "eess": ["eess.AS","eess.IV","eess.SP","eess.SY"],
  "math": ["math.AC","math.AG","math.AP","math.AT","math.CA","math.CO","math.CT","math.CV","math.DG","math.DS","math.FA","math.GM","math.GN","math.GR","math.GT","math.HO","math.IT","math.KT","math.LO","math.MG","math.MP","math.NA","math.NT","math.OA","math.OC","math.PR","math.QA","math.RA","math.RT","math.SG","math.SP","math.ST"],
  "physics": ["astro-ph","astro-ph.CO","astro-ph.EP","astro-ph.GA","astro-ph.HE","astro-ph.IM","astro-ph.SR","cond-mat","cond-mat.dis-nn","cond-mat.mes-hall","cond-mat.mtrl-sci","cond-mat.other","cond-mat.quant-gas","cond-mat.soft","cond-mat.stat-mech","cond-mat.str-el","cond-mat.supr-con","gr-qc","hep-ex","hep-lat","hep-ph","hep-th","math-ph","nlin","nlin.AO","nlin.CD","nlin.CG","nlin.PS","nlin.SI","nucl-ex","nucl-th","physics.acc-ph","physics.ao-ph","physics.app-ph","physics.atm-clus","physics.atom-ph","physics.bio-ph","physics.chem-ph","physics.class-ph","physics.comp-ph","physics.data-an","physics.ed-ph","physics.flu-dyn","physics.gen-ph","physics.geo-ph","physics.hist-ph","physics.ins-det","physics.med-ph","physics.optics","physics.plasm-ph","physics.pop-ph","physics.soc-ph","physics.space-ph","quant-ph"],
  "q-bio": ["q-bio.BM","q-bio.CB","q-bio.GN","q-bio.MN","q-bio.NC","q-bio.OT","q-bio.PE","q-bio.QM","q-bio.SC","q-bio.TO"],
  "q-fin": ["q-fin.CP","q-fin.EC","q-fin.GN","q-fin.MF","q-fin.PM","q-fin.PR","q-fin.RM","q-fin.ST","q-fin.TR"],
  "stat": ["stat.AP","stat.CO","stat.ME","stat.ML","stat.OT","stat.TH"],
}

const GROUP_OF = new Map<string, Group>()
for (const group of GROUPS) {
  for (const code of GROUP_TAGS[group]) GROUP_OF.set(code, group)
}

export function isKnownCategory(token: string): boolean {
  if (token.endsWith('.*')) return (GROUPS as readonly string[]).includes(token.slice(0, -2))
  return GROUP_OF.has(token)
}

/** OAI sets (subject groups) a category scope needs: one per distinct group. */
function groupsFor(categories: readonly string[]): Group[] {
  const out: Group[] = []
  for (const token of categories) {
    const group = token.endsWith('.*') ? (token.slice(0, -2) as Group) : GROUP_OF.get(token)
    if (group !== undefined && !out.includes(group)) out.push(group)
  }
  return out.length === 0 ? ['cs'] : out
}

/**
 * Per-category sets overlap through cross-lists, so beyond a handful of codes
 * one group set is fewer requests than the categories it would replace.
 */
const MAX_CATEGORY_SETS_PER_GROUP = 4

/** OAI set spec of one category code: `cs.LG` → `cs:cs:LG`, `hep-th` → `physics:hep-th`. */
function oaiSetOf(code: string): string | undefined {
  const group = GROUP_OF.get(code)
  if (group === undefined) return undefined
  return `${group}:${code.replace('.', ':')}`
}

/**
 * Narrowest OAI sets covering a scope: per-category sets for a group with only
 * a few requested codes, the whole group set otherwise (and for `<group>.*`).
 */
export function oaiSetsFor(categories: readonly string[]): string[] {
  const byGroup = new Map<Group, Set<string>>()
  const whole = new Set<Group>()
  for (const token of categories) {
    if (token.endsWith('.*')) {
      const group = token.slice(0, -2) as Group
      if ((GROUPS as readonly string[]).includes(group)) whole.add(group)
      continue
    }
    const group = GROUP_OF.get(token)
    if (group === undefined) continue
    const codes = byGroup.get(group) ?? new Set<string>()
    codes.add(token)
    byGroup.set(group, codes)
  }
  const out: string[] = []
  for (const group of groupsFor(categories)) {
    const codes = byGroup.get(group)
    if (whole.has(group) || codes === undefined || codes.size > MAX_CATEGORY_SETS_PER_GROUP) {
      out.push(group)
      continue
    }
    for (const code of codes) out.push(oaiSetOf(code) as string)
  }
  return out
}

/** Does a record belong to any requested category? `<group>.*` matches the group. */
export function matchesCategories(categories: readonly string[], requested: readonly string[]): boolean {
  if (requested.length === 0) return true
  for (const token of requested) {
    if (token.endsWith('.*')) {
      const group = token.slice(0, -2)
      if (categories.some(code => GROUP_OF.get(code) === group)) return true
    } else if (categories.includes(token)) return true
  }
  return false
}

/** One requested code covered by one recorded scope (exact or a group wildcard). */
export function categoryCovered(requested: string, covered: ReadonlySet<string>): boolean {
  if (covered.has(requested)) return true
  if (requested.endsWith('.*')) return false
  const group = GROUP_OF.get(requested)
  if (group === undefined) return false
  return covered.has(`${group}.*`)
}

/** Any overlap — the calendar's `partial` state. */
export function categoriesOverlap(requested: ReadonlySet<string>, covered: ReadonlySet<string>): boolean {
  for (const token of requested) if (categoryCovered(token, covered)) return true
  for (const token of covered) if (categoryCovered(token, requested)) return true
  return false
}

/** Concrete codes for a scope: wildcards expand to their group's categories. */
export function expandCategories(tokens: readonly string[]): string[] {
  const out: string[] = []
  for (const token of tokens) {
    if (token.endsWith('.*')) {
      const group = token.slice(0, -2) as Group
      for (const code of GROUP_TAGS[group] ?? []) if (!out.includes(code)) out.push(code)
    } else if (!out.includes(token)) {
      out.push(token)
    }
  }
  return out
}

/** Normalize user input (a comma-separated string or an array): trim, validate, dedupe in order. */
export function normalizeCategories(input: unknown, options: { allowEmpty?: boolean } = {}): string[] {
  const raw = typeof input === 'string' ? input.split(',') : Array.isArray(input) ? input : null
  if (raw === null) throw new Error('categories must be a string or an array')
  const cleaned = raw.map(value => String(value).trim()).filter(value => value !== '')
  if (cleaned.length === 0) {
    if (options.allowEmpty === true) return []
    throw new Error('select at least one category')
  }
  for (const token of cleaned) {
    if (!isKnownCategory(token)) {
      throw new Error(`category "${token}" is not in the arXiv taxonomy: use a known code (cs.LG, physics.acc-ph, ...) or a group wildcard like cs.*`)
    }
  }
  return [...new Set(cleaned)]
}
