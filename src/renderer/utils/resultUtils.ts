import { WhatsAppResult, CheckSession } from '../types';
import { categoryOf, ResultCategory } from '../../shared/categorize';

export interface ResultCategorization {
  activeResults: WhatsAppResult[];
  notOnWhatsAppResults: WhatsAppResult[];
  apiErrorResults: WhatsAppResult[];
  pendingResults: WhatsAppResult[];
  rateLimitedResults: WhatsAppResult[];
}

/**
 * Categorizes WhatsApp results into different types
 */
export function categorizeResults(
  results: WhatsAppResult[]
): ResultCategorization {
  const categorization: ResultCategorization = {
    activeResults: [],
    notOnWhatsAppResults: [],
    apiErrorResults: [],
    pendingResults: [],
    rateLimitedResults: [],
  };

  results.forEach((result) => {
    const category = getResultCategory(result);

    switch (category) {
      case 'active':
        categorization.activeResults.push(result);
        break;
      case 'not_on_whatsapp':
        categorization.notOnWhatsAppResults.push(result);
        break;
      case 'api_error':
        categorization.apiErrorResults.push(result);
        break;
      case 'pending':
        categorization.pendingResults.push(result);
        break;
      case 'rate_limited':
        categorization.rateLimitedResults.push(result);
        break;
    }
  });

  return categorization;
}

/**
 * Determines the category of a WhatsApp result. Delegates to the shared,
 * dependency-free categorizer so the renderer and the Electron main process
 * stay in lock-step.
 */
export function getResultCategory(result: WhatsAppResult): ResultCategory {
  return categoryOf(result);
}

/**
 * Gets a human-readable status label for a result
 */
export function getResultStatusLabel(result: WhatsAppResult): string {
  const category = getResultCategory(result);

  switch (category) {
    case 'active':
      return 'Active on WhatsApp';
    case 'not_on_whatsapp':
      return 'Not on WhatsApp';
    case 'api_error':
      return 'API Error';
    case 'pending':
      return 'Pending';
    case 'rate_limited':
      return 'Rate Limited';
    default:
      return 'Unknown';
  }
}

/**
 * Gets CSS classes for styling result status
 */
export function getResultStatusClasses(result: WhatsAppResult): {
  badge: string;
  row: string;
} {
  const category = getResultCategory(result);

  switch (category) {
    case 'active':
      return {
        badge: 'bg-green-100 text-green-800',
        row: 'bg-green-50 border-green-200',
      };
    case 'not_on_whatsapp':
      return {
        badge: 'bg-gray-100 text-gray-800',
        row: 'bg-gray-50 border-gray-200',
      };
    case 'api_error':
      return {
        badge: 'bg-red-100 text-red-800',
        row: 'bg-red-50 border-red-200',
      };
    case 'pending':
      return {
        badge: 'bg-yellow-100 text-yellow-800',
        row: 'bg-yellow-50 border-yellow-200',
      };
    case 'rate_limited':
      return {
        badge: 'bg-orange-100 text-orange-800',
        row: 'bg-orange-50 border-orange-200',
      };
    default:
      return {
        badge: 'bg-gray-100 text-gray-800',
        row: 'bg-gray-50 border-gray-200',
      };
  }
}

/**
 * Updates session statistics based on results
 */
export function updateSessionStatistics(
  session: Partial<CheckSession>,
  results: WhatsAppResult[]
): Partial<CheckSession> {
  const categorization = categorizeResults(results);

  return {
    ...session,
    successfulChecks: categorization.activeResults.length,
    notOnWhatsAppChecks: categorization.notOnWhatsAppResults.length,
    apiErrorChecks: categorization.apiErrorResults.length,
    rateLimitedChecks: categorization.rateLimitedResults.length,
    // A number is "completed" once it has a definitive answer. Pending (never
    // returned) and rate-limited (throttled, must be retried) do not count.
    completedNumbers:
      results.length -
      categorization.pendingResults.length -
      categorization.rateLimitedResults.length,
    // Keep failedChecks for backward compatibility (sum of not_on_whatsapp + api_error)
    failedChecks:
      categorization.notOnWhatsAppResults.length +
      categorization.apiErrorResults.length,
  };
}
