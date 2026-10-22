/**
 * Client side of the ingestion API. The shapes are the host's own types,
 * imported type-only.
 */

import type { CalendarDay, JobRecord } from '../ingest/db.ts'
import { post, request, sharedValue } from './http.ts'

export type { CalendarDay, HarvestProgress } from '../ingest/db.ts'
export type Job = JobRecord
export type DayStatus = CalendarDay['status']

export interface IngestState {
  year: number
  categories: string[]
  calendar: CalendarDay[]
  job: Job | null
  busy: boolean
  totalPapers: number
}

/** Recent harvest jobs, newest first. */
export async function loadJobs(limit: number): Promise<Job[]> {
  return (await request<{ jobs: Job[] }>(`/api/parallax/ingest/jobs?limit=${limit}`)).jobs
}

export async function loadState(year: number): Promise<IngestState> {
  return await request<IngestState>(`/api/parallax/ingest/state?year=${year}`)
}

export async function loadCategories(): Promise<string[]> {
  return (await request<{ categories: string[] }>('/api/parallax/ingest/config')).categories
}

export async function saveCategories(categories: string[]): Promise<void> {
  await post('/api/parallax/ingest/config', { categories })
}

export async function runRange(from: string, to: string): Promise<void> {
  await post('/api/parallax/ingest/run', { from, to })
}

export async function cancelJob(): Promise<void> {
  await post('/api/parallax/ingest/cancel', {})
}

/**
 * When the model starts a harvest, the Ingest tab jumps to that run's year
 * and reloads, whether it is opening now or already open. `seq` makes a
 * repeated focus on the same year still count as a change.
 */
export const ingestFocus = sharedValue<{ year: number, seq: number } | null>(null)

export function focusIngest(year: number): void {
  ingestFocus.set({ year, seq: (ingestFocus.get()?.seq ?? 0) + 1 })
}
