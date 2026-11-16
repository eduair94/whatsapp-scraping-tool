/**
 * The marks. Every number gets exactly one, and the same six shapes are used
 * in the row gutter, the totals, the rail and the strip. Each is drawn on a
 * 16-unit grid with one stroke weight, and always travels with its words:
 * colour and shape never carry the answer alone.
 */
import { OUTCOME_LABEL } from '../../shared/outcomes';
import { Counts, Outcome } from '../../shared/types';

export type MarkKind = Outcome | 'pending';

export const MARK_LABEL: Record<MarkKind, string> = { ...OUTCOME_LABEL, pending: 'Pending' };

/** The CSS custom property that holds each mark's colour. */
export const MARK_COLOR: Record<MarkKind, string> = {
  on_whatsapp: '--tick',
  not_on_whatsapp: '--cross',
  not_in_database: '--unknown',
  invalid: '--dash',
  failed: '--bang',
  pending: '--blank',
};

// `pathLength` lets the stylesheet draw a mark from nothing when its answer arrives.
const PATHS: Record<MarkKind, JSX.Element> = {
  on_whatsapp: <path pathLength={1} d="M3.2 8.6l3.1 3.1 6.5-7.4" />,
  not_on_whatsapp: <path pathLength={1} d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" />,
  not_in_database: (
    <>
      <path pathLength={1} d="M5.9 6.2a2.2 2.2 0 1 1 3.3 1.9c-.8.5-1.2.9-1.2 1.8" />
      <path pathLength={1} d="M8 12.3v.1" />
    </>
  ),
  invalid: <path pathLength={1} d="M4 8h8" />,
  failed: (
    <>
      <path pathLength={1} d="M8 3.4v5.4" />
      <path pathLength={1} d="M8 12.2v.1" />
    </>
  ),
  pending: <circle pathLength={1} cx="8" cy="8" r="3.6" />,
};

export function Mark({ kind, size = 16, label = false }: { kind: MarkKind; size?: number; label?: boolean }) {
  return (
    <svg
      className={`mark mark-${kind}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={kind === 'pending' ? 1.4 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label ? MARK_LABEL[kind] : undefined}
      aria-hidden={label ? undefined : true}
    >
      {PATHS[kind]}
    </svg>
  );
}

/** The share of each outcome in a list, as one thin bar. Used for the lists in the rail. */
export function MarkBar({ counts }: { counts: Counts }) {
  const total = Math.max(1, counts.total);
  const parts: [MarkKind, number][] = [
    ['on_whatsapp', counts.on_whatsapp],
    ['not_on_whatsapp', counts.not_on_whatsapp],
    ['not_in_database', counts.not_in_database],
    ['invalid', counts.invalid],
    ['failed', counts.failed],
  ];
  return (
    <span className="markbar" aria-hidden="true">
      {parts.map(([kind, value]) =>
        value > 0 ? <span key={kind} className={`markbar-part mark-${kind}`} style={{ flexGrow: value / total }} /> : null
      )}
      <span className="markbar-rest" style={{ flexGrow: Math.max(0, total - counts.checked) / total }} />
    </span>
  );
}

export type IconName =
  | 'plus'
  | 'star'
  | 'star-filled'
  | 'trash'
  | 'close'
  | 'gear'
  | 'file'
  | 'export'
  | 'search'
  | 'pencil'
  | 'eye-off'
  | 'picture-off'
  | 'expand'
  | 'download'
  | 'external'
  | 'prev'
  | 'next'
  | 'grid'
  | 'rows';

const ICONS: Record<IconName, JSX.Element> = {
  plus: <path d="M8 3v10M3 8h10" />,
  star: <path d="M8 2.4l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z" />,
  'star-filled': <path d="M8 2.4l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.1l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z" fill="currentColor" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  gear: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" />
    </>
  ),
  file: <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />,
  export: <path d="M8 10V2.8M5 5.6l3-3 3 3M3 10.5V13h10v-2.5" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2l3 3" />
    </>
  ),
  pencil: <path d="M3 13l.6-2.6L10.9 3l2.1 2.1-7.4 7.3zM9.6 4.3l2.1 2.1" />,
  'eye-off': (
    <>
      <path d="M2.4 8s2.1-4 5.6-4 5.6 4 5.6 4-2.1 4-5.6 4-5.6-4-5.6-4z" />
      <circle cx="8" cy="8" r="1.7" />
      <path d="M3 13L13 3" />
    </>
  ),
  'picture-off': (
    <>
      <path d="M3.2 4.6h9.6v7.8H3.2z" />
      <path d="M3.2 10.6l3-2.8 2.2 2 1.6-1.4 2.8 2.4" />
      <path d="M2.4 2.4l11.2 11.2" />
    </>
  ),
  expand: <path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9.2 6.8M2.5 13.5l4.3-4.3" />,
  download: <path d="M8 2.8V10M5 7l3 3 3-3M3 10.5V13h10v-2.5" />,
  external: <path d="M9 2.8h4.2V7M13.2 2.8L7.6 8.4M11.2 9.6V13H3V4.8h3.4" />,
  prev: <path d="M10 3.5L5.5 8l4.5 4.5" />,
  next: <path d="M6 3.5l4.5 4.5L6 12.5" />,
  grid: <path d="M2.8 2.8h4.4v4.4H2.8zM8.8 2.8h4.4v4.4H8.8zM2.8 8.8h4.4v4.4H2.8zM8.8 8.8h4.4v4.4H8.8z" />,
  rows: <path d="M2.8 4h10.4M2.8 8h10.4M2.8 12h10.4" />,
};

/** Small drawn icons for controls, in the marks' stroke. */
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
