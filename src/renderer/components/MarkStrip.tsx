/**
 * The mark strip: the whole list as one column of marks, so ten thousand
 * answers read at a glance and any stretch of the list is one click away.
 * The bracket shows the part of the list that is in the table right now;
 * clicking or dragging the strip jumps there.
 */
import { KeyboardEvent, PointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { n } from '../format';
import { MARK_COLOR, MarkKind } from './Marks';

const ORDER: MarkKind[] = ['on_whatsapp', 'not_on_whatsapp', 'not_in_database', 'invalid', 'failed', 'pending'];
/** A short list gets one separate tick per number; a long one shares each pixel row. */
const TICK = 3;
const PITCH = 5;

interface Props {
  /** One mark per number of the list, in list order. */
  kinds: MarkKind[];
  /** Changes whenever an answer arrives. */
  version: number;
  /** The first and last number of the list shown in the table. */
  first: number;
  last: number;
  onJump: (index: number) => void;
  /** The id of the table this strip moves. */
  controls: string;
}

export function MarkStrip({ kinds, version, first, last, onJump, controls }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [theme, setTheme] = useState(0);
  const count = kinds.length;
  const ticks = count > 0 && count * PITCH <= size.height;
  const span = ticks ? count * PITCH : size.height;

  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Colours come from the stylesheet, so the strip follows light and dark.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setTheme((t) => t + 1);
    media.addEventListener('change', bump);
    return () => media.removeEventListener('change', bump);
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el || size.width === 0 || size.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    el.width = Math.round(size.width * ratio);
    el.height = Math.round(size.height * ratio);
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);
    if (count === 0) return;

    const styles = getComputedStyle(el);
    const color = {} as Record<MarkKind, string>;
    for (const kind of ORDER) color[kind] = styles.getPropertyValue(MARK_COLOR[kind]).trim() || '#888888';
    const width = size.width;

    if (ticks) {
      for (let i = 0; i < count; i++) {
        const kind = kinds[i];
        const y = i * PITCH;
        if (kind === 'pending') {
          // Nothing written yet: an empty box.
          ctx.strokeStyle = color.pending;
          ctx.lineWidth = 1;
          ctx.strokeRect(0.5, y + 0.5, width - 1, TICK - 1);
        } else {
          ctx.fillStyle = color[kind];
          // An invalid number is half a mark: it was never asked.
          ctx.fillRect(0, y, kind === 'invalid' ? Math.round(width / 2) : width, TICK);
        }
      }
      return;
    }

    // More numbers than pixels: each pixel row shows the mix of the numbers it stands for.
    const tally = new Map<MarkKind, number>();
    for (let y = 0; y < size.height; y++) {
      const from = Math.floor((y * count) / size.height);
      const to = Math.min(count, Math.max(from + 1, Math.floor(((y + 1) * count) / size.height)));
      tally.clear();
      for (let i = from; i < to; i++) tally.set(kinds[i], (tally.get(kinds[i]) ?? 0) + 1);
      let x = 0;
      for (const kind of ORDER) {
        const share = tally.get(kind);
        if (!share) continue;
        const w = (share / (to - from)) * width;
        ctx.globalAlpha = kind === 'pending' ? 0.3 : 1;
        ctx.fillStyle = color[kind];
        ctx.fillRect(x, y, w, 1);
        x += w;
      }
    }
    ctx.globalAlpha = 1;
  }, [kinds, version, count, size, ticks, theme]);

  const indexAt = useCallback(
    (clientY: number) => {
      const el = track.current;
      if (!el || count === 0 || span === 0) return 0;
      const y = clientY - el.getBoundingClientRect().top;
      return Math.max(0, Math.min(count - 1, Math.floor((y / span) * count)));
    },
    [count, span]
  );

  const dragging = useRef(false);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (count === 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onJump(indexAt(event.clientY));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) onJump(indexAt(event.clientY));
  };
  const onPointerUp = () => {
    dragging.current = false;
  };

  const page = Math.max(1, last - first + 1);
  const middle = first + Math.floor(page / 2);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowDown: middle + page,
      ArrowUp: middle - page,
      PageDown: middle + page * 5,
      PageUp: middle - page * 5,
      Home: 0,
      End: count - 1,
    };
    if (!(event.key in moves) || count === 0) return;
    event.preventDefault();
    onJump(Math.max(0, Math.min(count - 1, moves[event.key])));
  };

  const top = count ? (first / count) * span : 0;
  const bracket = count ? Math.max(14, (page / count) * span) : 0;

  return (
    <div
      className="strip"
      role="scrollbar"
      aria-label="The whole list"
      aria-controls={controls}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, count - 1)}
      aria-valuenow={Math.min(first, Math.max(0, count - 1))}
      aria-valuetext={count ? `Numbers ${n(first + 1)} to ${n(last + 1)} of ${n(count)}` : 'Empty'}
      title="The whole list. Click or drag to jump."
      tabIndex={count ? 0 : -1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <span className="strip-label" aria-hidden="true">
        List
      </span>
      <div className="strip-track" ref={track}>
        <canvas ref={canvas} className="strip-canvas" aria-hidden="true" />
        {count > 0 && (
          <span className="strip-bracket" style={{ transform: `translateY(${top}px)`, height: bracket }} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
