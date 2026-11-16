/**
 * Types shared by the Electron main process and the React window. Nothing in
 * `src/shared` may import Electron, Node or React: it is plain TypeScript that
 * both sides (and the tests) can load.
 */

/** Where a key is sent. Each channel returns a different depth of data. */
export type Channel = 'direct' | 'validator' | 'dbonly';
export type ChannelSetting = 'auto' | Channel;

/**
 * The five answers a number can get. They are never merged: "not on WhatsApp",
 * "not in the database" and "the request failed" are different facts.
 */
export type Outcome =
  | 'on_whatsapp'
  | 'not_on_whatsapp'
  | 'not_in_database'
  | 'invalid'
  | 'failed';

export const OUTCOMES: readonly Outcome[] = [
  'on_whatsapp',
  'not_on_whatsapp',
  'not_in_database',
  'invalid',
  'failed',
];

/** One line of the user's list after parsing. */
export interface PhoneEntry {
  /** Exactly what the user supplied. */
  input: string;
  /** E.164 with the leading `+`, or null when it could not be read as a number. */
  e164: string | null;
  /** ISO 3166 region, e.g. "UY". */
  country?: string;
  /** The number as people write it internationally, e.g. "+598 98 297 150". */
  formatted?: string;
  /** "Mobile", "Fixed line", "Fixed line or mobile", "VoIP"… from the country's numbering plan. */
  lineType?: string;
  valid: boolean;
  /** Why it is invalid, in plain words. */
  reason?: string;
}

/** A number that will be (or was) sent to the API. */
export interface ListNumber {
  e164: string;
  input: string;
  country?: string;
  /** International format, worked out on this computer when the list is read. */
  formatted?: string;
  /** Kind of line, worked out on this computer from the numbering plan. */
  lineType?: string;
}

/**
 * Whether a profile picture can be seen: `shown` (there is one and the app has
 * its address), `hidden` (the owner shows it to their contacts only), `none`.
 */
export type PictureState = 'shown' | 'hidden' | 'none';

/** How a business uses WhatsApp: the Business app, or the Business Platform (API). */
export type BusinessKind = 'app' | 'platform';

/** A picture the number showed at an earlier check. */
export interface EarlierPicture {
  url: string;
  /** When it was first seen, when the API knows. */
  seenAt?: string;
}

/** An about text the number showed at an earlier check. */
export interface EarlierAbout {
  about: string;
  seenAt?: string;
}

export interface CheckResult {
  /** E.164 with the leading `+`. */
  number: string;
  outcome: Outcome;
  /** ISO timestamp of the moment the answer arrived. */
  checkedAt: string;

  // The profile.
  name?: string;
  about?: string;
  /** When the about text was set, when WhatsApp tells. */
  aboutSetAt?: string;
  picture?: PictureState;
  /** A lasting address of the current profile picture (WhatsApp's own links expire within hours). */
  pictureUrl?: string;
  country?: string;

  // The business profile.
  business?: boolean;
  businessKind?: BusinessKind;
  /** WhatsApp's verification of the business: `high` is an official business account, `low` a verified name. */
  verifiedLevel?: 'high' | 'low';
  /** An official business account (the badge next to the name). */
  verified?: boolean;
  category?: string;
  description?: string;
  email?: string;
  /** The first website, kept for older exports. `websites` has them all. */
  website?: string;
  websites?: string[];
  address?: string;
  location?: { lat: number; lng: number };
  /** Opening hours in words, e.g. "Mon–Fri 09:00–18:00; Sat closed; Sun closed". */
  hours?: string;
  /** When the business joined: an ISO date, or WhatsApp's own words when it gives no date. */
  memberSince?: string;
  /** Linked accounts in words, e.g. "Instagram: @harborbakery". */
  links?: string[];
  /** The business has a product catalog. */
  catalog?: boolean;

  // What earlier checks saw.
  aboutHistory?: EarlierAbout[];
  pictureHistory?: EarlierPicture[];
  /** When the database collected this record. DB Only answers can be older than the check. */
  recordedAt?: string;

  /** For `failed` and `invalid`: what went wrong, in plain words. */
  note?: string;
}

export interface Counts {
  on_whatsapp: number;
  not_on_whatsapp: number;
  not_in_database: number;
  invalid: number;
  failed: number;
  /** Of `on_whatsapp`, how many are business accounts. */
  business: number;
  /** Numbers with an answer of any kind. */
  checked: number;
  /** Numbers still to be asked (never asked, or failed and worth retrying). */
  pending: number;
  total: number;
}

export type SessionStatus = 'ready' | 'running' | 'stopped' | 'completed';
export type SessionSource = 'file' | 'paste' | 'sample';

export interface SessionMeta {
  id: string;
  name: string;
  source: SessionSource;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: SessionStatus;
  /** Why a run stopped before the end, in plain words. */
  stopReason?: string;
  /** The channel the last run used. */
  channel?: Channel;
  counts: Counts;
  starred: boolean;
}

export interface Session {
  meta: SessionMeta;
  numbers: ListNumber[];
  /** The latest answer per number, in list order. */
  results: CheckResult[];
}

export interface Quota {
  remaining: number | null;
  limit: number | null;
}

export interface Progress {
  sessionId: string;
  counts: Counts;
  /** The answer that just arrived, when this update carries one. */
  result?: CheckResult;
  quota: Quota;
  /** Numbers answered per second over the last stretch of the run. */
  rate: number;
  /** Milliseconds left at the current rate, or null when unknown. */
  etaMs: number | null;
  /** What the run is doing right now when it is not simply checking. */
  waiting?: string;
}

export interface RunEnd {
  sessionId: string;
  status: SessionStatus;
  stopReason?: string;
  counts: Counts;
}

export type ThemeSetting = 'system' | 'light' | 'dark';

/** Settings as the window sees them. The key itself never leaves the main process. */
export interface PublicSettings {
  hasKey: boolean;
  /** Last four characters, to recognise which key is stored. */
  keyEnding: string;
  /** False when the system cannot protect a stored key (the key then lives in memory only). */
  canStoreKey: boolean;
  channel: ChannelSetting;
  /** The channel `auto` resolves to for the stored key, or null without a key. */
  resolvedChannel: Channel | null;
  /** Region used for numbers written without a country code. */
  defaultCountry: string;
  gapMs: number;
  timeoutMs: number;
  maxRetries: number;
  theme: ThemeSetting;
  /** Load and show profile pictures. Off: the app asks the picture server for nothing. */
  showPictures: boolean;
}

export interface SettingsPatch {
  /** A new key, or an empty string to forget the stored one. */
  apiKey?: string;
  channel?: ChannelSetting;
  defaultCountry?: string;
  gapMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  theme?: ThemeSetting;
  showPictures?: boolean;
}

export interface KeyCheck {
  ok: boolean;
  channel: Channel;
  /** A sentence for the user: what the key is and what it has left, or why it failed. */
  message: string;
  quota: Quota;
}

export type ExportFormat = 'csv' | 'xlsx' | 'json';
export type ExportScope = 'all' | Outcome;

export interface ParsedList {
  entries: PhoneEntry[];
  /** File name, or a label such as "Pasted numbers". */
  label: string;
  source: SessionSource;
  /** Lines or cells that looked like numbers, before removing duplicates. */
  found: number;
  duplicates: number;
}

export interface AppInfo {
  version: string;
  platform: string;
  demo: boolean;
}
