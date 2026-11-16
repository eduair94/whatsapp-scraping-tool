/**
 * One list and its check: the header with the action, the totals, the list
 * as a table (with its mark gutter) or as a wall of pictures, the details of
 * one number, the picture viewer, and the mark strip.
 */
import { KeyboardEvent, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CHANNELS } from '../../shared/channels';
import { accountType, isoDay } from '../../shared/profile';
import { Counts, ListNumber, Outcome } from '../../shared/types';
import { checker } from '../bridge';
import { countryName, display, n, plural, unmarked, when } from '../format';
import { Checker } from '../useChecker';
import { Avatar } from './Avatar';
import { Detail } from './Detail';
import { Gallery, GalleryHandle, GalleryItem } from './Gallery';
import { Icon, Mark, MARK_LABEL, MarkKind } from './Marks';
import { MarkStrip } from './MarkStrip';
import { SessionHeader } from './SessionHeader';
import { Viewer, ViewerItem } from './Viewer';
import { VirtualList, VirtualListHandle } from './VirtualList';

type Filter = 'all' | 'business' | 'pending' | Outcome;
type Mode = 'table' | 'pictures';

const ROW = 44;
const TABLE_ID = 'results';
const WALL_ID = 'pictures';
const NO_NUMBERS: ListNumber[] = [];

