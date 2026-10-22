/**
 * The plugin's single research skill as a composer command.
 *
 * DSH's `+` menu shows client command contributions, not the `/` skill source.
 * This contribution adds one row ("Literature search") under the command section;
 * choosing it toggles `/parallax-skills` in the draft, so no separate
 * composer button is needed. The command is named `parallax` (the menu shows
 * it next to the label) and the skill `parallax-skills`: a line whose `/name`
 * matches a command name is claimed by that command and never sent, so the
 * two must not share a name.
 */

import { BrandMark } from './brand.tsx'
import type { Translate } from './i18n.ts'

const TOKEN = '/parallax-skills'

interface InsertionSpan {
  start: number
  end: number
  draftRev: number
}

interface InputShell {
  snapshot?: { draft?: string }
  actions: {
    captureInsertion: () => InsertionSpan
    insertText: (text: string, span: InsertionSpan) => boolean
    setDraft: (text: string) => void
  }
  /** Insert plain text at the live selection (same path as a paste). */
  paste?: (text: string) => void
  focus?: () => void
}

interface CommandContext {
  effect: (fn: () => () => void) => void
  get: (name: string) => unknown
  sessions: {
    scope: (sessionId: string) => unknown
    subagentAddress?: (sessionId: string) => unknown
  }
  commandUi: {
    register: (contribution: Record<string, unknown>) => () => void
  }
}

/**
 * Whether the draft holds the skill token as a whitespace-bounded word, the
 * same rule the host uses; `/parallax` or `/parallax-skills-x` do not count.
 */
function hasSkillToken(text: string): boolean {
  return /(?:^|\s)\/parallax-skills(?=\s|$)/.test(text)
}

/** Remove every skill token and the spaces that separated it, keeping newlines. */
function stripSkillToken(text: string): string {
  return text
    .replace(/(^|[ \t]+)\/parallax-skills(?=\s|$)[ \t]?/gm, ' ')
    .replace(/^[ \t]+|[ \t]+$/g, '')
}

/** The brand mark, tinted by the surrounding menu row. */
function CommandIcon({ size = 14 }: { size?: number }): JSX.Element {
  return <BrandMark size={size} tone="current" />
}

/**
 * Register the `+` menu command. The action toggles the skill token; a second
 * invocation removes it.
 */
export function registerSkillCommand(ctx: CommandContext, tr: Translate): void {
  ctx.effect(() => ctx.commandUi.register({
    name: 'parallax',
    label: () => tr('command.label'),
    description: () => tr('command.description'),
    icon: CommandIcon,
    available: (session: { sessionId?: string }) =>
      session.sessionId !== undefined && ctx.sessions.subagentAddress?.(session.sessionId) === undefined,
    ui: {
      kind: 'action',
      run: (session: { sessionId?: string }) => {
        if (session.sessionId === undefined) return
        const scope = ctx.sessions.scope(session.sessionId)
        if (scope === undefined) return
        const conversation = ctx.get('conversation') as {
          input?: { for: (actx: unknown) => InputShell | undefined }
        } | undefined
        const shell = conversation?.input?.for(scope)
        if (shell === undefined) return
        const draft = shell.snapshot?.draft ?? ''
        if (hasSkillToken(draft)) {
          shell.actions.setDraft(stripSkillToken(draft))
        } else if (typeof shell.paste === 'function') {
          shell.paste(` ${TOKEN} `)
        } else {
          const span = shell.actions.captureInsertion()
          shell.actions.insertText(` ${TOKEN} `, span)
        }
        shell.focus?.()
      },
    },
  }))
}
