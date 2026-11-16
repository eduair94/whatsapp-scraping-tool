import { useState } from 'react';
import { PictureState } from '../../shared/types';
import { Icon } from './Marks';

const EMPTY_TITLE = {
  hidden: 'Picture hidden by privacy settings',
  broken: 'The picture could not be loaded',
  none: 'No profile picture',
} as const;

interface Props {
  url?: string;
  state?: PictureState;
  /** Width and height in pixels, or 'fill' to take the size of the container. */
  size: number | 'fill';
  /** Leave empty when a name next to the picture already says whose it is. */
  alt?: string;
  className?: string;
}

/**
 * A profile picture, or a drawn frame that says why there is none: hidden by
 * the owner's privacy settings, not set, or not loading. Square with soft
 * corners, like a photo pinned to a register; never a circle.
 */
export function Avatar({ url, state, size, alt = '', className = '' }: Props) {
  const [broken, setBroken] = useState<string | null>(null);
  const px = size === 'fill' ? undefined : size;

  if (url && broken !== url) {
    return (
      <img
        className={`avatar ${className}`}
        src={url}
        alt={alt}
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="no-referrer"
        onError={() => setBroken(url)}
      />
    );
  }

  const kind = state === 'hidden' ? 'hidden' : url ? 'broken' : 'none';
  return (
    <span
      className={`avatar avatar-empty avatar-${kind} ${className}`}
      style={px ? { width: px, height: px } : undefined}
      role={alt ? 'img' : undefined}
      aria-label={alt ? `${alt}: ${EMPTY_TITLE[kind].toLowerCase()}` : undefined}
      title={EMPTY_TITLE[kind]}
    >
      <Icon name={kind === 'hidden' ? 'eye-off' : 'picture-off'} size={px && px < 40 ? 14 : 22} />
    </span>
  );
}
