/**
 * Demo mode: a stand-in for the API that runs inside the app, so anyone can
 * try every screen without a key and without touching a real person's number.
 *
 *   - Sample numbers come from the North American range reserved for film and
 *     television (area code + 555-0100 to 555-0199), which is never assigned.
 *   - Names, about lines and businesses are invented; websites and emails use
 *     the reserved `.example` domain; pictures are small drawings.
 *   - Nothing here opens a network connection. Any host that is not one of the
 *     three API hosts is refused.
 *
 * It answers the way the real API does on each channel (see classify.ts), so
 * the demo exercises the same code a real run does: the 200-with-exists:false
 * "not on WhatsApp", the cache miss on DB Only, the Number Validator's answer
 * without profile data, a 400 for a number it rejects, an occasional 503 that
 * succeeds on retry, and a 429 when calls come too close together.
 */
import { CHANNELS } from '../shared/channels';
import { PhoneEntry } from '../shared/types';
import { FetchLike } from './apiClient';

const AREA_CODES = [
  '212', '646', '718', '917', '310', '213', '415', '628', '312', '773', '305', '786', '617', '857',
  '206', '303', '720', '404', '678', '512', '737', '702', '725', '202', '503', '971', '615', '629',
  '504', '808',
];

const FIRST_NAMES = [
  'Maya', 'Tom', 'Priya', 'Lucas', 'Aiko', 'Noah', 'Zoe', 'Mateo', 'Hana', 'Owen', 'Lena', 'Diego',
  'Ines', 'Kofi', 'Nora', 'Emil', 'Sara', 'Jonas', 'Mila', 'Theo',
];
const ABOUTS = ['Available', 'Busy', 'At work', 'At the gym', 'On holiday', 'Text me, do not call', 'Sleeping', ''];
const BUSINESS = [
  ['Harbor Street Bakery', 'Bakery', 'Fresh bread every morning since 1998.'],
  ['Northside Dental', 'Dentist', 'Appointments by message. Emergencies welcome.'],
  ['Kestrel Cycles', 'Bicycle shop', 'Repairs, rentals and custom builds.'],
  ['Bluebird Florist', 'Florist', 'Same-day bouquets across the city.'],
  ['Juniper Law Office', 'Lawyer', 'First consultation is free.'],
  ['Copper Kettle Cafe', 'Coffee shop', 'Open 7 to 7. Order ahead by chat.'],
  ['Atlas Auto Repair', 'Car repair', 'Brakes, tyres and inspections.'],
  ['Willow Yoga Studio', 'Gym', 'Classes every day from 6 am.'],
  ['Larkspur Books', 'Book shop', 'New, used and rare. We ship.'],
  ['Beacon Pharmacy', 'Pharmacy', 'Prescriptions delivered to your door.'],
  ['Saffron Kitchen', 'Restaurant', 'Family recipes. Reservations by message.'],
  ['Tidewater Realty', 'Real estate agent', 'Homes to buy and rent.'],
] as const;
const STREETS = ['Main Street', 'Harbor Road', 'Station Avenue', 'Market Square', 'Park Lane', 'River Walk'];

/** A small, stable hash so the same number always gets the same answer. */
export function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** `count` distinct numbers from the fiction range, in a fresh random order. */
export function sampleNumbers(count: number, random: () => number = Math.random): PhoneEntry[] {
  const all: string[] = [];
  for (const area of AREA_CODES) {
    for (let line = 100; line <= 199; line++) all.push(`+1${area}5550${line}`);
  }
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.max(0, Math.min(count, all.length))).map((e164) => ({
    input: `(${e164.slice(2, 5)}) 555-${e164.slice(8)}`,
    e164,
    country: 'US',
    formatted: `+1 ${e164.slice(2, 5)}-555-${e164.slice(8)}`,
    valid: true,
  }));
}

export const MAX_SAMPLE_NUMBERS = AREA_CODES.length * 100;

/**
 * Muted grounds and the deeper tone of the same hue, in the register's range:
 * sage, dusty blue, sand, heather, mist and straw. Nothing saturated.
 */
