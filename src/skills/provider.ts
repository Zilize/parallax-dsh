/**
 * Packaged skill provider for the Parallax set-builder playbook.
 *
 * The skill lives as real files under `skills/` so the model can read a guide
 * or case only when the playbook asks for it. The provider exposes one skill
 * whose resource base is that directory; the catalog carries only the
 * description, which keeps the always-on context cost to one line.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Public skill name (the `/name` token users and models write). */
const SKILL_NAME = 'parallax-skills'

/** Provider name registered on the skill registry. */
const PROVIDER_NAME = 'Parallax'

/** Fully qualified skill directory, resolved from the built `lib/index.js`. */
export const SKILL_DIR = fileURLToPath(new URL('../skills/parallax/', import.meta.url))

const SKILL_FILE = fileURLToPath(new URL('../skills/parallax/SKILL.md', import.meta.url))

/** The slice of the DSH skill-provider contract this package relies on. */
export interface SkillProviderControl {
  readonly signal: AbortSignal
  invalidate(): void
}

export interface SkillCandidate {
  name: string
  description: string
  whenToUse?: string
  invocation: { modelInvocable: boolean, userInvocable: boolean }
  source: string
  provider: string
  rank: number
  path?: string
  resourceBase?: { kind: 'directory', path: string }
}

export interface SkillDefinition extends SkillCandidate {
  content: string
}

interface Frontmatter {
  meta: Record<string, string>
  body: string
}

/**
 * Parse the small YAML frontmatter subset used by `SKILL.md`: flat
 * `key: value` lines, optional surrounding quotes. Multi-line YAML is not
 * needed here; descriptions stay on one line.
 */
function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith('---')) return { meta: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: text }
  const head = text.slice(3, end).trim()
  const after = text.indexOf('\n', end + 1)
  const body = after === -1 ? '' : text.slice(after + 1).replace(/^\s*\n/, '')
  const meta: Record<string, string> = {}
  for (const line of head.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (match === null) continue
    const raw = match[2].trim()
    meta[match[1]] = raw.replace(/^(['"])(.*)\1$/, '$2')
  }
  return { meta, body }
}

/** Read the skill metadata and body from disk. */
async function loadSkill(): Promise<SkillDefinition | undefined> {
  let text: string
  try {
    text = await readFile(SKILL_FILE, 'utf8')
  } catch {
    return undefined
  }
  const { meta, body } = parseFrontmatter(text)
  const name = meta.name ?? SKILL_NAME
  const description = meta.description
  if (name !== SKILL_NAME || description === undefined || description === '') return undefined
  return {
    name,
    description,
    ...meta.whenToUse === undefined || meta.whenToUse === '' ? {} : { whenToUse: meta.whenToUse },
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'parallax',
    provider: PROVIDER_NAME,
    rank: 600,
    path: SKILL_FILE,
    resourceBase: { kind: 'directory', path: SKILL_DIR },
    content: body,
  }
}

/**
 * Build the provider object. `list` reads only the file needed for the
 * catalog; `get` re-reads the body so editing a guide or playbook needs no
 * registry invalidation.
 */
export function createParallaxSkillProvider(_control: SkillProviderControl): {
  name: string
  list: () => Promise<SkillCandidate[]>
  get: (candidate: SkillCandidate) => Promise<SkillDefinition | undefined>
} {
  return {
    name: PROVIDER_NAME,
    async list(): Promise<SkillCandidate[]> {
      const skill = await loadSkill()
      if (skill === undefined) return []
      const { content: _content, ...candidate } = skill
      return [candidate]
    },
    async get(candidate: SkillCandidate): Promise<SkillDefinition | undefined> {
      const skill = await loadSkill()
      if (skill === undefined || skill.name !== candidate.name) return undefined
      return skill
    },
  }
}
