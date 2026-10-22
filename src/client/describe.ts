/**
 * Localized definition lines for a node, rendered from its raw parameters.
 * The host's `summary` stays English because the model reads it; the panes
 * describe the same definition in the user's language.
 */

import type { NodeView } from './sets-api.ts'
import type { LocaleKey, Translate } from './i18n.ts'

interface Scope { from?: string, to?: string, categories?: string[] }
type Rule =
  | { type: 'time_window', from?: string, to?: string }
  | { type: 'category', categories: string[], primary_only?: boolean }
  | { type: 'keyword', terms: string[], fields: string[], match: 'any' | 'all', mode: 'literal' | 'wildcard' }

function rule(value: Rule, tr: Translate): string {
  if (value.type === 'time_window') return tr('describe.window', { from: value.from ?? '…', to: value.to ?? '…' })
  if (value.type === 'category') return tr(value.primary_only === true ? 'describe.primary' : 'describe.category', { list: value.categories.join(' / ') })
  const terms = value.terms.map(term => `“${term}”`).join(tr(value.match === 'all' ? 'describe.and' : 'describe.or'))
  const fields = value.fields.map(field => tr(`describe.field.${field}` as LocaleKey)).join(' / ')
  return `${tr('describe.keyword', { terms, fields })}${value.mode === 'wildcard' ? tr('describe.words') : ''}`
}

function scopeRules(scope: Scope | undefined): Rule[] {
  if (scope === undefined) return []
  const rules: Rule[] = []
  if (scope.from !== undefined || scope.to !== undefined) rules.push({ type: 'time_window', from: scope.from, to: scope.to })
  if (scope.categories !== undefined) rules.push({ type: 'category', categories: scope.categories })
  return rules
}

/** The corpus-scope text of a root rule filter (its virtual universe pill). */
export function describeUniverse(node: NodeView, tr: Translate): string {
  const scope = (node.definition as { scope?: Scope }).scope
  const lines = scopeRules(scope).map(item => rule(item, tr))
  return lines.length === 0 ? tr('describe.corpus') : lines.join(' · ')
}

/** Definition lines of a node, in the UI language. */
export function describeNode(node: NodeView, nodes: readonly NodeView[], tr: Translate): string[] {
  const definition = node.definition as Record<string, unknown>
  if (node.op === 'seed') {
    const ids = (definition.ids as string[] | undefined) ?? []
    const missing = ids.length - node.count
    return [`${tr('describe.seed', { count: ids.length })}${missing > 0 ? tr('describe.seedMissing', { count: missing }) : ''}`]
  }
  if (node.op === 'rule_filter') {
    const rules = (definition.rules as Rule[] | undefined) ?? []
    const scope = node.parents.length === 0 ? [] : scopeRules(definition.scope as Scope | undefined)
    const lines = [...scope, ...rules].map(item => rule(item, tr))
    return lines.length === 0 ? [tr('describe.allInScope')] : lines
  }
  if (node.op === 'union') return [tr('describe.union', { count: node.parents.length })]
  if (node.op === 'subtract') return [tr('describe.subtract')]
  if (node.op === 'ai_filter') {
    const thresholds = definition.thresholds as { noul?: number } | undefined
    return [tr('describe.screening', { threshold: thresholds?.noul ?? 0.5 })]
  }
  if (node.op === 'ai_classifier') return [tr(node.mode === 'multi_label' ? 'describe.multi' : 'describe.single')]
  // classification_output: name the label with its criteria from the classifier.
  const classifier = nodes.find(item => item.code === node.parents[0]?.code)
  const categories = (classifier?.definition.categories as Array<{ key: string, name: string, criteria: string }> | undefined) ?? []
  const category = categories.find(item => item.key === definition.category)
  return category === undefined ? [] : [tr('describe.label', { name: category.name }), category.criteria]
}
