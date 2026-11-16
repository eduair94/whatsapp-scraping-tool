/**
 * The head of a list: its name (rename, star, delete), what the check is
 * doing, Export, and the one action that moves it on: Start, Stop or Continue.
 */
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CHANNELS } from '../../shared/channels';
import { OUTCOME_LABEL } from '../../shared/outcomes';
import { ExportFormat, ExportScope, OUTCOMES, SessionMeta } from '../../shared/types';
import { day, duration, n, plural } from '../format';
import { Checker } from '../useChecker';
import { Icon, Mark } from './Marks';

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function Status({ app, meta }: { app: Checker; meta: SessionMeta }) {
  const c = meta.counts;
  if (meta.status === 'running') {
    const live = app.runningId === meta.id ? app.live : null;
    if (live?.waiting) {
      return (
        <p className="status">
          <b>Waiting.</b> {live.waiting}.
        </p>
      );
    }
    if (live && live.rate > 0 && live.etaMs !== null) {
      return (
        <p className="status">
          <b>Checking.</b> {capital(duration(live.etaMs))} left, at {n(live.rate * 60)} numbers a minute.
        </p>
      );
    }
    return (
      <p className="status">
        <b>Checking.</b> Starting…
      </p>
    );
  }
  if (meta.status === 'ready') {
    return (
      <p className="status">
        <b>Not started.</b> {capital(plural(c.total, 'number'))} to check.
      </p>
    );
  }
  if (meta.status === 'completed') {
    return (
      <p className="status">
        <b>Complete.</b> {capital(plural(c.total, 'number'))} checked {day(meta.finishedAt ?? meta.updatedAt)}
        {meta.channel && !app.info?.demo && <> ({CHANNELS[meta.channel].label})</>}.
      </p>
    );
  }
  return (
    <p className="status">
      <b>Stopped</b> at {n(c.checked)} of {n(c.total)}.
    </p>
  );
}

const FORMATS: { id: ExportFormat; label: string; note: string }[] = [
  { id: 'xlsx', label: 'Excel', note: 'One workbook with a summary sheet' },
  { id: 'csv', label: 'CSV', note: 'Opens in any spreadsheet' },
  { id: 'json', label: 'JSON', note: 'Every field, for other programs' },
];

function rememberedFormat(): ExportFormat {
  try {
    const stored = window.localStorage.getItem('export-format');
    return stored === 'csv' || stored === 'json' ? stored : 'xlsx';
  } catch {
    return 'xlsx';
  }
}

