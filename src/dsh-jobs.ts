/**
 * Bridge to DSH's background-job registry (`ctx.jobs`, `@deepseek-ai/dsh-jobs`).
 *
 * Work the model starts — a harvest, a Jev judging run — is registered as a
 * job owned by the calling agent. DSH then lists it in the session header
 * (progress line, stop control) and, when it settles, hands the owner an
 * in-session completion notice, waking an idle agent, so the model need not
 * block on our own `wait` actions. Parallax stays the owner of the work: the
 * job's cancel hook calls the plugin's own cancel path, so a stop from the
 * header, the model's `job_kill` or the conversation closing ends the run
 * exactly as the Parallax panel's cancel does.
 *
 * Work started from the panel is never registered: it has no owning agent to
 * notify. Without a registry (a bare harness, an older dsh release) callers fall
 * back to the `wait` actions.
 */

/** The terminal record handed to the registry; mirrors `JobOutcome`. */
export interface DshJobOutcome {
  status: 'completed' | 'killed' | 'failed'
  /** One-line reason shown in the `[status: …]` line of the notice. */
  detail?: string
}

/** Producer face of a registered job; mirrors `JobHandle`. */
export interface DshJobHandle {
  readonly id: string
  append(text: string, options?: { channel?: 'stdout' | 'stderr' | 'log' }): void
  updateProgress(line: string): void
}

/** The slice of `JobRegistry` this plugin uses. */
export interface DshJobRegistry {
  start(spec: {
    kind: string
    label: string
    owner?: string
    toolCall?: { callId: string, rootCallId: string }
    run(job: DshJobHandle): { cancel(reason?: string): void, done: Promise<DshJobOutcome> }
  }): string
}

/** The tool-execution fields a registration needs. */
export interface DshToolExec {
  agent?: unknown
  callId?: string
  rootCallId?: string
}

/** What a producer hands back once its work is running. */
export interface ProducerHooks {
  /** Stop through the plugin's own cancel path. */
  cancel(): void
  /** Settles with the outcome and a summary for the model; must not reject. */
  done: Promise<DshJobOutcome & { summary: string }>
}

/**
 * Register `start` as a job owned by the calling agent. `start` runs
 * synchronously inside the registration, so a throw registers nothing and
 * propagates to the tool as an ordinary error.
 * @returns the DSH job id, or undefined when no registry or calling agent is
 *   available — the caller then runs `start` itself.
 */
export function startDshJob(
  registry: DshJobRegistry | undefined,
  exec: DshToolExec,
  spec: { kind: string, label: string, start: (job: DshJobHandle) => ProducerHooks },
): string | undefined {
  const owner = (exec.agent as { id?: string } | undefined)?.id
  if (registry === undefined || owner === undefined) return undefined
  return registry.start({
    kind: spec.kind,
    label: spec.label,
    owner,
    ...exec.callId !== undefined && exec.rootCallId !== undefined
      ? { toolCall: { callId: exec.callId, rootCallId: exec.rootCallId } }
      : {},
    run: (job) => {
      const hooks = spec.start(job)
      return {
        cancel: () => { hooks.cancel() },
        // The summary goes to stdout, which the completion notice carries.
        done: hooks.done.then(({ summary, ...outcome }) => {
          job.append(summary.endsWith('\n') ? summary : `${summary}\n`)
          return outcome
        }, (error: unknown) => ({ status: 'failed' as const, detail: error instanceof Error ? error.message : String(error) })),
      }
    },
  })
}
