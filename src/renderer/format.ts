import { CHANNELS } from '../shared/channels';
import { Counts, Quota, SessionMeta } from '../shared/types';

const integer = new Intl.NumberFormat('en-US');

export const n = (value: number): string => integer.format(Math.round(value));

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${n(count)} ${count === 1 ? one : many}`;
}

/** "about 30 minutes", "less than a minute", "about 2 h 5 min". */
export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

function shortDate(date: Date): string {
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: thisYear ? undefined : 'numeric' });
}

/** When a list was last touched: "today, 14:02" or "12 Nov". */
export function day(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return sameDay(date, new Date())
    ? `today, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`
    : shortDate(date);
}

/** When one number was checked: the time if that was today, otherwise the day. */
export function when(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return sameDay(date, new Date())
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    : shortDate(date);
}

/** Date and time in full, for the details of one number. */
export function moment(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** A number as people write it. The list carries the format; the bare number is the fallback. */
export const display = (number: { e164: string | null; formatted?: string }): string =>
  number.formatted ?? number.e164 ?? '';

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export function countryName(code: string | undefined): string {
  if (!code) return '';
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function quotaLine(quota: Quota): string {
  return quota.remaining === null ? '' : `${n(quota.remaining)} requests left`;
}

/** One line for a session in the rail. */
export function sessionSummary(meta: SessionMeta): string {
  const c = meta.counts;
  if (meta.status === 'running') return `Checking, ${n(c.checked)} of ${n(c.total)}`;
  if (meta.status === 'completed') return `Complete, ${n(c.total)}`;
  if (meta.status === 'ready') return `Not started, ${n(c.total)}`;
  return `Stopped, ${n(c.checked)} of ${n(c.total)}`;
}

export function channelLabel(meta: SessionMeta): string {
  return meta.channel ? CHANNELS[meta.channel].label : '';
}

/** Numbers that have no mark yet. Failed ones have one, and are asked again on Continue. */
export const unmarked = (counts: Counts): number => Math.max(0, counts.total - counts.checked);
