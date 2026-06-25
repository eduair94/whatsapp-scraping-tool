import { CheckSession } from '../types';

/**
 * Lightweight session metadata stored in the sessions index, so the history
 * list can be loaded without deserializing every session's (potentially huge)
 * results array. Excludes `results`, `settings` (which holds the API key) and
 * `originalNumbers`.
 */
export type SessionSummary = Omit<
  CheckSession,
  'results' | 'settings' | 'originalNumbers'
>;

const VALID_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Validates a session id before it is used to build a filesystem path.
 * Session ids come from the renderer over IPC, so an unsanitized id like
 * `../../settings` would let a caller read/overwrite/delete arbitrary files.
 */
export function sanitizeSessionId(id: unknown): string {
  if (typeof id !== 'string' || !VALID_ID.test(id)) {
    throw new Error('Invalid session id');
  }
  return id;
}

export function toSessionSummary(session: CheckSession): SessionSummary {
  // Explicitly pick metadata fields; never spread `results`/`settings` in.
  return {
    id: session.id,
    fileName: session.fileName,
    startTime: session.startTime,
    endTime: session.endTime,
    totalNumbers: session.totalNumbers,
    completedNumbers: session.completedNumbers,
    successfulChecks: session.successfulChecks,
    failedChecks: session.failedChecks,
    notOnWhatsAppChecks: session.notOnWhatsAppChecks,
    apiErrorChecks: session.apiErrorChecks,
    rateLimitedChecks: session.rateLimitedChecks,
    status: session.status,
    isStarred: session.isStarred,
    lastResumedAt: session.lastResumedAt,
    pausedAt: session.pausedAt,
  };
}