const TONES: [ground: string, mid: string, deep: string][] = [
  ['#D5E2D9', '#9DB8A6', '#3E6B55'],
  ['#D6DEEA', '#9AAECB', '#3D5680'],
  ['#E8DCCD', '#C7A98B', '#7D5A3C'],
  ['#E2D8E0', '#B9A2B4', '#664A61'],
  ['#DCE1E5', '#A5B0BA', '#3F4C59'],
  ['#EAE3CF', '#CDBE92', '#6F6236'],
];

/**
 * Capital letters drawn as single strokes on a 20 × 28 grid, in the marks'
 * own hand: the monograms of demo businesses use no font at all, so they look
 * the same on every system and match the drawn marks of the window.
 */
const LETTERS: Record<string, string> = {
  A: 'M1 28L10 0L19 28M4.6 17H15.4',
  B: 'M2 0V28M2 0H11a6.5 6.5 0 0 1 0 13H2M2 13H12a7.5 7.5 0 0 1 0 15H2',
  C: 'M19 5A11 14 0 1 0 19 23',
  D: 'M2 0V28H7a13 14 0 0 0 0-28Z',
  E: 'M18 0H2V28H18M2 14H14',
  F: 'M18 0H2V28M2 14H14',
  G: 'M19 5A11 14 0 1 0 19.5 21V15H12',
  H: 'M2 0V28M18 0V28M2 14H18',
  I: 'M10 0V28M5 0H15M5 28H15',
  J: 'M15 0V20a6.5 7 0 0 1-13 0',
  K: 'M2 0V28M18 0L2 16M7.5 11L18 28',
  L: 'M2 0V28H17',
  M: 'M1 28V0L10 18L19 0V28',
  N: 'M2 28V0L18 28V0',
  O: 'M0 14a10 14 0 1 0 20 0a10 14 0 1 0-20 0',
  P: 'M2 28V0H11a7 7 0 0 1 0 14H2',
  Q: 'M0 14a10 14 0 1 0 20 0a10 14 0 1 0-20 0M12 20L19 28',
  R: 'M2 28V0H11a7 7 0 0 1 0 14H2M9 14L18 28',
  S: 'M18 4C16 1 13 0 10 0C5 0 2 2.5 2 7C2 15 18 12 18 21C18 25.5 15 28 10 28C6 28 3 26.5 1.5 24',
  T: 'M0 0H20M10 0V28',
  U: 'M2 0V18a8 10 0 0 0 16 0V0',
  V: 'M0 0L10 28L20 0',
  W: 'M0 0L5 28L10 10L15 28L20 0',
  X: 'M1 0L19 28M19 0L1 28',
  Y: 'M0 0L10 14L20 0M10 14V28',
  Z: 'M1 0H19L1 28H19',
};

