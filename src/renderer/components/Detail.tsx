/**
 * Everything known about one number, beside the table: the picture, the
 * profile, the business, the number itself, and what earlier checks saw.
 */
import { ReactNode, useEffect, useState } from 'react';
import {
  accountType,
  BUSINESS_KIND_LABEL,
  dayLabel,
  locationLabel,
  memberSinceLabel,
  PICTURE_LABEL,
  VERIFICATION_LABEL,
} from '../../shared/profile';
import { CheckResult, ListNumber } from '../../shared/types';
import { countryName, display, moment } from '../format';
import { Checker } from '../useChecker';
import { Avatar } from './Avatar';
import { Icon, Mark, MARK_LABEL, MarkKind } from './Marks';

type Fact = [term: string, value: ReactNode];

function Facts({ facts }: { facts: Fact[] }) {
  const shown = facts.filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== false);
  if (shown.length === 0) return null;
  return (
    <dl className="facts">
      {shown.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** More than an hour between the record and the check: the record came from the database. */
const collected = (result: CheckResult | undefined): string | undefined => {
  if (!result?.recordedAt) return undefined;
  const gap = Math.abs(new Date(result.checkedAt).getTime() - new Date(result.recordedAt).getTime());
  return gap > 3_600_000 ? dayLabel(result.recordedAt) : undefined;
};

interface Props {
  app: Checker;
  number: ListNumber;
  result: CheckResult | undefined;
  /** False when the check answers registered or not, without profiles. */
  profiles: boolean;
  /** False when profile pictures are turned off in Settings. */
  pictures: boolean;
  onClose: () => void;
  /** Opens the picture viewer on the current picture, or on one of the earlier ones. */
  onViewPicture: (which: 'current' | number) => void;
}

export function Detail({ app, number, result, profiles, pictures, onClose, onViewPicture }: Props) {
  const kind: MarkKind = result?.outcome ?? 'pending';
  const on = kind === 'on_whatsapp';
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [number.e164]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(number.e164);
      setCopied(true);
    } catch {
      // No clipboard access: the number is on screen and can be selected.
    }
  };

  const shown = display(number);
  const r = result;
  const account = accountType(r);
  const link = (kind: 'website' | 'email' | 'map', value: string, label = value) => (
    <button type="button" className="link link-wrap" onClick={() => void app.openLink(kind, value)}>
      {label}
    </button>
  );

  const profileFacts: Fact[] = [
    [
      'About',
      r?.about && (
        <>
          {r.about}
          {r.aboutSetAt && <span className="fact-sub">Set on {dayLabel(r.aboutSetAt)}</span>}
        </>
      ),
    ],
    ['Account', account && (r?.businessKind ? `${account}, ${BUSINESS_KIND_LABEL[r.businessKind]}` : account)],
    ['Verification', r?.verifiedLevel && VERIFICATION_LABEL[r.verifiedLevel]],
  ];

  const websites = r?.websites ?? (r?.website ? [r.website] : []);
  const businessFacts: Fact[] = r?.business
    ? [
        ['Category', r.category],
        ['Description', r.description],
        ['Email', r.email && link('email', r.email)],
        [
          websites.length > 1 ? 'Websites' : 'Website',
          websites.length > 0 && (
            <span className="fact-list">
              {websites.map((site) => (
                <span key={site}>{link('website', site)}</span>
              ))}
            </span>
          ),
        ],
        ['Address', r.address],
        [
          'Location',
          r.location && (
            <>
              {link('map', `${r.location.lat},${r.location.lng}`, 'Show on the map')}
              <span className="fact-sub num-plain">{locationLabel(r.location)}</span>
            </>
          ),
        ],
        ['Opening hours', r.hours],
        ['On WhatsApp Business since', memberSinceLabel(r.memberSince)],
        [
          'Linked accounts',
          r.links && r.links.length > 0 && (
            <span className="fact-list">
              {r.links.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </span>
          ),
        ],
        ['Product catalog', r.catalog && 'Has a product catalog'],
      ]
    : [];

  const numberFacts: Fact[] = [
    ['Country', countryName(r?.country ?? number.country)],
    ['Line type', number.lineType],
    ['As written in your list', number.input !== shown ? number.input : undefined],
    ['Checked', moment(r?.checkedAt)],
    ['From the database, collected', collected(r)],
    ['Note', r?.note],
  ];

  const earlierPictures = r?.pictureHistory ?? [];
  const earlierAbouts = r?.aboutHistory ?? [];
  const hasPicture = on && (r?.pictureUrl || r?.picture);

  const withPicture = pictures && hasPicture;

  return (
    <aside className="detail" aria-label={`Details of ${shown}`}>
      <button type="button" className="iconbtn detail-close" aria-label="Close the details" onClick={onClose}>
        <Icon name="close" />
      </button>

      <div className={withPicture ? 'detail-card' : 'detail-card detail-card-plain'}>
        {withPicture &&
          (r?.pictureUrl ? (
            <button
              type="button"
              className="detail-picture"
              aria-label="View the profile picture at full size"
              title="View at full size"
              onClick={() => onViewPicture('current')}
            >
              <Avatar url={r.pictureUrl} size="fill" />
              <span className="detail-zoom" aria-hidden="true">
                <Icon name="expand" size={14} />
              </span>
            </button>
          ) : (
            <div
              className={`detail-nopicture detail-nopicture-${r?.picture}`}
              title={r?.picture === 'hidden' ? PICTURE_LABEL.hidden : 'No profile picture'}
            >
              <Icon name={r?.picture === 'hidden' ? 'eye-off' : 'picture-off'} size={20} />
              <span>{r?.picture === 'hidden' ? 'Hidden' : 'No picture'}</span>
            </div>
          ))}
        <div className="detail-who">
          <h2>{r?.name ?? shown}</h2>
          <p className="detail-outcome">
            <Mark kind={kind} />
            {MARK_LABEL[kind]}
          </p>
          <p className="detail-number">
            {r?.name && <span className="num">{shown}</span>}
            <button type="button" className="link" onClick={() => void copy()}>
              {copied ? 'Copied' : r?.name ? 'Copy' : 'Copy the number'}
            </button>
          </p>
        </div>
      </div>

      {withPicture && r?.picture === 'hidden' && (
        <p className="detail-note detail-note-first">The owner shows the picture to their contacts only.</p>
      )}

      <Facts facts={profileFacts} />

      {businessFacts.some(([, value]) => value) && (
        <section className="detail-section" aria-labelledby="detail-business">
          <h3 id="detail-business">Business</h3>
          <Facts facts={businessFacts} />
        </section>
      )}

      <section className="detail-section" aria-labelledby="detail-number">
        <h3 id="detail-number">Number</h3>
        <Facts facts={numberFacts} />
      </section>

      {(earlierAbouts.length > 0 || (pictures && earlierPictures.length > 0)) && (
        <section className="detail-section" aria-labelledby="detail-earlier">
          <h3 id="detail-earlier">Earlier checks saw</h3>
          {pictures && earlierPictures.length > 0 && (
            <ul className="earlier-pictures">
              {earlierPictures.map((picture, index) => (
                <li key={picture.url}>
                  <button
                    type="button"
                    className="earlier-picture"
                    aria-label={`Earlier picture${picture.seenAt ? ` seen ${dayLabel(picture.seenAt)}` : ''}, view at full size`}
                    onClick={() => onViewPicture(index)}
                  >
                    <Avatar url={picture.url} size={64} />
                  </button>
                  {picture.seenAt && <span className="fact-sub">{dayLabel(picture.seenAt)}</span>}
                </li>
              ))}
            </ul>
          )}
          {earlierAbouts.length > 0 && (
            <ul className="earlier-abouts">
              {earlierAbouts.map((about) => (
                <li key={`${about.about}:${about.seenAt ?? ''}`}>
                  <span>{about.about}</span>
                  {about.seenAt && <span className="fact-sub">{dayLabel(about.seenAt)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {kind === 'pending' && <p className="detail-note">This number has not been checked yet.</p>}
      {kind === 'not_in_database' && (
        <p className="detail-note">
          The database has no record of this number. A live check, with a direct key or the Number Validator, can still
          answer it.
        </p>
      )}
      {on && !profiles && (
        <p className="detail-note">This check answers registered or not, so there is no profile to show.</p>
      )}
      {!pictures && (r?.pictureUrl || earlierPictures.length > 0) && (
        <p className="detail-note">
          Profile pictures are turned off.{' '}
          <button type="button" className="link" onClick={app.showSettings}>
            Change this in Settings
          </button>
        </p>
      )}
    </aside>
  );
}
