import { describe, expect, it } from 'vitest';
import { ApiError, classify } from './classify';

const AT = '2026-11-15T12:00:00.000Z';
const N = '+59899123456';

const error = (fn: () => unknown): ApiError => {
  try {
    fn();
  } catch (err) {
    return err as ApiError;
  }
  throw new Error('expected an ApiError');
};

describe('classify: answers', () => {
  it('reads a personal profile', () => {
    const r = classify('direct', N, 200, {
      exists: true,
      isWAContact: true,
      isUser: true,
      isBusiness: false,
      pushname: 'Maya',
      about: 'At work',
      phone: '+598 99 123 456',
      countryCode: 'UY',
      urlImage: 'https://whatsapp-db.checkleaked.com/59899123456.jpg',
      profilePic: 'https://pps.whatsapp.net/expiring',
    }, AT);
    expect(r).toEqual({
      number: N,
      outcome: 'on_whatsapp',
      checkedAt: AT,
      name: 'Maya',
      about: 'At work',
      business: false,
      country: 'UY',
      picture: 'shown',
      pictureUrl: 'https://whatsapp-db.checkleaked.com/59899123456.jpg',
    });
  });

  it('reads a business: the name lives in businessProfile.displayName, websites are strings or {url}', () => {
    const r = classify('direct', N, 200, {
      exists: true,
      isWAContact: true,
      isBusiness: true,
      about: 'Open 9 to 6',
      businessProfile: {
        displayName: 'Harbor Street Bakery',
        description: 'Fresh bread',
        categories: [{ id: '1', localized_display_name: 'Bakery' }, { id: '2', localized_display_name: 'Cafe' }],
        email: 'hello@bakery.example',
        website: ['', 'https://bakery.example', 'https://shop.bakery.example', 'https://bakery.example'],
        address: '12 Main Street',
        isOfficial: true,
      },
    }, AT);
    expect(r.name).toBe('Harbor Street Bakery');
    expect(r.business).toBe(true);
    expect(r.businessKind).toBe('platform');
    // A signed identity is not the official badge.
    expect(r.verified).toBeUndefined();
    expect(r.category).toBe('Bakery, Cafe');
    expect(r.website).toBe('https://bakery.example');
    expect(r.websites).toEqual(['https://bakery.example', 'https://shop.bakery.example']);
    expect(r.email).toBe('hello@bakery.example');
    expect(r.address).toBe('12 Main Street');

    const legacy = classify('direct', N, 200, { exists: true, businessProfile: { website: [{ url: 'https://old.example' }] } }, AT);
    expect(legacy.website).toBe('https://old.example');
  });

  it('keeps the whole business profile, in the shape the live API sends it', () => {
    // The shape of a real answer (2026-11-16), with invented values.
    const r = classify('direct', N, 200, {
      about: '',
      countryCode: 'UY',
      date: '2026-11-16T02:45:11.792Z',
      isBusiness: true,
      isVerified: true,
      isEnterprise: false,
      isUser: true,
      isWAContact: true,
      phone: '+598 99 123 456',
      type: 'MOBILE',
      businessProfile: {
        description: 'Bread and coffee',
        categories: [],
        email: 'hello@bakery.example',
        website: ['https://bakery.example'],
        businessHours: {
          config: {
            mon: { mode: 'specific_hours', hours: [[540, 1080]] },
            tue: { mode: 'specific_hours', hours: [[540, 1080]] },
            wed: { mode: 'specific_hours', hours: [[540, 1080]] },
            thu: { mode: 'specific_hours', hours: [[540, 1080]] },
            fri: { mode: 'specific_hours', hours: [[540, 780], [840, 1080]] },
            sat: { mode: 'appointment_only', hours: [] },
          },
          timezone: 'America/Montevideo',
        },
        catalogStatus: 'catalog_exists',
        address: '12 Main Street',
        fbPage: {},
        igProfessional: {},
        coverPhoto: { id: '', url: '' },
        latitude: 0,
        longitude: 0,
        verifiedLevel: 'high',
        displayName: 'Harbor Street Bakery',
        identityType: 'smb',
        isOfficial: false,
        memberSinceTs: 1706215699,
        memberSinceText: 'Joined in January, 2024',
        linkedAccounts: { ig_handle: 'harborbakery', fb_page: 'Harbor Street Bakery' },
        location: { type: 'Point', coordinates: [-56.1645, -34.9011] },
      },
      profilePic: 'https://pps.whatsapp.net/v/t61/expiring.jpg',
      image_status: 'found',
      hasUrlImage: true,
      urlImage: 'https://whatsapp-db.checkleaked.com/59899123456.jpg?v=3',
      aboutHistory: [],
      faceAnalysis: { people: [{ ageMin: 30, gender: 'female' }], tags: ['bread'] },
      exists: true,
    }, AT);
    expect(r).toEqual({
      number: N,
      outcome: 'on_whatsapp',
      checkedAt: AT,
      name: 'Harbor Street Bakery',
      picture: 'shown',
      pictureUrl: 'https://whatsapp-db.checkleaked.com/59899123456.jpg?v=3',
      country: 'UY',
      recordedAt: '2026-11-16T02:45:11.792Z',
      business: true,
      businessKind: 'app',
      verifiedLevel: 'high',
      verified: true,
      description: 'Bread and coffee',
      email: 'hello@bakery.example',
      website: 'https://bakery.example',
      websites: ['https://bakery.example'],
      address: '12 Main Street',
      location: { lat: -34.9011, lng: -56.1645 },
      hours: 'Mon–Thu 09:00–18:00; Fri 09:00–13:00, 14:00–18:00; Sat by appointment; Sun closed (America/Montevideo)',
      memberSince: '2024-01-25T20:48:19.000Z',
      links: ['Instagram: @harborbakery', 'Facebook page: Harbor Street Bakery'],
      catalog: true,
    });
    // Guesses about the people in the picture are never kept.
    expect(JSON.stringify(r)).not.toMatch(/gender|ageMin|"people"|faceAnalysis|bread"/);
  });

  it('writes opening hours in words', () => {
    const every = (mode: string, hours: number[][] = []) =>
      Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { mode, hours }]));
    const hours = (businessHours: unknown) =>
      classify('direct', N, 200, { exists: true, businessProfile: { businessHours } }, AT).hours;
    expect(hours({ config: every('open_24h'), timezone: '' })).toBe('Every day, open 24 hours');
    expect(hours({ config: every('specific_hours', [[420, 1140]]) })).toBe('Every day, 07:00–19:00');
    // Some records hold seconds after midnight.
    expect(hours({ config: { mon: { mode: 'specific_hours', hours: [[32400, 64800]] } } })).toBe('Mon 09:00–18:00; Tue–Sun closed');
    expect(hours({ config: {} })).toBeUndefined();
    expect(hours(null)).toBeUndefined();
  });

  it('reads the location from coordinates or latitude and longitude, and ignores 0, 0', () => {
    const at = (businessProfile: Record<string, unknown>) =>
      classify('direct', N, 200, { exists: true, businessProfile }, AT).location;
    expect(at({ latitude: -34.9, longitude: -56.16 })).toEqual({ lat: -34.9, lng: -56.16 });
    expect(at({ latitude: 0, longitude: 0 })).toBeUndefined();
    expect(at({ location: { coordinates: [0, 0] }, latitude: 0, longitude: 0 })).toBeUndefined();
    expect(at({ location: { coordinates: [200, 10] } })).toBeUndefined();
  });

  it('tells a hidden picture from no picture, and keeps an older copy as an earlier picture', () => {
    const hidden = classify('direct', N, 200, {
      exists: true,
      image_status: 'not-authorized',
      urlImage: 'https://whatsapp-db.checkleaked.com/59899123456.jpg',
    }, AT);
    expect(hidden.picture).toBe('hidden');
    expect(hidden.pictureUrl).toBeUndefined();
    expect(hidden.pictureHistory).toEqual([{ url: 'https://whatsapp-db.checkleaked.com/59899123456.jpg' }]);

    const none = classify('direct', N, 200, { exists: true, image_status: 'item-not-found' }, AT);
    expect(none.picture).toBe('none');
    expect(none.pictureHistory).toBeUndefined();

    // A found picture without a lasting address cannot be shown.
    const noUrl = classify('direct', N, 200, { exists: true, image_status: 'found', profilePic: 'https://pps.whatsapp.net/x' }, AT);
    expect(noUrl.picture).toBeUndefined();
  });

  it('keeps what earlier checks saw, newest first, without repeating the current about or picture', () => {
    const r = classify('direct', N, 200, {
      exists: true,
      about: 'At work',
      aboutHistory: [
        { about: 'Available', date: '2025-03-01T10:00:00.000Z' },
        { about: 'At work', date: '2025-09-01T10:00:00.000Z' },
        { about: 'On holiday', date: '2025-06-01T10:00:00.000Z' },
        { about: '  ', date: '2025-07-01T10:00:00.000Z' },
      ],
      urlImage: 'https://whatsapp-db.checkleaked.com/59899123456.jpg?t=1',
      pictureHistory: [
        { number: 1, date: '2025-01-05T10:00:00.000Z', md5Image: 'a', url: 'https://whatsapp-db.checkleaked.com/59899123456_1.jpg' },
        { number: 2, date: '2025-08-05T10:00:00.000Z', md5Image: 'b', url: 'https://whatsapp-db.checkleaked.com/59899123456_2.jpg' },
        { number: 3, date: '2025-09-05T10:00:00.000Z', md5Image: 'c', url: 'https://whatsapp-db.checkleaked.com/59899123456.jpg' },
        { number: 4, md5Image: 'd', url: 'http://insecure.example/4.jpg' },
      ],
    }, AT);
    expect(r.aboutHistory).toEqual([
      { about: 'On holiday', seenAt: '2025-06-01T10:00:00.000Z' },
      { about: 'Available', seenAt: '2025-03-01T10:00:00.000Z' },
    ]);
    expect(r.pictureHistory).toEqual([
      { url: 'https://whatsapp-db.checkleaked.com/59899123456_2.jpg', seenAt: '2025-08-05T10:00:00.000Z' },
      { url: 'https://whatsapp-db.checkleaked.com/59899123456_1.jpg', seenAt: '2025-01-05T10:00:00.000Z' },
    ]);
  });

  it('reads verification and the kind of business account', () => {
    const r = (body: Record<string, unknown>) => classify('direct', N, 200, { exists: true, ...body }, AT);
    expect(r({ isBusiness: true, businessProfile: { verifiedLevel: 'low', identityType: 'ent' } })).toMatchObject({
      verifiedLevel: 'low',
      businessKind: 'platform',
    });
    expect(r({ isBusiness: true, businessProfile: { verifiedLevel: 'low' } }).verified).toBeUndefined();
    // Older records only say isVerified.
    expect(r({ isBusiness: true, isVerified: true, businessProfile: {} }).verifiedLevel).toBe('low');
    expect(r({ isBusiness: true, isEnterprise: true, businessProfile: {} }).businessKind).toBe('platform');
    // A personal account has no business kind, whatever the flags say.
    expect(r({ isBusiness: false, isEnterprise: true }).businessKind).toBeUndefined();
  });

  it('keeps what a number showed before it left WhatsApp', () => {
    const r = classify('direct', N, 200, {
      error: "Whatsapp number doesn't exist",
      status: 404,
      exists: false,
      code: 'NUMBER_NOT_FOUND',
      date: '2026-11-16T02:45:12.568Z',
      aboutHistory: [{ date: '2025-10-13T23:14:29.618Z', about: 'Old about', aboutSetAt: null }],
      hasUrlImage: true,
      pictureHistory: [],
      urlImage: 'https://whatsapp-db.checkleaked.com/59899123456.jpg',
    }, AT);
    expect(r).toEqual({
      number: N,
      outcome: 'not_on_whatsapp',
      checkedAt: AT,
      aboutHistory: [{ about: 'Old about', seenAt: '2025-10-13T23:14:29.618Z' }],
      pictureHistory: [{ url: 'https://whatsapp-db.checkleaked.com/59899123456.jpg' }],
      recordedAt: '2026-11-16T02:45:12.568Z',
    });
  });

  it('answers "not on WhatsApp" for the live 200 with exists:false', () => {
    const r = classify('direct', N, 200, { error: 'not found', status: 404, exists: false, code: 'NUMBER_NOT_FOUND' }, AT);
    expect(r).toEqual({ number: N, outcome: 'not_on_whatsapp', checkedAt: AT });
  });

  it('lets exists:false win over stale isWAContact / isUser flags', () => {
    // A cached record of a number that left WhatsApp keeps its last-seen flags.
    const r = classify('dbonly', N, 404, { exists: false, isWAContact: true, isUser: true, pushname: 'Old name' }, AT);
    expect(r.outcome).toBe('not_on_whatsapp');
    expect(r.name).toBeUndefined();
  });

  it('keeps "not in the database" apart from "not on WhatsApp"', () => {
    expect(classify('dbonly', N, 404, { code: 'NOT_IN_DATABASE', status: 404 }, AT).outcome).toBe('not_in_database');
    expect(classify('dbonly', N, 404, { code: 'NUMBER_NOT_FOUND' }, AT).outcome).toBe('not_on_whatsapp');
  });

  it('reads the Number Validator answer: registered, no profile, masked number ignored', () => {
    const r = classify('validator', N, 200, { number: '598****3456', exists: true, countryCode: 'UY', notice: { code: 'PROFILE_DATA_OMITTED' } }, AT);
    expect(r).toEqual({ number: N, outcome: 'on_whatsapp', checkedAt: AT, country: 'UY' });
    expect('business' in r).toBe(false);
  });

  it('marks a number the API rejects as invalid', () => {
    const r = classify('direct', N, 400, { error: 'Invalid phone number', code: 'INVALID_PHONE_NUMBER' }, AT);
    expect(r.outcome).toBe('invalid');
    expect(r.note).toMatch(/does not accept/);
  });

  it('never trusts an expiring WhatsApp link or a non-https picture', () => {
    const r = classify('direct', N, 200, { exists: true, urlImage: 'http://insecure.example/a.jpg' }, AT);
    expect(r.pictureUrl).toBeUndefined();
  });
});

