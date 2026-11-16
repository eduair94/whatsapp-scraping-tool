/**
 * A table that draws only the rows in view, so a list of fifty thousand
 * numbers scrolls like a list of fifty. Rows have one fixed height.
 */
import {
  forwardRef,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** `center` puts the row in the middle, `nearest` moves as little as possible, `lead` leaves room below it. */
export type Align = 'center' | 'nearest' | 'lead';

export interface VirtualListHandle {
  scrollToIndex(index: number, align?: Align): void;
}

interface Props {
  count: number;
  rowHeight: number;
  headerHeight?: number;
  /** The row for an index: an element with `role="row"`. */
  row: (index: number) => ReactNode;
  header?: ReactNode;
  className?: string;
  id?: string;
  label: string;
  /** Told which rows are in view whenever that changes. */
  onRange?: (first: number, last: number) => void;
  /** Told when the person scrolls by hand. Scrolling done in code never calls it. */
  onUserScroll?: () => void;
  empty?: ReactNode;
}

const OVERSCAN = 6;
const SCROLL_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];

export const VirtualList = forwardRef<VirtualListHandle, Props>(function VirtualList(
  { count, rowHeight, headerHeight = 40, row, header, className = '', id, label, onRange, onUserScroll, empty },
  ref
) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const frame = useRef(0);
  const top = header ? headerHeight : 0;

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
      scrollToIndex(index, align = 'center') {
        const el = viewport.current;
        if (!el) return;
        const visible = el.clientHeight - top;
        const y = index * rowHeight;
        if (align === 'nearest') {
          if (y < el.scrollTop) el.scrollTop = y;
          else if (y + rowHeight > el.scrollTop + visible) el.scrollTop = y + rowHeight - visible;
        } else if (align === 'lead') {
          el.scrollTop = Math.max(0, y - Math.floor(visible / 4 / rowHeight) * rowHeight);
        } else {
          el.scrollTop = Math.max(0, y - (visible - rowHeight) / 2);
        }
      },
    }),
    [top, rowHeight]
  );

  const visibleHeight = Math.max(0, height - top);
  const first = Math.max(0, Math.floor(scrollTop / rowHeight));
  const last = Math.min(count - 1, Math.floor((scrollTop + visibleHeight - 1) / rowHeight));
  const from = Math.max(0, first - OVERSCAN);
  const to = Math.min(count - 1, last + OVERSCAN);

  useEffect(() => {
    if (onRange && count > 0 && visibleHeight > 0) onRange(first, Math.max(first, last));
  }, [onRange, first, last, count, visibleHeight]);

  // A shorter list (a filter, a search) must not leave the view scrolled past its end.
  useEffect(() => {
    const el = viewport.current;
    const limit = Math.max(0, count * rowHeight - visibleHeight);
    if (el && visibleHeight > 0 && el.scrollTop > limit) {
      el.scrollTop = limit;
      setScrollTop(limit);
    }
  }, [count, rowHeight, visibleHeight]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (SCROLL_KEYS.includes(event.key)) onUserScroll?.();
  };
  // A press on the viewport itself is a press on its scrollbar.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onUserScroll?.();
  };

  const rows: ReactNode[] = [];
  for (let index = from; index <= to; index++) {
    rows.push(
      <div key={index} className="vrow" role="presentation" style={{ transform: `translateY(${index * rowHeight}px)`, height: rowHeight }}>
        {row(index)}
      </div>
    );
  }

  return (
    <div className={`vlist ${className}`} id={id} role="table" aria-label={label} aria-rowcount={count + 1}>
      <div
        className="vlist-viewport"
        ref={viewport}
        role="presentation"
        // The viewport scrolls with the keyboard, so it has to take focus.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        onScroll={onScroll}
        onWheel={onUserScroll}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      >
        {header && (
          <div className="vlist-header" role="rowgroup" style={{ height: top }}>
            {header}
          </div>
        )}
        {count === 0 ? (
          <div className="vlist-empty">{empty}</div>
        ) : (
          <div className="vlist-body" role="rowgroup" style={{ height: count * rowHeight }}>
            {rows}
          </div>
        )}
      </div>
    </div>
  );
});
