/**
 * Preparing a list: add numbers (a file, a paste, or sample numbers in the
 * demo), look at how they were read, then start.
 */
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CHANNELS } from '../../shared/channels';
import { PhoneEntry } from '../../shared/types';
import { checker } from '../bridge';
import { countryName, display, duration, n, plural } from '../format';
import { Checker } from '../useChecker';
import { CountrySelect } from './CountrySelect';
import { Icon, Mark } from './Marks';
import { VirtualList } from './VirtualList';

/** The first thing a new user needs: a key. Shown inline, where the work starts. */
function KeyStep({ app }: { app: Checker }) {
  const [value, setValue] = useState('');
  const [working, setWorking] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    setWorking(true);
    const saved = await app.saveSettings({ apiKey: value });
    // Asking the API about a direct key is free. A RapidAPI key can only be
    // tried with a real lookup, and that request is for the person to spend.
    if (saved?.resolvedChannel === 'direct') {
      const check = await app.checkKey();
      if (check) {
        app.setNotice(
          check.ok
            ? { kind: 'ok', text: check.message }
            : { kind: 'error', text: `${check.message} You can change the key in Settings.` }
        );
      }
    }
    setWorking(false);
  };
  return (
    <section className="keystep" aria-labelledby="keystep-title">
      <h2 id="keystep-title">First, your API key</h2>
      <p>
        The app asks the WhatsApp Data API about each number, and the API needs a key. A direct key or a RapidAPI key
        both work. It is kept on this computer and sent nowhere else.
      </p>
      <form className="row" onSubmit={submit}>
        <label className="sr-only" htmlFor="first-key">
          API key
        </label>
        <input
          id="first-key"
          className="input grow"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste your key"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={working || !value.trim()}>
          {working ? 'Saving…' : 'Save key'}
        </button>
      </form>
      <p className="keystep-links">
        <button type="button" className="link" onClick={() => void checker.open(CHANNELS.direct.keyUrl)}>
          Get a key
        </button>
        <button type="button" className="link" onClick={() => void app.setDemo(true)}>
          Try the demo without a key
        </button>
      </p>
    </section>
  );
}

function AddNumbers({ app, append }: { app: Checker; append: boolean }) {
  const [text, setText] = useState('');
  const [sample, setSample] = useState(200);
  const demo = Boolean(app.info?.demo);
  return (
    <div className="add">
      <div className="add-row">
        <button type="button" className="btn" disabled={app.busy} onClick={() => void app.addFile(append)}>
          <Icon name="file" />
          Open a file…
        </button>
        <p className="hint">
          CSV, Excel or text. The phone column is found for you. You can also drop the file anywhere on this window.
        </p>
      </div>

      {demo && !append && (
        <div className="add-row">
          <label htmlFor="sample-count">Sample numbers</label>
          <input
            id="sample-count"
            className="input short"
            type="number"
            min={1}
            max={3000}
            value={sample}
            onChange={(event) => setSample(Number(event.target.value))}
          />
          <button type="button" className="btn" disabled={app.busy} onClick={() => void app.addSample(sample)}>
            Use sample numbers
          </button>
          <p className="hint">From the range kept for film and television, which belongs to no one.</p>
        </div>
      )}

      <div className="pastesheet">
        <label className="sr-only" htmlFor={append ? 'paste-more' : 'paste'}>
          Numbers, one per line
        </label>
        <textarea
          id={append ? 'paste-more' : 'paste'}
          rows={append ? 5 : 9}
          spellCheck={false}
          placeholder={'Or paste numbers here, one per line\n+1 212 555 0147\n(212) 555-0148'}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </div>

      <div className="add-row">
        <button
          type="button"
          className={text.trim() ? 'btn btn-primary' : 'btn'}
          disabled={app.busy || !text.trim()}
          onClick={async () => {
            await app.addText(text, append);
            setText('');
          }}
        >
          Read these numbers
        </button>
      </div>
    </div>
  );
}

