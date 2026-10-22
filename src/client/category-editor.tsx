/**
 * arXiv category scope editor, shown on the Settings page: subject presets
 * fill a whole group, the chip field takes single categories. Every change is
 * saved on the host right away, because the ingest calendar measures coverage
 * against this exact set.
 */

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { GROUP_TAGS, GROUPS, isKnownCategory, type Group } from '../taxonomy.ts'
import type { LocaleKey, Translate } from './i18n.ts'

export function CategoryEditor({ categories, onChange, tr }: { categories: string[], onChange: (next: string[]) => void, tr: Translate }): JSX.Element {
  const [draft, setDraft] = useState('')
  const addGroup = (group: Group): void => {
    const merged = [...categories]
    for (const tag of GROUP_TAGS[group]) if (!merged.includes(tag)) merged.push(tag)
    onChange(merged)
  }
  return (
    <>
      <div className="pg-presets">
        {GROUPS.map(group => (
          <button key={group} type="button" className="pg-preset" onClick={() => addGroup(group)}>
            {tr(`group.${group}` as LocaleKey)}
            <span className="pg-preset-tag">{GROUP_TAGS[group].length}</span>
          </button>
        ))}
      </div>
      <TagsField
        tags={categories}
        draft={draft}
        placeholder={tr('ingest.placeholder')}
        onDraft={setDraft}
        onCommit={(next) => { setDraft(''); onChange(next) }}
      />
    </>
  )
}

/**
 * Chip field: one bordered field that holds the chips and grows an inline
 * input. Enter, comma, space or blur commits; Backspace on an empty draft
 * removes the last chip. Presets above simply fill this same list.
 */
function TagsField({
  tags,
  draft,
  placeholder,
  onDraft,
  onCommit,
}: {
  tags: string[]
  draft: string
  placeholder: string
  onDraft: (value: string) => void
  onCommit: (next: string[]) => void
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const add = (raw: string): void => {
    const value = raw.trim()
    if (value === '') return
    // Unknown codes and duplicates are dropped rather than committed.
    if (!tags.includes(value) && isKnownCategory(value)) onCommit([...tags, value])
    onDraft('')
  }
  const removeTag = (tag: string): void => onCommit(tags.filter(item => item !== tag))

  return (
    <div className="pg-tags" onClick={() => input.current?.focus()}>
      {tags.map(tag => (
        <span key={tag} className="pg-tag">
          {tag}
          <button
            type="button"
            aria-label={`✕ ${tag}`}
            onClick={(event) => { event.stopPropagation(); removeTag(tag) }}
          >
            <X size={12} aria-hidden />
          </button>
        </span>
      ))}
      <input
        ref={input}
        value={draft}
        placeholder={tags.length === 0 ? placeholder : ''}
        autoComplete="off"
        onChange={(event) => onDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
            event.preventDefault()
            add(draft)
          } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
            removeTag(tags[tags.length - 1])
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  )
}