/** One or two letters, centred in the 96 × 96 picture. */
function monogram(letters: string, color: string): string {
  const drawn = letters.split('').filter((l) => LETTERS[l]);
  const width = drawn.length * 20 + (drawn.length - 1) * 8;
  return drawn
    .map(
      (letter, i) =>
        `<path transform="translate(${(96 - width) / 2 + i * 28} 34)" d="${LETTERS[letter]}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join('');
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || 'A';

/**
 * A drawn picture as a data URL, never a person and never the grey "no photo"
 * silhouette, so a demo picture is not mistaken for a real one or a missing
 * one. Businesses get a monogram, like the logos many use; people get a quiet
 * landscape or still life, like the photos many use.
 */
export function drawPicture(seed: string, business: boolean, name = ''): string {
  const h = hash(seed);
  const [ground, mid, deep] = TONES[h % TONES.length];
  let body: string;
  if (business) {
    const letters = initials(name);
    const text = monogram(letters, deep);
    const marks = [
      `<rect width="96" height="96" fill="${ground}"/>${text}`,
      `<rect width="96" height="96" fill="${ground}"/><circle cx="48" cy="48" r="31" fill="none" stroke="${deep}" stroke-width="2.5"/>${text}`,
      `<rect width="96" height="96" fill="${ground}"/>${text}<rect x="30" y="68" width="36" height="3" fill="${mid}"/>`,
    ];
    body = marks[(h >>> 8) % marks.length];
  } else {
    const x = 20 + ((h >>> 9) % 56);
    const scenes = [
      // A low sun over water.
      `<rect width="96" height="96" fill="${ground}"/><circle cx="${x}" cy="56" r="13" fill="${mid}"/><rect y="58" width="96" height="38" fill="${deep}" opacity="0.85"/><rect y="66" width="96" height="2" fill="${ground}" opacity="0.35"/><rect y="76" width="96" height="2" fill="${ground}" opacity="0.25"/>`,
      // Two hills.
      `<rect width="96" height="96" fill="${ground}"/><path d="M0 70Q${x} 34 96 64V96H0Z" fill="${mid}"/><path d="M0 84Q${96 - x} 58 96 82V96H0Z" fill="${deep}" opacity="0.9"/>`,
      // A single leaf.
      `<rect width="96" height="96" fill="${ground}"/><path d="M26 72C26 42 46 24 72 22C72 50 54 70 26 72Z" fill="${mid}"/><path d="M27 71L66 30" stroke="${deep}" stroke-width="2" stroke-linecap="round"/>`,
      // An arched window.
      `<rect width="96" height="96" fill="${mid}"/><path d="M30 84V44a18 18 0 0 1 36 0V84Z" fill="${ground}"/><path d="M48 26V84M30 58H66" stroke="${deep}" stroke-width="2.5"/>`,
      // Waves.
      `<rect width="96" height="96" fill="${ground}"/><path d="M0 40q12-8 24 0t24 0 24 0 24 0M0 56q12-8 24 0t24 0 24 0 24 0M0 72q12-8 24 0t24 0 24 0 24 0" fill="none" stroke="${deep}" stroke-width="3" stroke-linecap="round"/>`,
    ];
    body = scenes[(h >>> 4) % scenes.length];
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface DemoProfile {
  status: 200 | 400 | 404 | 503;
  body: Record<string, unknown>;
}

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

/** City centres for the sample area codes, so a demo business has a place on the map. */
const CITY: Record<string, [number, number]> = {
  '212': [40.7128, -74.006], '646': [40.7484, -73.9857], '718': [40.6782, -73.9442], '917': [40.7306, -73.9352],
  '310': [34.0195, -118.4912], '213': [34.0522, -118.2437], '415': [37.7749, -122.4194], '628': [37.7599, -122.4148],
  '312': [41.8781, -87.6298], '773': [41.9484, -87.6553], '305': [25.7617, -80.1918], '786': [25.79, -80.13],
  '617': [42.3601, -71.0589], '857': [42.3496, -71.0746], '206': [47.6062, -122.3321], '303': [39.7392, -104.9903],
  '720': [39.6837, -104.9611], '404': [33.749, -84.388], '678': [33.9526, -84.5499], '512': [30.2672, -97.7431],
  '737': [30.3072, -97.7559], '702': [36.1699, -115.1398], '725': [36.1146, -115.1728], '202': [38.9072, -77.0369],
  '503': [45.5152, -122.6784], '971': [45.5434, -122.6544], '615': [36.1627, -86.7816], '629': [36.1866, -86.785],
  '504': [29.9511, -90.0715], '808': [21.3069, -157.8583],
};

const day = (mode: string, hours: number[][] = []) => ({ mode, hours });
/** Opening hours in WhatsApp's shape: minutes after midnight, a day left out is closed. */
const HOURS = [
  { config: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, day('open_24h')])), timezone: '' },
  {
    config: {
      ...Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, day('specific_hours', [[540, 1080]])])),
      sat: day('specific_hours', [[600, 840]]),
    },
    timezone: 'America/New_York',
  },
  {
    config: {
      ...Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, day('specific_hours', [[480, 720], [780, 1200]])])),
      sun: day('appointment_only'),
    },
    timezone: '',
  },
  { config: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, day('specific_hours', [[420, 1140]])])), timezone: '' },
];

const EARLIER_ABOUTS = ['Hey there! I am using WhatsApp.', 'New number, save it', 'Back from holiday', 'Only messages, please', 'Moving soon'];

/** A date in 2025, the same for the same seed. */
const pastDate = (seed: number, offsetDays = 0): string =>
  new Date(Date.UTC(2025, 0, 1) + ((seed % 300) + offsetDays) * 86_400_000).toISOString();

function earlier(digits: string, h: number) {
  const abouts =
    h % 4 === 0
      ? [
          { about: EARLIER_ABOUTS[(h >>> 3) % EARLIER_ABOUTS.length], date: pastDate(h >>> 5) },
          { about: EARLIER_ABOUTS[(h >>> 6) % EARLIER_ABOUTS.length], date: pastDate(h >>> 5, 40) },
        ]
      : [];
  const pictures =
    h % 5 === 0
      ? [1, 2].slice(0, 1 + ((h >>> 9) % 2)).map((n) => ({ number: n, date: pastDate(h >>> 7, n * 30), url: drawPicture(`${digits}:earlier:${n}`, false) }))
      : [];
  return { aboutHistory: abouts, pictureHistory: pictures };
}

/** What the simulated database says about `digits` on the direct channel. */
export function demoRecord(digits: string): DemoProfile {
  const h = hash(digits);
  const roll = h % 1000;

  if (roll < 6) {
    return { status: 400, body: { error: 'Invalid phone number', code: 'INVALID_PHONE_NUMBER' } };
  }
  if (roll < 340) {
    // A few numbers left WhatsApp: the database still knows what they showed before.
    const history = h % 6 === 0 ? earlier(digits, h * 7) : { aboutHistory: [], pictureHistory: [] };
    return {
      status: 200,
      body: {
        error: 'Number not found',
        status: 404,
        exists: false,
        code: 'NUMBER_NOT_FOUND',
        number: digits,
        countryCode: 'US',
        ...history,
        ...(h % 6 === 0 ? { urlImage: drawPicture(`${digits}:last`, false), hasUrlImage: true } : {}),
      },
    };
  }
  const base = {
    number: digits,
    phone: `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`,
    countryCode: 'US',
    exists: true,
    isWAContact: true,
    isUser: true,
    type: 'FIXED_LINE_OR_MOBILE',
  };
  if (roll < 530) {
    const [name, category, description] = BUSINESS[(h >>> 10) % BUSINESS.length];
    const domain = `${slug(name)}.example`;
    const address = (h >>> 20) % 3 ? `${1 + ((h >>> 5) % 880)} ${STREETS[(h >>> 12) % STREETS.length]}` : '';
    const city = CITY[digits.slice(1, 4)];
    const platform = (h >>> 13) % 7 === 0;
    const level = (h >>> 14) % 13 === 0 ? 'high' : (h >>> 14) % 4 === 0 ? 'low' : null;
    return {
      status: 200,
      body: {
        ...base,
        isBusiness: true,
        isEnterprise: platform,
        isVerified: level !== null,
        about: description,
        hasUrlImage: true,
        image_status: 'found',
        urlImage: drawPicture(`${name}:${digits}`, true, name),
        businessProfile: {
          displayName: name,
          description,
          categories: [{ id: category, localized_display_name: category }],
          email: (h >>> 16) % 3 ? `hello@${domain}` : '',
          website: (h >>> 18) % 4 ? [`https://${domain}`, ...((h >>> 19) % 3 === 0 ? [`https://shop.${domain}`] : [])] : [],
          address,
          latitude: 0,
          longitude: 0,
          location:
            address && city
              ? { type: 'Point', coordinates: [city[1] + (((h >>> 3) % 200) - 100) / 4000, city[0] + (((h >>> 11) % 200) - 100) / 4000] }
              : undefined,
          businessHours: (h >>> 17) % 5 ? HOURS[(h >>> 21) % HOURS.length] : undefined,
          verifiedLevel: level,
          identityType: platform ? 'ent' : 'smb',
          isOfficial: platform,
          memberSinceTs: Math.floor(Date.UTC(2018, 1, 1) / 1000) + ((h >>> 2) % 2600) * 86_400,
          catalogStatus: (h >>> 22) % 4 === 0 ? 'catalog_exists' : '',
          linkedAccounts: (h >>> 23) % 3 === 0 ? { ig_handle: slug(name).replace(/-/g, '') } : null,
        },
      },
    };
  }
  // Personal accounts: most show their picture, some only to their contacts, a few have none.
  const shown = h % 9 !== 0 && h % 11 !== 0;
  return {
    status: 200,
    body: {
      ...base,
      isBusiness: false,
      pushname: FIRST_NAMES[(h >>> 10) % FIRST_NAMES.length],
      about: ABOUTS[(h >>> 15) % ABOUTS.length],
      aboutSetAt: pastDate(h >>> 4, 60),
      image_status: shown ? 'found' : h % 9 === 0 ? 'not-authorized' : 'item-not-found',
      hasUrlImage: shown,
      ...(shown ? { urlImage: drawPicture(digits, false) } : {}),
      ...earlier(digits, h),
    },
  };
}