/** The place of the first value at or after `target` in a sorted list. */
function lowerBound(sorted: number[], target: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rememberedMode(): Mode {
  try {
    return window.localStorage.getItem('view-mode') === 'pictures' ? 'pictures' : 'table';
  } catch {
    return 'table';
  }
}

// ── Totals ───────────────────────────────────────────────────────────────

function Tally({ counts, showUnknown }: { counts: Counts; showUnknown: boolean }) {
  const items: { kind: MarkKind; value: number; label: string }[] = [
    { kind: 'on_whatsapp', value: counts.on_whatsapp, label: 'on WhatsApp' },
    { kind: 'not_on_whatsapp', value: counts.not_on_whatsapp, label: 'not on WhatsApp' },
    ...(showUnknown ? [{ kind: 'not_in_database' as const, value: counts.not_in_database, label: 'not in database' }] : []),
    { kind: 'invalid', value: counts.invalid, label: 'invalid' },
    { kind: 'failed', value: counts.failed, label: 'failed' },
    { kind: 'pending', value: unmarked(counts), label: 'pending' },
  ];
  const share = counts.total > 0 ? counts.checked / counts.total : 0;
  return (
    <section className="tally" aria-label="Totals" data-complete={counts.total > 0 && counts.checked === counts.total ? '' : undefined}>
      <ul className={`totals totals-${items.length}`}>
        {items.map((item) => (
          <li key={item.kind}>
            <Mark kind={item.kind} size={22} />
            <b>{n(item.value)}</b>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
      <div className="progress">
        <div
          className="bar"
          role="progressbar"
          aria-label="Numbers checked"
          aria-valuemin={0}
          aria-valuemax={counts.total}
          aria-valuenow={counts.checked}
        >
          <span className="bar-fill" style={{ width: `${share * 100}%` }} />
        </div>
        <span>
          {n(counts.checked)} of {n(counts.total)} checked
        </span>
      </div>
    </section>
  );
}

function Loading() {
  return (
    <div className="session-view" aria-busy="true">
      <div className="session-main">
        <p className="sr-only" role="status">
          Opening the list…
        </p>
        <div className="head">
          <div className="head-title">
            <div className="skeleton skeleton-title" />
            <div className="skeleton skeleton-line" />
          </div>
        </div>
        <div className="tally skeleton-tally" />
        <div className="filters" />
        <div className="sheet-area">
          <div className="vlist sheet" />
        </div>
      </div>
      <div className="strip" aria-hidden="true" />
    </div>
  );
}

// ── The view ─────────────────────────────────────────────────────────────

export function SessionView({
  app,
  exportOpen,
  onExportOpen,
}: {
  app: Checker;
  exportOpen: boolean;
  onExportOpen: (open: boolean) => void;
}) {
  const { session, results, version, live, runningId, view, sessionLoading, settings } = app;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [range, setRange] = useState({ first: 0, last: 0 });
  const [wallRange, setWallRange] = useState({ first: 0, last: 0 });
  const [mode, setMode] = useState<Mode>(rememberedMode);
  const [viewer, setViewer] = useState<{ items: ViewerItem[]; index: number } | null>(null);
  const list = useRef<VirtualListHandle>(null);
  const wall = useRef<GalleryHandle>(null);
  const wantsFocus = useRef<string | null>(null);

  const id = session?.meta.id ?? null;
  const numbers = session?.numbers ?? NO_NUMBERS;
  const running = id !== null && runningId === id;
  const channel = session?.meta.channel ?? settings?.resolvedChannel ?? null;
  const profiles = (channel ? CHANNELS[channel].profile : true) || (session?.meta.counts.business ?? 0) > 0;
  const pictures = Boolean(settings?.showPictures) && profiles;
  const showWall = pictures && mode === 'pictures';

  // Another list: start from its top, with nothing selected and nothing open.
  useEffect(() => {
    setFilter('all');
    setQuery('');
    setSelected(null);
    setFollow(true);
    setRange({ first: 0, last: 0 });
    setWallRange({ first: 0, last: 0 });
    setViewer(null);
    onExportOpen(false);
  }, [id, onExportOpen]);
  useEffect(() => () => onExportOpen(false), [onExportOpen]);

  // A check that starts is followed until the person scrolls away.
  useEffect(() => {
    if (running) setFollow(true);
  }, [running]);

  const indexOf = useMemo(() => new Map(numbers.map((number, index) => [number.e164, index])), [numbers]);

  /** One mark per number of the list. */
  const kinds = useMemo<MarkKind[]>(() => {
    void version; // the results map changes in place; its version says when
    return numbers.map((number) => results.get(number.e164)?.outcome ?? 'pending');
  }, [numbers, results, version]);

  /** The places in the list of the numbers the filter and the search keep. */
  const rows = useMemo(() => {
    void version;
    const text = deferredQuery.trim().toLowerCase();
    const numeric = text !== '' && /^[0-9+() .-]+$/.test(text);
    const digits = text.replace(/[^0-9]/g, '');
    const out: number[] = [];
    for (let index = 0; index < numbers.length; index++) {
      const number = numbers[index];
      const result = results.get(number.e164);
      if (filter === 'pending') {
        if (result) continue;
      } else if (filter === 'business') {
        if (!(result?.outcome === 'on_whatsapp' && result.business)) continue;
      } else if (filter !== 'all' && result?.outcome !== filter) {
        continue;
      }
      if (text) {
        const hit = numeric
          ? // As stored ("+59899123456") or as the list has it ("099 123 456").
            digits !== '' && (number.e164.includes(digits) || number.input.replace(/[^0-9]/g, '').includes(digits))
          : Boolean(result?.name?.toLowerCase().includes(text)) ||
            Boolean(result?.category?.toLowerCase().includes(text)) ||
            Boolean(result?.about?.toLowerCase().includes(text)) ||
            number.input.toLowerCase().includes(text);
        if (!hit) continue;
      }
      out.push(index);
    }
    return out;
  }, [numbers, results, version, filter, deferredQuery]);

  /** The rows that have a current picture, as cards for the wall and pages for the viewer. */
  const cards = useMemo<GalleryItem[]>(() => {
    void version;
    if (!pictures) return [];
    const out: GalleryItem[] = [];
    for (const listIndex of rows) {
      const number = numbers[listIndex];
      const result = results.get(number.e164);
      if (result?.outcome !== 'on_whatsapp' || !result.pictureUrl) continue;
      const shown = display(number);
      out.push({
        key: number.e164,
        listIndex,
        url: result.pictureUrl,
        title: result.name ?? shown,
        subtitle: result.name ? shown : (result.about ?? result.category ?? ''),
      });
    }
    return out;
  }, [pictures, rows, numbers, results, version]);
  const cardPlaces = useMemo(() => cards.map((card) => card.listIndex), [cards]);

  const onRange = useCallback(
    (first: number, last: number) => setRange((r) => (r.first === first && r.last === last ? r : { first, last })),
    []
  );
  const onWallRange = useCallback(
    (first: number, last: number) => setWallRange((r) => (r.first === first && r.last === last ? r : { first, last })),
    []
  );
  const stopFollowing = useCallback(() => setFollow(false), []);

  /** The strip was pressed at a place in the list: show the nearest row (or card) at or after it. */
  const jump = useCallback(
    (listIndex: number) => {
      setFollow(false);
      if (showWall) {
        if (cardPlaces.length) wall.current?.scrollToItem(Math.min(cardPlaces.length - 1, lowerBound(cardPlaces, listIndex)));
        return;
      }
      if (rows.length === 0) return;
      list.current?.scrollToIndex(Math.min(rows.length - 1, lowerBound(rows, listIndex)), 'center');
    },
    [rows, showWall, cardPlaces]
  );

  // Following the check: when the newest mark nears the foot of the table, turn the page.
  const rowsNow = useRef(rows);
  rowsNow.current = rows;
  const rangeNow = useRef(range);
  rangeNow.current = range;
  const newest = running ? live?.lastNumber : undefined;
  useEffect(() => {
    if (!follow || !newest || showWall) return;
    const listIndex = indexOf.get(newest);
    if (listIndex === undefined) return;
    const at = lowerBound(rowsNow.current, listIndex);
    if (rowsNow.current[at] !== listIndex) return; // not shown under this filter
    if (at < rangeNow.current.first || at > rangeNow.current.last - 2) list.current?.scrollToIndex(at, 'lead');
  }, [follow, newest, indexOf, showWall]);

  const select = useCallback((e164: string) => {
    setFollow(false);
    setSelected((current) => (current === e164 ? null : e164));
  }, []);

  // After moving the selection with the arrow keys, the row that now holds it takes the focus.
  useEffect(() => {
    if (!wantsFocus.current) return;
    const button = document.querySelector<HTMLButtonElement>(`[data-number="${wantsFocus.current}"] .rowbtn`);
    if (button) {
      button.focus({ preventScroll: true });
      wantsFocus.current = null;
    }
  });

  const chooseMode = (next: Mode) => {
    setMode(next);
    setFollow(false);
    try {
      window.localStorage.setItem('view-mode', next);
    } catch {
      // Remembering the view is a convenience.
    }
  };

  // ── The picture viewer ──────────────────────────────────────────────
  const listPages = (): ViewerItem[] =>
    cards.map((card) => {
      const number = numbers[card.listIndex];
      return { key: card.key, url: card.url, number, result: results.get(number.e164) };
    });

  const viewFromList = (e164: string) => {
    const pages = listPages();
    const index = pages.findIndex((page) => page.number.e164 === e164);
    if (index >= 0) {
      setViewer({ items: pages, index });
      return;
    }
    // Not under the current filter or search: show it on its own.
    const listIndex = indexOf.get(e164);
    const result = results.get(e164);
    if (listIndex === undefined || !result?.pictureUrl) return;
    setViewer({ items: [{ key: e164, url: result.pictureUrl, number: numbers[listIndex], result }], index: 0 });
  };

  const viewEarlier = (e164: string, which: 'current' | number) => {
    if (which === 'current') {
      viewFromList(e164);
      return;
    }
    const listIndex = indexOf.get(e164);
    if (listIndex === undefined) return;
    const number = numbers[listIndex];
    const result = results.get(e164);
    const pages: ViewerItem[] = [
      ...(result?.pictureUrl ? [{ key: `${e164}:now`, url: result.pictureUrl, number, result }] : []),
      ...(result?.pictureHistory ?? []).map((picture, i) => ({
        key: `${e164}:earlier:${i}`,
        url: picture.url,
        number,
        result,
        earlier: { seenAt: picture.seenAt },
      })),
    ];
    setViewer({ items: pages, index: (result?.pictureUrl ? 1 : 0) + which });
  };

  /** Turning the pages of the viewer moves the table (or the wall) behind it along. */
  const turnTo = (index: number) => {
    if (!viewer) return;
    setViewer({ ...viewer, index });
    const page = viewer.items[index];
    if (!page || page.earlier) return;
    if (showWall) {
      const at = cards.findIndex((card) => card.key === page.key);
      if (at >= 0) wall.current?.scrollToItem(at);
      return;
    }
    setSelected(page.number.e164);
    const listIndex = indexOf.get(page.number.e164);
    if (listIndex === undefined) return;
    const at = lowerBound(rows, listIndex);
    if (rows[at] === listIndex) list.current?.scrollToIndex(at, 'nearest');
  };

  const savePage = (page: ViewerItem) => {
    const digits = page.number.e164.replace(/\D/g, '');
    const suffix = page.earlier ? `-earlier${page.earlier.seenAt ? `-${isoDay(page.earlier.seenAt)}` : ''}` : '';
    void app.savePicture(page.url, `${digits}${suffix}`);
  };

  if (!session || sessionLoading || (view.kind === 'session' && view.id !== session.meta.id)) return <Loading />;

  const { meta } = session;
  const cols = profiles ? 'result-cols' : 'result-cols plain';
  const c = meta.counts;

  const tabs = (
    [
      { id: 'all', label: 'All', count: c.total },
      { id: 'on_whatsapp', label: 'On WhatsApp', count: c.on_whatsapp },
      { id: 'business', label: 'Business', count: c.business },
      { id: 'not_on_whatsapp', label: 'Not on WhatsApp', count: c.not_on_whatsapp },
      { id: 'not_in_database', label: 'Not in database', count: c.not_in_database },
      { id: 'invalid', label: 'Invalid', count: c.invalid },
      { id: 'failed', label: 'Failed', count: c.failed },
      { id: 'pending', label: 'Pending', count: unmarked(c) },
    ] satisfies { id: Filter; label: string; count: number }[]
  ).filter((tab) => tab.id === 'all' || tab.count > 0 || tab.id === filter);

  const selectedIndex = selected ? indexOf.get(selected) : undefined;
  const selectedNumber = selectedIndex === undefined ? null : numbers[selectedIndex];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && selected) {
      setSelected(null);
      return;
    }
    if (selectedIndex === undefined || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    if (!(event.target as HTMLElement).classList.contains('rowbtn')) return;
    const at = lowerBound(rows, selectedIndex);
    const next = at + (event.key === 'ArrowDown' ? 1 : -1);
    if (rows[at] !== selectedIndex || next < 0 || next >= rows.length) return;
    event.preventDefault();
    const target = numbers[rows[next]].e164;
    setFollow(false);
    setSelected(target);
    wantsFocus.current = target;
    list.current?.scrollToIndex(next, 'nearest');
  };

  const header = (
    <div className={`sheet-row sheet-headrow ${cols}`} role="row" aria-rowindex={1}>
      <span role="columnheader" className="gutter" aria-label="Mark" />
      <span role="columnheader">Number</span>
      <span role="columnheader">Outcome</span>
      {profiles ? (
        <>
          <span role="columnheader">Name</span>
          <span role="columnheader" className="col-type">
            Type
          </span>
          <span role="columnheader" className="col-about">
            About or category
          </span>
        </>
      ) : (
        <>
          <span role="columnheader" className="col-type">
            Country
          </span>
          <span role="columnheader">Note</span>
        </>
      )}
      <span role="columnheader" className="col-when">
        Checked
      </span>
    </div>
  );

  const row = (index: number) => {
    const number = numbers[rows[index]];
    const result = results.get(number.e164);
    const kind: MarkKind = result?.outcome ?? 'pending';
    const shown = display(number);
    const avatar = pictures && kind === 'on_whatsapp' && (result?.pictureUrl || result?.picture);
    return (
      <div
        className={`sheet-row ${cols}`}
        role="row"
        aria-rowindex={index + 2}
        aria-selected={selected === number.e164}
        data-row
        data-number={number.e164}
        data-new={newest === number.e164 ? '' : undefined}
      >
        <span role="cell" className="gutter">
          <Mark kind={kind} />
        </span>
        <span role="cell" className="num">
          <button type="button" className="rowbtn" aria-label={`${shown}, details`} onClick={() => select(number.e164)}>
            {shown}
          </button>
        </span>
        <span role="cell" className={`outcome outcome-${kind}`}>
          {MARK_LABEL[kind]}
        </span>
        {profiles ? (
          <>
            <span role="cell" className="namecell">
              {avatar && <Avatar url={result?.pictureUrl} state={result?.picture} size={28} />}
              <span className="clip">{result?.name ?? ''}</span>
            </span>
            <span role="cell" className="col-type">
              {accountType(result)}
            </span>
            <span role="cell" className="col-about">
              {result?.note ?? (result?.business ? result.category : result?.about) ?? ''}
            </span>
          </>
        ) : (
          <>
            <span role="cell" className="col-type">
              {countryName(result?.country ?? number.country)}
            </span>
            <span role="cell">{result?.note ?? ''}</span>
          </>
        )}
        <span role="cell" className="col-when">
          {when(result?.checkedAt)}
        </span>
      </div>
    );
  };

  const narrowed = filter !== 'all' || query.trim() !== '';
  const showAll = () => {
    setFilter('all');
    setQuery('');
  };
  const empty = (
    <div className="empty">
      <p>{query.trim() ? `Nothing in this list matches “${query.trim()}”.` : 'No number of this list has that outcome.'}</p>
      <button type="button" className="btn" onClick={showAll}>
        Show the whole list
      </button>
    </div>
  );
  const emptyWall = (
    <div className="empty">
      <p>
        {c.checked === 0
          ? 'Pictures appear here as numbers are checked.'
          : narrowed
            ? 'No number shown here has a profile picture.'
            : 'No number of this list has a profile picture yet.'}
      </p>
      {narrowed && (
        <button type="button" className="btn" onClick={showAll}>
          Show the whole list
        </button>
      )}
    </div>
  );

  const lastRow = Math.max(0, rows.length - 1);
  const lastCard = Math.max(0, cards.length - 1);
  const [firstInList, lastInList] = showWall
    ? cards.length
      ? [cards[Math.min(wallRange.first, lastCard)].listIndex, cards[Math.min(wallRange.last, lastCard)].listIndex]
      : [0, 0]
    : rows.length
      ? [rows[Math.min(range.first, lastRow)], rows[Math.min(range.last, lastRow)]]
      : [0, 0];

  return (
    <div className="session-view">
      <div className="session-main">
        <SessionHeader key={meta.id} app={app} meta={meta} exportOpen={exportOpen} onExportOpen={onExportOpen} />
        <Tally counts={c} showUnknown={c.not_in_database > 0 || channel === 'dbonly'} />

        <div className="filters">
          <div className="tabs" role="group" aria-label="Show">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="tab"
                aria-pressed={filter === tab.id}
                onClick={() => setFilter(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="filters-end">
          <span className="shown" role="status">
            {showWall ? plural(cards.length, 'picture') : plural(rows.length, 'number')}
          </span>
          {pictures && (
            <div className="viewswitch" role="group" aria-label="Show the list as">
              <button type="button" aria-pressed={!showWall} onClick={() => chooseMode('table')}>
                <Icon name="rows" />
                Table
              </button>
              <button type="button" aria-pressed={showWall} onClick={() => chooseMode('pictures')}>
                <Icon name="grid" />
                Pictures
              </button>
            </div>
          )}
          <div className="search">
            <Icon name="search" />
            <input
              className="input"
              type="search"
              placeholder="Find a number or name"
              aria-label="Find a number or name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          </div>
        </div>

        {/* Arrow keys move through the rows and Escape closes the details. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div className="sheet-area" onKeyDown={onKeyDown}>
          {showWall ? (
            <Gallery
              ref={wall}
              id={WALL_ID}
              items={cards}
              label={`Profile pictures of ${meta.name}`}
              onOpen={(index) => setViewer({ items: listPages(), index })}
              onRange={onWallRange}
              empty={emptyWall}
            />
          ) : (
            <>
              <VirtualList
                ref={list}
                id={TABLE_ID}
                className="sheet results"
                rowHeight={ROW}
                count={rows.length}
                label={`Numbers of ${meta.name}`}
                onRange={onRange}
                onUserScroll={stopFollowing}
                header={header}
                row={row}
                empty={empty}
              />
              {running && !follow && (
                <button type="button" className="btn btn-small follow" onClick={() => setFollow(true)}>
                  Follow the check
                </button>
              )}
              {selectedNumber && (
                <Detail
                  app={app}
                  number={selectedNumber}
                  result={results.get(selectedNumber.e164)}
                  profiles={profiles}
                  pictures={pictures}
                  onClose={() => setSelected(null)}
                  onViewPicture={(which) => viewEarlier(selectedNumber.e164, which)}
                />
              )}
            </>
          )}
        </div>
      </div>

      <MarkStrip kinds={kinds} version={version} first={firstInList} last={lastInList} onJump={jump} controls={showWall ? WALL_ID : TABLE_ID} />

      {viewer && (
        <Viewer
          items={viewer.items}
          index={viewer.index}
          onIndex={turnTo}
          onClose={() => setViewer(null)}
          onSave={savePage}
          onOpenInBrowser={(page) => void checker.open(page.url)}
        />
      )}
    </div>
  );
}
