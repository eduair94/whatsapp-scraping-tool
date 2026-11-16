/**
 * The words for profile facts, shared by the window and the exports so a
 * fact reads the same on screen and in a spreadsheet.
 */
import { BusinessKind, CheckResult, PictureState } from './types';

export const PICTURE_LABEL: Record<PictureState, string> = {
  shown: 'Shown',
  hidden: 'Hidden by privacy settings',
  none: 'No picture',
};

export const BUSINESS_KIND_LABEL: Record<BusinessKind, string> = {
  app: 'WhatsApp Business app',
  platform: 'WhatsApp Business Platform (API)',
};

export const VERIFICATION_LABEL: Record<'high' | 'low', string> = {
  high: 'Official business account',
  low: 'Verified name',
};

/** "Business" or "Personal", for numbers on WhatsApp whose account type is known. */
export function accountType(result: CheckResult | null | undefined): string {
  if (result?.outcome !== 'on_whatsapp') return '';
  if (result.business === true) return 'Business';
  if (result.business === false) return 'Personal';
  return '';
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

const parse = (value: string | undefined): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "January 2024", or WhatsApp's own words when it gave no date. */
export function memberSinceLabel(value: string | undefined): string {
  if (!value) return '';
  const date = parse(value);
  return date ? MONTH_YEAR.format(date) : value;
}

/** "13 Oct 2025" in the window, for dates that are days rather than moments. */
export function dayLabel(value: string | undefined): string {
  const date = parse(value);
  return date ? DAY.format(date) : '';
}

/** "2025-10-13", for exports. */
export function isoDay(value: string | undefined): string {
  const date = parse(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

/** "37.79203, -122.39311" */
export function locationLabel(location: CheckResult['location']): string {
  return location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : '';
}