function ExportPanel({
  meta,
  onClose,
  onSave,
}: {
  meta: SessionMeta;
  onClose: () => void;
  onSave: (format: ExportFormat, scope: ExportScope) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [format, setFormat] = useState<ExportFormat>(rememberedFormat);
  const [scope, setScope] = useState<ExportScope>('all');

  const scopes: { id: ExportScope; label: string; count: number }[] = [
    { id: 'all', label: 'Every number', count: meta.counts.total },
    ...OUTCOMES.map((outcome) => ({ id: outcome, label: OUTCOME_LABEL[outcome], count: meta.counts[outcome] })).filter(
      (s) => s.count > 0
    ),
  ];

  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      // A press outside the panel and its button closes it.
      if (!panel.current?.parentElement?.contains(event.target as Node)) close.current();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const save = () => {
    try {
      window.localStorage.setItem('export-format', format);
    } catch {
      // Remembering the format is a convenience; exporting works without it.
    }
    onSave(format, scope);
  };

  return (
    <div className="popover" role="dialog" aria-label="Export results" ref={panel}>
      <fieldset className="choices">
        <legend>File type</legend>
        {FORMATS.map((f) => (
          <label key={f.id} className="choice">
            <input type="radio" name="export-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
            <span>
              {f.label}
              <span className="choice-note">{f.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="choices">
        <legend>Which numbers</legend>
        {scopes.map((s) => (
          <label key={s.id} className="choice">
            <input type="radio" name="export-scope" checked={scope === s.id} onChange={() => setScope(s.id)} />
            <span>{s.label}</span>
            <span className="choice-count">{n(s.count)}</span>
          </label>
        ))}
      </fieldset>
      <p className="hint">Every field is included: profile, business details, picture links and what earlier checks saw.</p>
      <button type="button" className="btn btn-primary btn-block" onClick={save}>
        Save as…
      </button>
    </div>
  );
}

export function SessionHeader({
  app,
  meta,
  exportOpen,
  onExportOpen,
}: {
  app: Checker;
  meta: SessionMeta;
  exportOpen: boolean;
  onExportOpen: (open: boolean) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(meta.name);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const running = meta.status === 'running';
  const otherRunning = Boolean(app.runningId) && app.runningId !== meta.id;

  useEffect(() => {
    if (!running) setStopping(false);
  }, [running]);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (renaming) renameInput.current?.select();
  }, [renaming]);

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const next = draftName.trim();
    if (next && next !== meta.name) await app.patchSession(meta.id, { name: next });
    setRenaming(false);
  };

  const closeExport = useCallback(() => {
    onExportOpen(false);
    exportButton.current?.focus();
  }, [onExportOpen]);

  let primary: JSX.Element | null = null;
  if (running) {
    primary = (
      <button
        type="button"
        className="btn btn-stop"
        disabled={stopping}
        onClick={() => {
          setStopping(true);
          void app.stop();
        }}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </button>
    );
  } else if (meta.status !== 'completed' && meta.counts.pending > 0) {
    primary = (
      <button
        type="button"
        className="btn btn-primary"
        disabled={otherRunning}
        title={otherRunning ? 'Another check is running. Stop it, or wait for it.' : undefined}
        onClick={() => void app.start(meta.id)}
      >
        {meta.status === 'ready' ? 'Start check' : 'Continue'}
      </button>
    );
  }

  return (
    <header className="head">
      <div className="head-title">
        {renaming ? (
          <form className="rename" onSubmit={rename}>
            <label className="sr-only" htmlFor="rename">
              Name of this list
            </label>
            <input
              id="rename"
              ref={renameInput}
              className="input"
              value={draftName}
              maxLength={120}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setRenaming(false)}
            />
            <button type="submit" className="btn btn-small">
              Save
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <div className="titleline">
            <h1 className="clip" title={meta.name}>
              {meta.name}
            </h1>
            <button
              type="button"
              className="iconbtn"
              aria-label="Rename this list"
              title="Rename"
              onClick={() => {
                setDraftName(meta.name);
                setRenaming(true);
              }}
            >
              <Icon name="pencil" />
            </button>
            <button
              type="button"
              className="iconbtn"
              aria-pressed={meta.starred}
              aria-label="Starred"
              title={meta.starred ? 'Remove the star' : 'Star this list'}
              onClick={() => void app.patchSession(meta.id, { starred: !meta.starred })}
            >
              <Icon name={meta.starred ? 'star-filled' : 'star'} />
            </button>
            <button
              type="button"
              className="iconbtn"
              aria-label="Delete this list"
              title={running ? 'Stop the check before deleting the list' : 'Delete'}
              disabled={running}
              onClick={() => setConfirming(true)}
            >
              <Icon name="trash" />
            </button>
          </div>
        )}

        {confirming ? (
          <div className="confirm" role="group" aria-label="Delete this list">
            <span>Delete this list and its results? Files you exported stay where they are.</span>
            <button type="button" className="btn btn-small btn-danger" onClick={() => void app.remove(meta.id)}>
              Delete
            </button>
            <button type="button" className="btn btn-small" ref={keep} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <Status app={app} meta={meta} />
        )}
        {meta.stopReason && !confirming && (
          <p className="stopnote">
            <Mark kind="failed" />
            <span>{meta.stopReason}</span>
          </p>
        )}
      </div>

      <div className="actions">
        <div className="export">
          <button
            ref={exportButton}
            type="button"
            className={meta.status === 'completed' ? 'btn btn-primary' : 'btn'}
            aria-haspopup="dialog"
            aria-expanded={exportOpen}
            onClick={() => onExportOpen(!exportOpen)}
          >
            <Icon name="export" />
            Export
          </button>
          {exportOpen && (
            <ExportPanel
              meta={meta}
              onClose={closeExport}
              onSave={(format, scope) => {
                onExportOpen(false);
                void app.exportSession(meta.id, format, scope);
              }}
            />
          )}
        </div>
        {primary}
      </div>
    </header>
  );
}
