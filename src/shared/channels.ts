import { Channel, ChannelSetting } from './types';

export interface ChannelSpec {
  id: Channel;
  /** Short name shown in the interface. */
  label: string;
  /** One sentence on what this channel returns. */
  returns: string;
  baseUrl: string;
  /** Sent as `x-rapidapi-host` on RapidAPI channels. */
  rapidApiHost: string | null;
  /** Path of the per-number lookup. `digits` has no leading `+`. */
  lookupPath: (digits: string) => string;
  /** True when the channel asks WhatsApp now; false when it reads the database. */
  live: boolean;
  /** True when answers carry name, about, picture and business details. */
  profile: boolean;
  /** Where a person gets a key for it. */
  keyUrl: string;
}

export const CHANNELS: Record<Channel, ChannelSpec> = {
  direct: {
    id: 'direct',
    label: 'Direct key',
    returns:
      'A live check with the full profile: name, about, picture and business details.',
    baseUrl: 'https://whatsapp-proxy.checkleaked.cc',
    rapidApiHost: null,
    lookupPath: (digits) => `/number/${digits}`,
    live: true,
    profile: true,
    keyUrl: 'https://whatsapp.checkleaked.cc/api',
  },
  validator: {
    id: 'validator',
    label: 'RapidAPI: Number Validator',
    returns:
      'A live check that answers registered or not. This listing returns no profile data.',
    baseUrl: 'https://whatsapp-number-validator18.p.rapidapi.com',
    rapidApiHost: 'whatsapp-number-validator18.p.rapidapi.com',
    lookupPath: (digits) => `/number/${digits}`,
    live: true,
    profile: false,
    keyUrl: 'https://rapidapi.com/airaudoeduardo/api/whatsapp-number-validator18',
  },
  dbonly: {
    id: 'dbonly',
    label: 'RapidAPI: DB Only',
    returns:
      'Profiles from the database, without a live check. A number can be missing from it.',
    baseUrl: 'https://wp-data-db-only.p.rapidapi.com',
    rapidApiHost: 'wp-data-db-only.p.rapidapi.com',
    lookupPath: (digits) => `/number_cache/${digits}`,
    live: false,
    profile: true,
    keyUrl: 'https://rapidapi.com/airaudoeduardo/api/wp-data-db-only',
  },
};

/** The RapidAPI listing this app was first built on. Removed on 2026-11-04. */
export const RETIRED_HOSTS = ['whatsapp-data1.p.rapidapi.com', 'wp-data.p.rapidapi.com'];

/** Direct keys are `wapi_` or `wa_` followed by hexadecimal characters. */
export function isDirectKey(key: string): boolean {
  return /^(wapi|wa)_[0-9a-f]{16,}$/i.test(key.trim());
}

/** RapidAPI application keys look like `<hex>msh<hex>p<hex>jsn<hex>`. */
export function isRapidApiKey(key: string): boolean {
  return /^[0-9a-f]+msh[0-9a-f]+p[0-9a-f]+jsn[0-9a-f]+$/i.test(key.trim());
}

/**
 * Which channel a key goes to. `auto` recognises a direct key by its shape. A
 * RapidAPI key works on whichever listing the account subscribed to, which the
 * key itself does not say, so `auto` sends it to the Number Validator (the live
 * check) and the person switches to DB Only in Settings when that is their plan.
 */
export function resolveChannel(setting: ChannelSetting, key: string): Channel {
  if (setting !== 'auto') return setting;
  if (isRapidApiKey(key)) return 'validator';
  return 'direct';
}

/** A warning when the chosen channel cannot work with the shape of the key. */
export function channelMismatch(channel: Channel, key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  if (channel === 'direct' && isRapidApiKey(k)) {
    return 'This looks like a RapidAPI key. Choose one of the RapidAPI channels for it.';
  }
  if (channel !== 'direct' && isDirectKey(k)) {
    return 'This looks like a direct key. Choose the Direct key channel for it.';
  }
  return null;
}