export interface DemoOptions {
  /** Requests on the demo key. */
  quota?: number;
  /** Simulate network time. Off in tests. */
  latency?: boolean;
  /** The demo API refuses calls closer together than this. */
  minGapMs?: number;
  now?: () => number;
  random?: () => number;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });
}

/** A `fetch` that answers the three API hosts from memory and refuses every other URL. */
export function createDemoFetch(options: DemoOptions = {}): FetchLike {
  const limit = options.quota ?? 5000;
  const minGapMs = options.minGapMs ?? 100;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  let remaining = limit;
  let lastCall = 0;
  const failedOnce = new Set<string>();

  const hosts = new Map(
    Object.values(CHANNELS).map((spec) => [new URL(spec.baseUrl).host, spec.id] as const)
  );

  const respond = (status: number, body: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-ratelimit-requests-limit': String(limit),
      'x-ratelimit-requests-remaining': String(remaining),
      ...extra,
    };
    return {
      status,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
      text: async () => JSON.stringify(body),
    };
  };

  return async (input, init = {}) => {
    const url = new URL(input);
    const channel = hosts.get(url.host);
    if (!channel) return respond(502, { error: 'Demo mode never goes online.' });

    if (options.latency !== false) await wait(60 + random() * 160, init.signal);
    else if (init.signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });

    const key = Object.entries(init.headers ?? {}).find(([k]) => k.toLowerCase() === 'x-rapidapi-key')?.[1];
    if (!key || !key.trim()) return respond(401, { error: 'API key missing', code: 'KEY_REQUIRED' });

    if (url.pathname === '/api-key-stats') {
      return respond(200, {
        role: 'demo',
        status: 'active',
        requestRemaining: remaining,
        requestLimit: limit,
        expiresAt: new Date(now() + 365 * 86_400_000).toISOString(),
      });
    }

    const stamp = now();
    if (stamp - lastCall < minGapMs) {
      return respond(429, { error: `Requests must be at least ${minGapMs / 1000} seconds apart` });
    }
    lastCall = stamp;
    if (remaining <= 0) return respond(429, { error: 'Monthly quota exceeded' });

    const match = url.pathname.match(/^\/(number|number_cache)\/(\d{7,15})$/);
    if (!match) return respond(404, { message: `Endpoint '${url.pathname}' does not exist` });
    const digits = match[2];
    const h = hash(digits);

    // About one number in seventy fails once with a 503, then answers on the retry.
    if (h % 70 === 3 && !failedOnce.has(digits)) {
      failedOnce.add(digits);
      return respond(503, { error: 'Service temporarily unavailable' });
    }

    const record = demoRecord(digits);
    if (record.status === 400) return respond(400, record.body);

    if (channel === 'dbonly') {
      // One number in five was never collected; a known "not on WhatsApp" is a 404 with the record.
      if (h % 5 === 0) return respond(404, { error: 'Number not found in database', status: 404, code: 'NOT_IN_DATABASE' });
      remaining--;
      // The database answers with what it collected, some time before today.
      const collected = new Date(now() - (2 + ((h >>> 3) % 200)) * 86_400_000).toISOString();
      return respond(record.body.exists === false ? 404 : 200, { ...record.body, date: collected });
    }

    remaining--;
    if (channel === 'validator') {
      // This listing answers registered or not, masks the number and carries no profile.
      const masked = `${digits.slice(0, 3)}****${digits.slice(-4)}`;
      return respond(200, {
        number: masked,
        countryCode: 'US',
        exists: record.body.exists === true,
        ...(record.body.exists === true ? {} : { code: 'NUMBER_NOT_FOUND', status: 404 }),
        notice: { code: 'PROFILE_DATA_OMITTED', message: 'Profile data is not part of this listing.' },
      });
    }
    return respond(200, { ...record.body, date: new Date(now()).toISOString() });
  };
}
