/**
 * Export: the only way a set leaves the plugin. A plain JSON array — the
 * set's papers, one item per paper carrying its metadata. How the set was
 * built stays in the canvas; the file is the reading list itself.
 */

import type { DatabaseSync } from 'node:sqlite'

import { ensureFresh, listMembers, type SetRow } from './store.ts'

export interface ExportedPaper {
  id: string
  title: string
  authors: string[]
  published_at: string | null
  primary_category: string
  categories: string[]
  abstract: string
  abs_url: string
  pdf_url: string
}

export function exportSet(db: DatabaseSync, set: SetRow): ExportedPaper[] {
  const fresh = ensureFresh(db, set)
  const papers: ExportedPaper[] = []
  for (let offset = 0; offset < fresh.count; offset += 100) {
    const page = listMembers(db, set, { offset, limit: 100 })
    for (const paper of page.papers) {
      papers.push({
        id: paper.sourceId,
        title: paper.title,
        // Stored joined by ", " after parsing arXivRaw's free-text author line.
        authors: paper.authors.split(', ').filter(Boolean),
        published_at: paper.publishedAt,
        primary_category: paper.primaryCategory,
        categories: paper.categories.split(' ').filter(Boolean),
        abstract: paper.abstract,
        abs_url: paper.absUrl,
        pdf_url: paper.pdfUrl,
      })
    }
  }
  return papers
}

/** File-system friendly name for an exported set. */
export function exportFileName(set: SetRow): string {
  const slug = set.name.normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase()
  return `${slug === '' ? 'set' : slug}-${set.code}.json`
}
