/**
 * The pictures of a list as a wall of cards: a picture, a name, a number.
 * Like the table, it draws only the rows of cards in view, so a list with
 * thousands of pictures scrolls without strain.
 */
import { forwardRef, ReactNode, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { Avatar } from './Avatar';

export interface GalleryItem {
  key: string;
  /** Where the number sits in the whole list, for the mark strip. */
  listIndex: number;
  url: string;
  title: string;
  subtitle: string;
}

export interface GalleryHandle {
  scrollToItem(index: number): void;
}

interface Props {
  items: GalleryItem[];
  id?: string;
  label: string;
  onOpen: (index: number) => void;
  /** The first and last card in view. */
  onRange?: (first: number, last: number) => void;
  empty?: ReactNode;
}

const MIN_CARD = 128;
const GAP = 16;
const PAD = 16;
/** Two lines of text under each picture. */
const CAPTION = 48;
const OVERSCAN = 2;

export const Gallery = forwardRef<GalleryHandle, Props>(function Gallery({ items, id, label, onOpen, onRange, empty }, ref) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const inner = Math.max(0, size.width - PAD * 2);
  const columns = Math.max(1, Math.floor((inner + GAP) / (MIN_CARD + GAP)));
  const card = columns > 0 ? (inner - GAP * (columns - 1)) / columns : MIN_CARD;
  const rowHeight = Math.round(card + CAPTION + GAP);
  const rowCount = Math.ceil(items.length / columns);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (viewport.current) setScrollTop(viewport.current.scrollTop);
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useImperativeHandle(
    ref,
    () => ({
      scrollToItem(index) {
        const el = viewport.current;
        if (!el) return;
        const row = Math.floor(index / columns);
        el.scrollTop = Math.max(0, PAD + row * rowHeight - (el.clientHeight - rowHeight) / 2);
      },
    }),
    [columns, rowHeight]
  );

  const firstRow = Math.max(0, Math.floor((scrollTop - PAD) / rowHeight));
  const lastRow = Math.min(rowCount - 1, Math.floor((scrollTop + size.height - PAD) / rowHeight));

  useEffect(() => {
    if (!onRange || items.length === 0 || size.height === 0) return;
    onRange(Math.min(items.length - 1, firstRow * columns), Math.min(items.length - 1, (lastRow + 1) * columns - 1));
  }, [onRange, firstRow, lastRow, columns, items.length, size.height]);

  // A shorter list must not leave the wall scrolled past its end.
  useEffect(() => {
    const el = viewport.current;
    const limit = Math.max(0, PAD * 2 + rowCount * rowHeight - size.height);
    if (el && size.height > 0 && el.scrollTop > limit) {
      el.scrollTop = limit;
      setScrollTop(limit);
    }
  }, [rowCount, rowHeight, size.height]);

  const rows: ReactNode[] = [];
  for (let row = Math.max(0, firstRow - OVERSCAN); row <= Math.min(rowCount - 1, lastRow + OVERSCAN); row++) {
    const cards: ReactNode[] = [];
    for (let i = row * columns; i < Math.min(items.length, (row + 1) * columns); i++) {
      const item = items[i];
      cards.push(
        <div key={item.key} className="card" role="listitem" aria-setsize={items.length} aria-posinset={i + 1}>
          <button type="button" className="card-button" onClick={() => onOpen(i)} aria-label={`${item.title}, ${item.subtitle}. View the picture`}>
            <Avatar url={item.url} size="fill" className="card-picture" />
            <span className="card-title">{item.title}</span>
            <span className="card-sub">{item.subtitle}</span>
          </button>
        </div>
      );
    }
    rows.push(
      <div
        key={row}
        className="gallery-row"
        role="presentation"
        style={{ transform: `translateY(${PAD + row * rowHeight}px)`, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {cards}
      </div>
    );
  }

  return (
    <div className="gallery">
      {/* The wall scrolls with the keyboard, so it has to take focus. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="gallery-viewport" id={id} ref={viewport} onScroll={onScroll} tabIndex={0} role="list" aria-label={label}>
        {items.length === 0 ? (
          <div className="vlist-empty">{empty}</div>
        ) : (
          <div className="gallery-body" style={{ height: PAD * 2 + rowCount * rowHeight - GAP }}>
            {rows}
          </div>
        )}
      </div>
    </div>
  );
});