describe('classify: errors', () => {
  it.each([
    [401, { error: 'Invalid API key', code: 'KEY_INVALID' }, 'UNAUTHORIZED', true, false],
    [401, { code: 'KEY_EXPIRED' }, 'UNAUTHORIZED', true, false],
    [403, { message: 'You are not subscribed to this API.' }, 'NOT_SUBSCRIBED', true, false],
    [403, { error: 'Insufficient role for this endpoint' }, 'FORBIDDEN', true, false],
    [403, { code: 'ENUMERATION_NOT_ALLOWED' }, 'RANGE_REFUSED', false, false],
    [404, { message: "API doesn't exists" }, 'API_GONE', true, false],
    [404, { message: "Endpoint '/number/1' does not exist" }, 'API_GONE', true, false],
    [404, { error: 'something else' }, 'BAD_RESPONSE', false, false],
    [429, { error: 'Monthly quota exceeded' }, 'QUOTA_EXCEEDED', true, false],
    [
      429,
      {
        error: 'Monthly quota exceeded',
        code: 'QUOTA_EXCEEDED',
        message: 'This API key has used all of its purchased requests. Renew it to add requests and extend its validity.',
      },
      'QUOTA_EXCEEDED',
      true,
      false,
    ],
    [429, { code: 'QUOTA_EXCEEDED', message: 'Renew this key to go on.' }, 'QUOTA_EXCEEDED', true, false],
    [429, { message: 'You have exceeded the MONTHLY quota for Requests on your current plan' }, 'QUOTA_EXCEEDED', true, false],
    [429, { code: 'DAILY_LIMIT_REACHED' }, 'DAILY_LIMIT', true, false],
    [429, { error: 'Requests must be at least 0.5 seconds apart' }, 'RATE_LIMITED', false, true],
    [500, { error: 'boom' }, 'SERVER', false, true],
    [503, null, 'SERVER', false, true],
    [200, { hello: 'world' }, 'BAD_RESPONSE', false, false],
    [302, null, 'BAD_RESPONSE', false, false],
  ] as const)('%i %j → %s', (status, body, code, fatal, retryable) => {
    const err = error(() => classify('direct', N, status, body as Record<string, unknown> | null, AT));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(code);
    expect(err.fatal).toBe(fatal);
    expect(err.retryable).toBe(retryable);
    expect(err.status).toBe(status);
  });

  it('derives the wait from "at least N seconds apart" when there is no Retry-After', () => {
    const err = error(() => classify('direct', N, 429, { error: 'Requests must be at least 0.5 seconds apart' }, AT));
    expect(err.retryAfterMs).toBe(550);
    const withHeader = error(() => classify('direct', N, 429, { error: 'slow down' }, AT, 2000));
    expect(withHeader.retryAfterMs).toBe(2000);
  });

  it('words the removed listing differently per channel', () => {
    expect(error(() => classify('validator', N, 404, { message: "API doesn't exists" }, AT)).message).toMatch(/listing no longer exists/);
    expect(error(() => classify('direct', N, 404, { message: "API doesn't exists" }, AT)).message).toMatch(/address does not exist/);
  });
});