export function NewCheck({ app }: { app: Checker }) {
  const { draft, settings, info } = app;
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [onlyInvalid, setOnlyInvalid] = useState(false);
  const label = draft?.label ?? '';
  const lastLabel = useRef('');

  useEffect(() => {
    if (label !== lastLabel.current) {
      lastLabel.current = label;
      setName(label);
      setAdding(false);
      setOnlyInvalid(false);
    }
  }, [label]);

  const valid = useMemo(() => draft?.entries.filter((e) => e.valid) ?? [], [draft]);
  const invalid = useMemo(() => draft?.entries.filter((e) => !e.valid) ?? [], [draft]);
  const showInvalid = onlyInvalid && invalid.length > 0;
  const shown: PhoneEntry[] = showInvalid ? invalid : (draft?.entries ?? []);
  const needsKey = !settings?.hasKey && !info?.demo;

  // One request starts every `gapMs`, and an answer takes about a third of a second.
  const pace = (settings?.gapMs ?? 550) + 350;
  const channel = settings?.resolvedChannel ? CHANNELS[settings.resolvedChannel] : null;

  if (!draft) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1>New check</h1>
            <p>Add the numbers you want to check. Nothing is sent until you start.</p>
          </div>
        </header>
        {needsKey && <KeyStep app={app} />}
        <div className="field inline country-line">
          <label htmlFor="country-new">Numbers written without a country code are from</label>
          <CountrySelect app={app} id="country-new" />
        </div>
        <AddNumbers app={app} append={false} />
      </div>
    );
  }

  return (
    <div className="page page-fill">
      <header className="page-head">
        <div>
          <h1>
            {valid.length > 0 ? `${plural(valid.length, 'number')} ready to check` : 'None of these numbers can be checked'}
          </h1>
          <p>
            From {draft.label}
            {invalid.length > 0 && <>, {plural(invalid.length, 'entry', 'entries')} could not be read</>}
            {draft.duplicates > 0 && <>, {plural(draft.duplicates, 'duplicate')} removed</>}.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-quiet" onClick={() => void app.discardDraft()}>
            Discard
          </button>
          {draft.source !== 'sample' && (
            <button type="button" className="btn" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              Add more numbers
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={app.busy || valid.length === 0 || needsKey || Boolean(app.runningId)}
            onClick={() => void app.startDraft(name)}
          >
            Start check
          </button>
        </div>
      </header>

      {needsKey && <KeyStep app={app} />}

      <div className="review-form">
        <div className="field">
          <label htmlFor="list-name">Name of this list</label>
          <input id="list-name" className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
        </div>
        {draft.source !== 'sample' && (
          <div className="field">
            <label htmlFor="country">Numbers without a country code are from</label>
            <CountrySelect app={app} id="country" />
          </div>
        )}
      </div>

      {app.runningId ? (
        <p className="hint">Another check is running. Stop it, or wait for it, before starting this one.</p>
      ) : (
        valid.length > 0 && (
          <p className="hint">
            This takes {duration(valid.length * pace)} and uses up to {plural(valid.length, 'request')} of your key.
            {channel && !channel.profile && <> {channel.label} answers registered or not, without profile data.</>}
            {channel && !channel.live && <> {channel.label} reads the database and makes no live check.</>} You can stop
            and continue whenever you like.
          </p>
        )
      )}

      {adding && <AddNumbers app={app} append />}

      <div className="list-head">
        <h2>The list</h2>
        {invalid.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={onlyInvalid} onChange={(event) => setOnlyInvalid(event.target.checked)} />
            Only the {n(invalid.length)} that could not be read
          </label>
        )}
      </div>
      <VirtualList
        className="sheet"
        rowHeight={40}
        count={shown.length}
        label="Numbers to check"
        header={
          <div className="sheet-row sheet-headrow review-cols" role="row">
            <span role="columnheader" className="gutter" aria-label="Mark" />
            <span role="columnheader">As written</span>
            <span role="columnheader">Read as</span>
            <span role="columnheader">Country</span>
            <span role="columnheader">Note</span>
          </div>
        }
        row={(index) => {
          const entry = shown[index];
          return (
            <div className="sheet-row review-cols" role="row" aria-rowindex={index + 2}>
              <span role="cell" className="gutter">
                <Mark kind={entry.valid ? 'pending' : 'invalid'} label />
              </span>
              <span role="cell" className="clip">
                {entry.input}
              </span>
              <span role="cell" className="num clip">
                {entry.valid ? display(entry) : ''}
              </span>
              <span role="cell" className="clip">
                {countryName(entry.country)}
              </span>
              <span role="cell" className="clip soft">
                {entry.reason ?? ''}
              </span>
            </div>
          );
        }}
      />
    </div>
  );
}
