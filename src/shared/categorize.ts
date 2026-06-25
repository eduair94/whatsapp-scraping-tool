/**
 * Shared, dependency-free result categorization used by BOTH the Electron main
 * process and the React renderer, so progress counts, history stats and the
 * results screen all agree. Operates on a minimal structural shape so it works
 * regardless of which side's concrete types are passed in.
 */

export type ResultCategory =
  | 'active'
  | 'not_on_whatsapp'
  | 'api_error'
  | 'pending'
  | 'rate_limited';

export interface CategorizableResult {
  data?:
    | { isWAContact?: boolean; isUser?: boolean; error?: string }
    | null
    | undefined;
  error?: string;
}

export function isRateLimitMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('rate limit') ||
    m.includes('too many requests') ||
    m.includes('429') ||
    m.includes('quota')
  );
}

export function isNotOnWhatsAppMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('not found') ||
    m.includes('not on whatsapp') ||
    m.includes("whatsapp number doesn't exist") ||
    m.includes('does not exist') ||
    m.includes("doesn't exist")
  );
}

/**
 * Error signals may arrive on the top-level `error` (common for rate-limit /
 * transport failures where `data` is null) or inside the `data.error` payload.
 * Both are inspected BEFORE the "no data => pending" fallback so rate-limited
 * and errored checks are never silently bucketed as pending.
 */
export function categoryOf(result: CategorizableResult): ResultCategory {
  const dataError =
    result.data &&
    typeof result.data === 'object' &&
    'error' in result.data &&
    result.data.error
      ? (result.data.error as string)
      : undefined;
  const errorMessage = result.error || dataError;

  if (errorMessage) {
    if (isRateLimitMessage(errorMessage)) return 'rate_limited';
    if (isNotOnWhatsAppMessage(errorMessage)) return 'not_on_whatsapp';
    return 'api_error';
  }

  if (!result.data) return 'pending';

  const data = result.data as { isWAContact?: boolean; isUser?: boolean };
  if (data.isWAContact || data.isUser) return 'active';

  return 'not_on_whatsapp';
}

export interface CategoryCounts {
  active: number;
  notOnWhatsApp: number;
  apiError: number;
  pending: number;
  rateLimited: number;
  /** Numbers with a definitive answer (everything except pending + rate-limited). */
  completed: number;
}

export function countCategories(
  results: CategorizableResult[]
): CategoryCounts {
  const counts: CategoryCounts = {
    active: 0,
    notOnWhatsApp: 0,
    apiError: 0,
    pending: 0,
    rateLimited: 0,
    completed: 0,
  };

  for (const result of results) {
    switch (categoryOf(result)) {
      case 'active':
        counts.active++;
        break;
      case 'not_on_whatsapp':
        counts.notOnWhatsApp++;
        break;
      case 'api_error':
        counts.apiError++;
        break;
      case 'rate_limited':
        counts.rateLimited++;
        break;
      case 'pending':
        counts.pending++;
        break;
    }
  }

  counts.completed = results.length - counts.pending - counts.rateLimited;
  return counts;
}
