/**
 * Turns one API answer into what the app knows about a number, or into a
 * reason the lookup could not be answered. Pure functions: no network, no
 * clock, so every branch is tested directly.
 *
 * What the live API does (measured 2026-11-15 on the direct channel):
 *   - on WhatsApp            200  { exists: true, isWAContact: true, … }
 *   - not on WhatsApp        200  { exists: false, code: "NUMBER_NOT_FOUND", status: 404, … }
 *     (older deployments and the cache endpoint answer 404 with the same body)
 *   - cache miss (DB Only)   404  { code: "NOT_IN_DATABASE" }
 *   - invalid number         400  { code: "INVALID_PHONE_NUMBER" }
 * A record of a number that left WhatsApp can still carry `isWAContact: true`
 * from its last sighting, so `exists: false` always wins over the old flags.
 *
 * What is kept of a profile: everything a person can act on (name, about,
 * picture, the whole business profile, what earlier checks saw). What is not:
 * WhatsApp's own picture links (they expire within hours), internal flags of
 * the API's checking account, and the API's automated guesses about the
 * people in a picture (age, gender, ethnicity), which this app never shows.
 */
import { BusinessKind, Channel, CheckResult, EarlierAbout, EarlierPicture, PictureState } from '../shared/types';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'NOT_SUBSCRIBED'
  | 'FORBIDDEN'
  | 'QUOTA_EXCEEDED'
  | 'DAILY_LIMIT'
  | 'RATE_LIMITED'
  | 'RANGE_REFUSED'
  | 'API_GONE'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'SERVER'
  | 'BAD_RESPONSE';

/** Errors that end the whole run: asking the next number would fail the same way. */
const FATAL: ReadonlySet<ApiErrorCode> = new Set([
  'UNAUTHORIZED',
  'NOT_SUBSCRIBED',
  'FORBIDDEN',
  'QUOTA_EXCEEDED',
  'DAILY_LIMIT',
  'API_GONE',
]);

/** Errors worth another attempt at the same number after a pause. */
const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set([
  'RATE_LIMITED',
  'TIMEOUT',
  'NETWORK',
  'SERVER',
]);

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Milliseconds the API asked us to wait, when it said. */
  readonly retryAfterMs?: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { status?: number; retryAfterMs?: number } = {}
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? 0;
    this.retryAfterMs = options.retryAfterMs;
  }

  get fatal(): boolean {
    return FATAL.has(this.code);
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

type Body = Record<string, unknown> | null;

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** An ISO timestamp from a date written as a string, epoch milliseconds or `{ $date }`. */
function isoDate(value: unknown): string | undefined {
  const raw = record(value)?.$date ?? value;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  if (typeof raw === 'string' && !raw.trim()) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** What the API said went wrong, from whichever field carries it. */
function said(body: Body): string {
  if (!body) return '';
  return (
    text(body.message) ??
    text(body.error) ??
    (body.error && typeof body.error === 'object'
      ? text((body.error as Record<string, unknown>).message)
      : undefined) ??
    ''
  );
}

/**
 * A picture address that keeps working: the API's picture server (https), or
 * the drawings of demo mode (data URLs). WhatsApp's own `profilePic` links
 * expire within hours and are never kept.
 */
function lastingUrl(value: unknown): string | undefined {
  const url = text(value);
  return url && /^(https:\/\/|data:image\/)/i.test(url) ? url : undefined;
}

/** A picture's address without its cache-busting query, to recognise the same picture twice. */
const samePicture = (url: string): string => url.split('?')[0];

function websitesOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of list) {
    // Current records hold plain strings; older ones hold { url }.
    const url = text(item) ?? text(record(item)?.url);
    if (url && !out.includes(url)) out.push(url);
  }
  return out.slice(0, 10);
}

function categoryName(value: unknown): string | undefined {
  if (!Array.isArray(value)) return text(value);
  const names = value
    .map((c) => text(record(c)?.localized_display_name))
    .filter((name): name is string => Boolean(name));
  return names.length ? names.join(', ') : undefined;
}

const DAYS = [
  ['mon', 'Mon'],
  ['tue', 'Tue'],
  ['wed', 'Wed'],
  ['thu', 'Thu'],
  ['fri', 'Fri'],
  ['sat', 'Sat'],
  ['sun', 'Sun'],
] as const;

