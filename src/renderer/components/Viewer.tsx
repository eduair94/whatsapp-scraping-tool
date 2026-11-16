/**
 * A profile picture at full size, with the person or business it belongs to.
 * Previous and Next (or the arrow keys) walk through the pictures of the list
 * as it is filtered; Escape or a click outside closes it.
 */
import { KeyboardEvent, MouseEvent, useEffect, useRef } from 'react';
import { OUTCOME_LABEL } from '../../shared/outcomes';
import { accountType, dayLabel } from '../../shared/profile';
import { CheckResult, ListNumber } from '../../shared/types';
import { display, n } from '../format';
import { Icon, Mark } from './Marks';

export interface ViewerItem {
  key: string;
  url: string;
  number: ListNumber;
  result?: CheckResult;
  /** Set for a picture an earlier check saw. */
  earlier?: { seenAt?: string };
}

interface Props {
  items: ViewerItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onSave: (item: ViewerItem) => void;
  onOpenInBrowser: (item: ViewerItem) => void;
}

export function Viewer({ items, index, onIndex, onClose, onSave, onOpenInBrowser }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const item = items[Math.min(index, items.length - 1)];

  useEffect(() => {
    const el = dialog.current;
    if (!el || el.open) return;
    opener.current = document.activeElement as HTMLElement | null;
    el.showModal();
    // The dialog itself takes the focus: the arrow keys work at once and no button lights up.
    el.focus();
    return () => {
      // Back to whatever opened the picture, so the keyboard does not lose its place.
      opener.current?.focus({ preventScroll: true });
    };
  }, []);

  // The next picture is fetched before it is asked for, so stepping through feels instant.
  useEffect(() => {
    const next = items[index + 1];
    if (next && !next.url.startsWith('data:')) new Image().src = next.url;
  }, [items, index]);

  if (!item) return null;
  const result = item.result;
  const shown = display(item.number);
  const name = result?.name ?? shown;
  const kind = accountType(result);
  const line = result?.business ? result.category : result?.about;

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      onIndex(index - 1);
    } else if (event.key === 'ArrowRight' && index < items.length - 1) {
      event.preventDefault();
      onIndex(index + 1);
    }
  };
  // A click on the backdrop lands on the dialog itself, outside its content.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialog.current) dialog.current.close();
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      tabIndex={-1}
      className="viewer"
      aria-label={`Profile picture of ${name}`}
      onClose={onClose}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <div className="viewer-stage">
        <img key={item.key} className="viewer-picture" src={item.url} alt={item.earlier ? `${name}, earlier` : name} referrerPolicy="no-referrer" />
      </div>
      <div className="viewer-side">
        <div className="viewer-head">
          <h2>{name}</h2>
          <button type="button" className="iconbtn" aria-label="Close" onClick={() => dialog.current?.close()}>
            <Icon name="close" />
          </button>
        </div>
        <p className="viewer-number num">{shown}</p>
        {result && (
          <p className="viewer-outcome">
            <Mark kind={result.outcome} />
            <span>
              {OUTCOME_LABEL[result.outcome]}
              {kind && `, ${kind.toLowerCase()} account`}
            </span>
          </p>
        )}
        {line && <p className="viewer-line">{line}</p>}
        {item.earlier && (
          <p className="viewer-earlier">
            An earlier picture{item.earlier.seenAt ? `, seen ${dayLabel(item.earlier.seenAt)}` : ''}. It may not be the one
            shown today.
          </p>
        )}

        <div className="viewer-actions">
          <button type="button" className="btn" onClick={() => onSave(item)}>
            <Icon name="download" />
            Save picture…
          </button>
          {!item.url.startsWith('data:') && (
            <button type="button" className="btn btn-quiet" onClick={() => onOpenInBrowser(item)}>
              <Icon name="external" />
              Open in the browser
            </button>
          )}
        </div>

        {items.length > 1 && (
          <div className="viewer-nav">
            <button
              type="button"
              className="btn btn-icon"
              aria-label="Previous picture"
              title="Previous (Left arrow)"
              disabled={index === 0}
              onClick={() => onIndex(index - 1)}
            >
              <Icon name="prev" />
            </button>
            <span className="viewer-count" aria-live="polite">
              {n(index + 1)} of {n(items.length)}
            </span>
            <button
              type="button"
              className="btn btn-icon"
              aria-label="Next picture"
              title="Next (Right arrow)"
              disabled={index >= items.length - 1}
              onClick={() => onIndex(index + 1)}
            >
              <Icon name="next" />
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
