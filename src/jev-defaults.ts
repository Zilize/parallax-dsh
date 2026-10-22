/**
 * Jev defaults shared by both halves: the host falls back to them, and the
 * Settings tab shows them as placeholders and input bounds.
 */

/** Credential reference (and environment variable) holding the API key. */
export const JEV_KEY_REF = 'PARALLAX_JEV_API_KEY'
export const DEFAULT_JEV_BASE_URL = 'https://api.typesafe.ai'
export const DEFAULT_JEV_MODEL = 'jev-1.13.0'

/** Requests one judging run keeps in flight. */
export const DEFAULT_JEV_CONCURRENCY = 2
export const MAX_JEV_CONCURRENCY = 16

/**
 * Papers packed into one request at most. Jev takes at most 60 questions per
 * request, so the setting can only lower it; byte and token limits may still
 * pack fewer, and multi-label classification always sends one paper.
 */
export const DEFAULT_JEV_BATCH_SIZE = 60
export const MAX_JEV_BATCH_SIZE = 60