const clockTime = (value: number, unit: number): string => {
  const minutes = Math.round(value / unit);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

function dayHours(day: Record<string, unknown> | null, unit: number): string {
  const mode = text(day?.mode);
  if (!day || mode === 'closed') return 'closed';
  if (mode === 'open_24h') return 'open 24 hours';
  if (mode === 'appointment_only') return 'by appointment';
  const ranges = (Array.isArray(day.hours) ? day.hours : [])
    .filter(
      (pair): pair is number[] =>
        Array.isArray(pair) && pair.length >= 2 && finite(pair[0]) !== undefined && finite(pair[1]) !== undefined
    )
    .map(([open, close]) => `${clockTime(open, unit)}–${clockTime(close, unit)}`);
  if (ranges.length) return ranges.join(', ');
  return mode ? mode.replace(/_/g, ' ') : 'closed';
}

/**
 * Opening hours in words. Consecutive days with the same hours are joined:
 * "Mon–Fri 09:00–18:00; Sat 10:00–14:00; Sun closed". A day the business left
 * out is a day it is closed.
 */
export function openingHours(value: unknown): string | undefined {
  const hours = record(value);
  const config = record(hours?.config);
  if (!config || !DAYS.some(([key]) => key in config)) return undefined;
  // Times are minutes after midnight; a few records hold seconds instead.
  const times = DAYS.flatMap(([key]) => {
    const list = record(config[key])?.hours;
    return Array.isArray(list) ? list.flat() : [];
  }).filter((v): v is number => typeof v === 'number');
  const unit = times.some((v) => v > 1440) ? 60 : 1;
  const days = DAYS.map(([key, label]) => ({ label, hours: dayHours(record(config[key]), unit) }));

  let words: string;
  if (days.every((d) => d.hours === days[0].hours)) {
    words = `Every day, ${days[0].hours}`;
  } else {
    const parts: string[] = [];
    for (let i = 0; i < days.length; ) {
      let j = i;
      while (j + 1 < days.length && days[j + 1].hours === days[i].hours) j++;
      parts.push(`${j > i ? `${days[i].label}–${days[j].label}` : days[i].label} ${days[i].hours}`);
      i = j + 1;
    }
    words = parts.join('; ');
  }
  const zone = text(hours?.timezone);
  return zone ? `${words} (${zone})` : words;
}

const onEarth = (lat: number | undefined, lng: number | undefined): lat is number =>
  lat !== undefined && lng !== undefined && !(lat === 0 && lng === 0) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Where the business is. GeoJSON order is [longitude, latitude]; 0, 0 means "not given". */
function locationOf(business: Record<string, unknown>): CheckResult['location'] {
  const coordinates = record(business.location)?.coordinates;
  if (Array.isArray(coordinates) && coordinates.length >= 2) {
    const lng = finite(coordinates[0]);
    const lat = finite(coordinates[1]);
    if (onEarth(lat, lng)) return { lat, lng: lng! };
  }
  const lat = finite(business.latitude);
  const lng = finite(business.longitude);
  return onEarth(lat, lng) ? { lat, lng: lng! } : undefined;
}

const LINK_LABEL: Record<string, string> = {
  fb_page: 'Facebook page',
  facebook: 'Facebook',
  ig_handle: 'Instagram',
  ig_professional: 'Instagram',
  instagram: 'Instagram',
};

function linksOf(business: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (label: string, value: string | undefined) => {
    if (!value) return;
    const shown = label === 'Instagram' && !/^@|\//.test(value) ? `@${value}` : value;
    const line = `${label}: ${shown}`;
    if (!out.includes(line)) out.push(line);
  };
  const named = (value: unknown): string | undefined => {
    const r = record(value);
    return typeof value === 'string'
      ? text(value)
      : (text(r?.username) ?? text(r?.handle) ?? text(r?.name) ?? text(r?.link) ?? text(r?.url));
  };
  for (const [key, value] of Object.entries(record(business.linkedAccounts) ?? {})) {
    const label = LINK_LABEL[key.toLowerCase()] ?? key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
    add(label, named(value));
  }
  add('Facebook page', named(business.fbPage));
  add('Instagram', named(business.igProfessional));
  return out.slice(0, 10);
}

function memberSinceOf(business: Record<string, unknown>): string | undefined {
  const seconds = finite(business.memberSinceTs);
  // Anything before WhatsApp Business existed (2018) is not a real date.
  if (seconds !== undefined && seconds > 1_500_000_000) return new Date(seconds * 1000).toISOString();
  return text(business.memberSinceText);
}

/** The current picture, or why there is none. `stale` is an older copy the API still holds. */
function pictureOf(body: Record<string, unknown>): { picture?: PictureState; pictureUrl?: string; stale?: string } {
  const url = lastingUrl(body.urlImage);
  const status = text(body.image_status);
  if (status === 'not-authorized') return { picture: 'hidden', stale: url };
  if (status === 'item-not-found') return { picture: 'none', stale: url };
  if (url && (!status || status === 'found')) return { picture: 'shown', pictureUrl: url };
  return {};
}

const byNewest = <T extends { seenAt?: string }>(a: T, b: T): number => (b.seenAt ?? '').localeCompare(a.seenAt ?? '');

/** About texts the number showed before, newest first, without the current one. */
function earlierAbouts(body: Record<string, unknown>, current: string | undefined, last?: string): EarlierAbout[] {
  const entries = (Array.isArray(body.aboutHistory) ? body.aboutHistory : [])
    .map((item) => ({ about: text(record(item)?.about), seenAt: isoDate(record(item)?.date) }))
    .filter((e): e is { about: string; seenAt: string | undefined } => Boolean(e.about))
    .sort(byNewest);
  const seen = new Set(current ? [current] : []);
  const out: EarlierAbout[] = [];
  for (const entry of [...(last ? [{ about: last, seenAt: undefined }] : []), ...entries]) {
    if (seen.has(entry.about)) continue;
    seen.add(entry.about);
    out.push(entry.seenAt ? { about: entry.about, seenAt: entry.seenAt } : { about: entry.about });
  }
  return out.slice(0, 20);
}

/** Pictures the number showed before, newest first, without the current one. */
function earlierPictures(body: Record<string, unknown>, current: string | undefined, last?: string): EarlierPicture[] {
  const entries = (Array.isArray(body.pictureHistory) ? body.pictureHistory : [])
    .map((item) => ({ url: lastingUrl(record(item)?.url), seenAt: isoDate(record(item)?.date) }))
    .filter((e): e is { url: string; seenAt: string | undefined } => Boolean(e.url))
    .sort(byNewest);
  const seen = new Set(current ? [samePicture(current)] : []);
  const out: EarlierPicture[] = [];
  for (const entry of [...(last ? [{ url: last, seenAt: undefined }] : []), ...entries]) {
    if (seen.has(samePicture(entry.url))) continue;
    seen.add(samePicture(entry.url));
    out.push(entry.seenAt ? { url: entry.url, seenAt: entry.seenAt } : { url: entry.url });
  }
  return out.slice(0, 12);
}

/** The profile of a number that is on WhatsApp, from an API record. */
export function profile(number: string, body: Record<string, unknown>, checkedAt: string): CheckResult {
  const business = record(body.businessProfile);
  const picture = pictureOf(body);
  const about = text(body.about);
  const result: CheckResult = {
    number,
    outcome: 'on_whatsapp',
    checkedAt,
    name:
      text(business?.displayName) ??
      text(body.verifiedName) ??
      text(body.pushname) ??
      text(body.name) ??
      text(body.shortName),
    about,
    aboutSetAt: isoDate(body.aboutSetAt),
    picture: picture.picture,
    pictureUrl: picture.pictureUrl,
    country: text(body.countryCode),
    aboutHistory: earlierAbouts(body, about),
    pictureHistory: earlierPictures(body, picture.pictureUrl, picture.stale),
    recordedAt: isoDate(body.date),
  };

  // The Number Validator listing strips these, so absence means "not told".
  if (typeof body.isBusiness === 'boolean') result.business = body.isBusiness;
  if (business) result.business = true;

  const level = text(business?.verifiedLevel)?.toLowerCase();
  if (level === 'high' || level === 'low') result.verifiedLevel = level;
  // Older records only say `isVerified`: the business name was verified, at some level.
  else if (body.isVerified === true) result.verifiedLevel = 'low';
  if (result.verifiedLevel === 'high') result.verified = true;

  const identity = text(business?.identityType)?.toLowerCase();
  let kind: BusinessKind | undefined;
  if (identity === 'ent' || body.isEnterprise === true || business?.isOfficial === true) kind = 'platform';
  else if (identity === 'smb') kind = 'app';
  if (kind && result.business) result.businessKind = kind;

  if (business) {
    const sites = websitesOf(business.website);
    result.category = categoryName(business.categories);
    result.description = text(business.description);
    result.email = text(business.email);
    result.website = sites[0];
    result.websites = sites;
    result.address = text(business.address);
    result.location = locationOf(business);
    result.hours = openingHours(business.businessHours);
    result.memberSince = memberSinceOf(business);
    result.links = linksOf(business);
    if (text(business.catalogStatus) === 'catalog_exists') result.catalog = true;
  }
  return prune(result);
}

/** A number that is not on WhatsApp now, with what earlier checks saw of it. */
function absent(number: string, body: Body, checkedAt: string): CheckResult {
  const source = body ?? {};
  return prune({
    number,
    outcome: 'not_on_whatsapp',
    checkedAt,
    aboutHistory: earlierAbouts(source, undefined, text(source.about)),
    pictureHistory: earlierPictures(source, undefined, lastingUrl(source.urlImage)),
    recordedAt: isoDate(source.date),
  });
}

/** Drops empty fields so stored and exported records stay small. */
function prune(result: CheckResult): CheckResult {
  const out = { ...result } as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete out[key];
  }
  return out as unknown as CheckResult;
}

