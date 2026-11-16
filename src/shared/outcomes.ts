import { CheckResult, Counts, Outcome } from './types';

/** The words used for each outcome, everywhere: table, totals, exports. */
export const OUTCOME_LABEL: Record<Outcome, string> = {
  on_whatsapp: 'On WhatsApp',
  not_on_whatsapp: 'Not on WhatsApp',
  not_in_database: 'Not in database',
  invalid: 'Invalid number',
  failed: 'Failed',
};

/**
 * A failed lookup did not answer the question, so the number is asked again
 * when the session continues. Every other outcome is final.
 */
export function isFinal(outcome: Outcome): boolean {
  return outcome !== 'failed';
}

export function emptyCounts(total = 0): Counts {
  return {
    on_whatsapp: 0,
    not_on_whatsapp: 0,
    not_in_database: 0,
    invalid: 0,
    failed: 0,
    business: 0,
    checked: 0,
    pending: total,
    total,
  };
}

/** Totals for a list of `total` numbers given the latest answer per number. */
export function countResults(results: Iterable<CheckResult>, total: number): Counts {
  const counts = emptyCounts(total);
  for (const r of results) {
    counts[r.outcome]++;
    counts.checked++;
    if (r.outcome === 'on_whatsapp' && r.business) counts.business++;
  }
  // Failed numbers have an entry but still need asking.
  counts.pending = Math.max(0, total - counts.checked) + counts.failed;
  return counts;
}

/** Applies one new answer to running totals, replacing `previous` for the same number. */
export function applyResult(
  counts: Counts,
  result: CheckResult,
  previous?: CheckResult
): Counts {
  const next = { ...counts };
  if (previous) {
    next[previous.outcome]--;
    next.checked--;
    if (previous.outcome === 'on_whatsapp' && previous.business) next.business--;
  }
  next[result.outcome]++;
  next.checked++;
  if (result.outcome === 'on_whatsapp' && result.business) next.business++;
  next.pending = Math.max(0, next.total - next.checked) + next.failed;
  return next;
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}
