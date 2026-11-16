/**
 * Reading phone numbers out of whatever people paste or upload.
 *
 * A number written without a country code means nothing on its own, so it is
 * read against ONE default country the person chooses. The previous version
 * tried ten countries in a fixed order and kept the first that fitted, which
 * silently filed some numbers under the wrong country.
 */
import { PhoneNumber, PhoneNumberFormat, PhoneNumberType, PhoneNumberUtil } from 'google-libphonenumber';
import { PhoneEntry } from '../shared/types';

const util = PhoneNumberUtil.getInstance();

/**
 * A run of digits with the punctuation people put inside phone numbers:
 * spaces (also the non-breaking ones spreadsheets insert), brackets, dots and
 * hyphens. Slashes are left out so dates are not read as numbers.
 */
const CANDIDATE = /\(?\+?\d[\d ().\-\u00a0]{4,}\d/g;
const MIN_DIGITS = 7;
const MAX_DIGITS = 15;

const digitsOf = (value: string): string => value.replace(/\D/g, '');

export function supportedCountries(): string[] {
  return (util.getSupportedRegions() as string[]).slice().sort();
}

export function isSupportedCountry(code: string): boolean {
  return (util.getSupportedRegions() as string[]).includes(code);
}

/** Phone-like pieces of a cell or a line. Dates and short codes are left out by length. */
export function extractCandidates(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    let piece = match[0].trim();
    // "(212) 555-0147" keeps its bracket; "(see 212 555 0147" does not.
    if (piece.startsWith('(') && !piece.includes(')')) piece = piece.slice(1).trim();
    const digits = digitsOf(piece).length;
    if (digits >= MIN_DIGITS && digits <= MAX_DIGITS) out.push(piece);
  }
  return out;
}

function tryParse(value: string, region?: string): PhoneNumber | null {
  try {
    const parsed = region ? util.parse(value, region) : util.parse(value);
    return util.isValidNumber(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The kinds of line a numbering plan tells apart, in words. */
const LINE_TYPE: Partial<Record<PhoneNumberType, string>> = {
  [PhoneNumberType.FIXED_LINE]: 'Fixed line',
  [PhoneNumberType.MOBILE]: 'Mobile',
  [PhoneNumberType.FIXED_LINE_OR_MOBILE]: 'Fixed line or mobile',
  [PhoneNumberType.TOLL_FREE]: 'Toll free',
  [PhoneNumberType.PREMIUM_RATE]: 'Premium rate',
  [PhoneNumberType.SHARED_COST]: 'Shared cost',
  [PhoneNumberType.VOIP]: 'VoIP',
  [PhoneNumberType.PERSONAL_NUMBER]: 'Personal number',
  [PhoneNumberType.PAGER]: 'Pager',
  [PhoneNumberType.UAN]: 'Company number',
  [PhoneNumberType.VOICEMAIL]: 'Voicemail',
};

const lineTypeOf = (parsed: PhoneNumber): string | undefined => LINE_TYPE[util.getNumberType(parsed)];

function entryFrom(input: string, parsed: PhoneNumber): PhoneEntry {
  return {
    input,
    e164: util.format(parsed, PhoneNumberFormat.E164),
    country: util.getRegionCodeForNumber(parsed) ?? undefined,
    formatted: util.format(parsed, PhoneNumberFormat.INTERNATIONAL),
    ...(lineTypeOf(parsed) ? { lineType: lineTypeOf(parsed) } : {}),
    valid: true,
  };
}

/**
 * Reads one number.
 *   1. `+…` or `00…`: international, the country code decides.
 *   2. Otherwise: a national number of `defaultCountry`.
 *   3. Otherwise: bare digits that already start with a country code
 *      (spreadsheets drop the `+`), e.g. "59899123456".
 */
export function parseNumber(raw: string, defaultCountry: string): PhoneEntry {
  const input = raw.trim();
  const digits = digitsOf(input);
  const invalid = (reason: string): PhoneEntry => ({ input, e164: null, valid: false, reason });

  if (digits.length < MIN_DIGITS) return invalid('Too short to be a phone number.');
  if (digits.length > MAX_DIGITS) return invalid('Too long to be a phone number.');

  const international = input.startsWith('+') || /^00\d/.test(digits);
  if (international) {
    const parsed = tryParse(`+${digits.replace(/^00/, '')}`);
    return parsed ? entryFrom(input, parsed) : invalid('Not a valid number for its country code.');
  }

  const national = isSupportedCountry(defaultCountry) ? tryParse(input, defaultCountry) : null;
  if (national) return entryFrom(input, national);

  const bare = tryParse(`+${digits}`);
  if (bare) return entryFrom(input, bare);

  return invalid(
    `Not a valid ${defaultCountry} number, and it has no country code. Add the country code or change the default country.`
  );
}

export interface ParsedNumbers {
  entries: PhoneEntry[];
  duplicates: number;
}

/** Parses every candidate and removes repeats of the same number, keeping the first. */
export function parseNumbers(candidates: string[], defaultCountry: string): ParsedNumbers {
  const seen = new Set<string>();
  const entries: PhoneEntry[] = [];
  let duplicates = 0;
  for (const candidate of candidates) {
    if (!candidate || !candidate.trim()) continue;
    const entry = parseNumber(candidate, defaultCountry);
    // Two spellings of one number are one number; invalid entries match by text.
    const key = entry.e164 ?? `invalid:${digitsOf(entry.input)}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }
  return { entries, duplicates };
}

/** The national number for a region written as people there write it, for placeholders. */
export function exampleNumber(country: string): string {
  try {
    const example = util.getExampleNumberForType(country, 1 /* MOBILE */);
    return util.format(example, PhoneNumberFormat.NATIONAL);
  } catch {
    return '';
  }
}

/** "+598 98 297 150" from "+59898297150". Falls back to the input when it cannot be read. */
export function formatInternational(e164: string): string {
  try {
    return util.format(util.parse(e164), PhoneNumberFormat.INTERNATIONAL);
  } catch {
    return e164;
  }
}

/** Format, country and kind of line of a number already in E.164, for lists saved by older versions. */
export function describeNumber(e164: string): { formatted: string; country?: string; lineType?: string } {
  try {
    const parsed = util.parse(e164);
    const country = util.getRegionCodeForNumber(parsed) ?? undefined;
    const lineType = lineTypeOf(parsed);
    return {
      formatted: util.format(parsed, PhoneNumberFormat.INTERNATIONAL),
      ...(country ? { country } : {}),
      ...(lineType ? { lineType } : {}),
    };
  } catch {
    return { formatted: e164 };
  }
}