const notFound = (body: Body): boolean =>
  Boolean(body) && (body!.exists === false || body!.code === 'NUMBER_NOT_FOUND');

/**
 * @param number    E.164 with `+`, as the app knows it (the Validator listing
 *                  masks the number in its answer, so the body's own is ignored)
 * @param checkedAt ISO timestamp to stamp on the result
 * @returns the result, or throws ApiError
 */
export function classify(
  channel: Channel,
  number: string,
  status: number,
  body: Body,
  checkedAt: string,
  retryAfterMs?: number
): CheckResult {
  const message = said(body);
  const code = text(body?.code) ?? '';

  if (status === 200 && body) {
    if (notFound(body)) return absent(number, body, checkedAt);
    if (body.exists === true || body.isWAContact === true || body.isUser === true) {
      return profile(number, body, checkedAt);
    }
    throw new ApiError('BAD_RESPONSE', 'The API answered without saying whether the number exists.', {
      status,
    });
  }

  if (status === 404) {
    if (code === 'NOT_IN_DATABASE') return { number, outcome: 'not_in_database', checkedAt };
    if (notFound(body)) return absent(number, body, checkedAt);
    // RapidAPI's gateway answers 404 for a listing or endpoint that is gone.
    if (/API doesn'?t exist|endpoint .* does not exist/i.test(message)) {
      throw new ApiError(
        'API_GONE',
        channel === 'direct'
          ? 'The API address does not exist. Check the connection settings.'
          : 'This RapidAPI listing no longer exists. Pick another channel in Settings.',
        { status }
      );
    }
    throw new ApiError('BAD_RESPONSE', message || 'The API answered 404 without a reason.', { status });
  }

  if (status === 400) {
    return {
      number,
      outcome: 'invalid',
      checkedAt,
      note: 'The API does not accept this as a phone number.',
    };
  }

  if (status === 401) {
    throw new ApiError(
      'UNAUTHORIZED',
      code === 'KEY_EXPIRED'
        ? 'This API key has expired.'
        : 'The API rejected this key. Check it for missing characters, and that the channel matches the kind of key.',
      { status }
    );
  }

  if (status === 403) {
    if (/not subscribed/i.test(message)) {
      throw new ApiError(
        'NOT_SUBSCRIBED',
        'This RapidAPI key is not subscribed to the chosen listing. Subscribe to it, or pick the other RapidAPI channel in Settings.',
        { status }
      );
    }
    if (code === 'ENUMERATION_NOT_ALLOWED') {
      throw new ApiError(
        'RANGE_REFUSED',
        'The API refuses more numbers from this range today.',
        { status }
      );
    }
    throw new ApiError('FORBIDDEN', message || 'This key is not allowed to look numbers up.', { status });
  }

  if (status === 429) {
    if (code === 'DAILY_LIMIT_REACHED' || /daily/i.test(message)) {
      throw new ApiError('DAILY_LIMIT', "The key reached today's limit. Continue tomorrow.", { status });
    }
    if (/quota|monthly/i.test(message)) {
      throw new ApiError('QUOTA_EXCEEDED', 'The key has no requests left.', { status });
    }
    // "Requests must be at least 0.5 seconds apart" carries no Retry-After header.
    const apart = message.match(/at least ([\d.]+) seconds/i);
    throw new ApiError('RATE_LIMITED', 'The API asked to slow down.', {
      status,
      retryAfterMs: retryAfterMs ?? (apart ? Number(apart[1]) * 1000 + 50 : undefined),
    });
  }

  if (status >= 500) {
    throw new ApiError('SERVER', `The API had a problem (${status}).`, { status, retryAfterMs });
  }

  throw new ApiError('BAD_RESPONSE', message || `Unexpected answer from the API (${status}).`, {
    status,
  });
}
