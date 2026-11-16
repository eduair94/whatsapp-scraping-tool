/**
 * Settings: the key and where it is sent, how numbers are read, the pace of a
 * check, the look, the demo, and what the app is.
 */
import { FormEvent, useEffect, useState } from 'react';
import { CHANNELS } from '../../shared/channels';
import { GUIDE_URL, ISSUES_URL, OPT_OUT_URL, REPO_URL } from '../../shared/links';
import { Channel, ChannelSetting, ThemeSetting } from '../../shared/types';
import { checker } from '../bridge';
import { plural } from '../format';
import { Checker } from '../useChecker';
import { CountrySelect } from './CountrySelect';
import { Mark } from './Marks';

const CHANNEL_ORDER: Channel[] = ['direct', 'validator', 'dbonly'];
const THEMES: { id: ThemeSetting; label: string }[] = [
  { id: 'system', label: 'Same as the system' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** A number that is saved when the field is left or Enter is pressed, not on every keystroke. */
function NumberField({
  id,
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  hint,
  onCommit,
}: {
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || text.trim() === '') {
      setText(String(value));
      return;
    }
    const next = Math.min(max, Math.max(min, parsed));
    setText(String(next));
    if (next !== value) onCommit(next);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input
          id={id}
          className="input short"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={text}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => event.key === 'Enter' && commit()}
        />
        <span className="soft">{unit}</span>
      </div>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function Settings({ app }: { app: Checker }) {
  const { settings, info, keyCheck, sessions } = app;
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  if (!settings || !info) return null;

  const resolved = settings.resolvedChannel;

  const check = async () => {
    setChecking(true);
    await app.checkKey();
    setChecking(false);
  };

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    const saved = await app.saveSettings({ apiKey: key });
    setKey('');
    setSaving(false);
    // Asking about a direct key is free, so it is checked straight away.
    if (saved?.resolvedChannel === 'direct') await check();
  };

  const channels: { id: ChannelSetting; label: string; note: string }[] = [
    {
      id: 'auto',
      label: 'Recognise it from the key',
      note:
        settings.hasKey && resolved
          ? `Your key is sent to ${CHANNELS[resolved].label}.`
          : 'A direct key is recognised by its shape. A RapidAPI key is sent to the Number Validator.',
    },
    ...CHANNEL_ORDER.map((id) => ({ id, label: CHANNELS[id].label, note: CHANNELS[id].returns })),
  ];

  return (
    <div className="page settings">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
        </div>
      </header>

      <section aria-labelledby="set-key">
        <h2 id="set-key">API key</h2>
        {info.demo ? (
          <p className="lead">
            The demo uses a made-up key and simulated answers. Leave the demo to add your own key.
          </p>
        ) : (
          <>
            <p className="lead">
              {settings.hasKey ? (
                <>
                  A key ending in <b className="num">{settings.keyEnding}</b> is stored on this computer
                  {settings.canStoreKey ? ', encrypted by your system' : ''}. It is sent only to the API.
                </>
              ) : (
                <>No key is stored yet. The key stays on this computer and is sent only to the API.</>
              )}
            </p>
            {!settings.canStoreKey && (
              <p className="hint">
                This system has no keyring to protect a stored key, so the key is kept only until you close the app.
              </p>
            )}
            <form className="row" onSubmit={saveKey}>
              <label className="sr-only" htmlFor="set-key-input">
                {settings.hasKey ? 'Another key, to replace the stored one' : 'API key'}
              </label>
              <input
                id="set-key-input"
                className="input grow"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={settings.hasKey ? 'Paste another key to replace it' : 'Paste your key'}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={saving || !key.trim()}>
                {saving ? 'Saving…' : 'Save key'}
              </button>
            </form>
            {settings.hasKey && (
              <div className="row">
                <button type="button" className="btn" disabled={checking} onClick={() => void check()}>
                  {checking ? 'Checking…' : 'Check this key'}
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => void app.saveSettings({ apiKey: '' })}>
                  Forget the key
                </button>
                {resolved && resolved !== 'direct' && <span className="hint">Checking a RapidAPI key uses one request.</span>}
              </div>
            )}
            {keyCheck && (
              <p className="result" role="status">
                <Mark kind={keyCheck.ok ? 'on_whatsapp' : 'failed'} />
                <span>{keyCheck.message}</span>
              </p>
            )}
          </>
        )}
      </section>

      {!info.demo && (
        <section aria-labelledby="set-channel">
          <h2 id="set-channel">Where the key is sent</h2>
          <p className="lead">
            The same API is sold three ways, and each returns a different depth of data. Choose the one your key belongs
            to.
          </p>
          <fieldset className="options">
            <legend className="sr-only">Where the key is sent</legend>
            {channels.map((option) => (
              <label key={option.id} className="option">
                <input
                  type="radio"
                  name="channel"
                  checked={settings.channel === option.id}
                  onChange={() => void app.saveSettings({ channel: option.id })}
                />
                <span>
                  <span className="option-name">{option.label}</span>
                  <span className="option-note">{option.note}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="links">
            Get a key:
            {CHANNEL_ORDER.map((id) => (
              <button key={id} type="button" className="link" onClick={() => void checker.open(CHANNELS[id].keyUrl)}>
                {CHANNELS[id].label}
              </button>
            ))}
          </p>
        </section>
      )}

      <section aria-labelledby="set-numbers">
        <h2 id="set-numbers">Reading numbers</h2>
        <div className="field">
          <label htmlFor="set-country">Numbers written without a country code are from</label>
          <CountrySelect app={app} id="set-country" />
          <p className="hint">
            A number that starts with + or 00 always keeps its own country. This only decides how the others are read.
          </p>
        </div>
      </section>

      <section aria-labelledby="set-pictures">
        <h2 id="set-pictures">Profile pictures</h2>
        <label className="option">
          <input
            type="checkbox"
            checked={settings.showPictures}
            onChange={(event) => void app.saveSettings({ showPictures: event.target.checked })}
          />
          <span>
            <span className="option-name">Show profile pictures</span>
            <span className="option-note">
              Pictures load from the API’s picture server as they come into view, in the table, the details and the
              picture wall. Turned off, the app shows none and loads none. Exports keep the picture addresses either way.
            </span>
          </span>
        </label>
      </section>

      <section aria-labelledby="set-pace">
        <h2 id="set-pace">Pace</h2>
        <p className="lead">The defaults suit almost every key. Change them only if your plan allows a faster pace.</p>
        <div className="fields">
          <NumberField
            id="set-gap"
            label="Wait between two requests"
            unit="milliseconds"
            value={settings.gapMs}
            min={0}
            max={10000}
            step={50}
            hint="The API asks for at least 500. Going lower makes it answer “slow down” and the check waits."
            onCommit={(gapMs) => void app.saveSettings({ gapMs })}
          />
          <NumberField
            id="set-timeout"
            label="Give up on a request after"
            unit="seconds"
            value={Math.round(settings.timeoutMs / 1000)}
            min={5}
            max={120}
            onCommit={(seconds) => void app.saveSettings({ timeoutMs: seconds * 1000 })}
          />
          <NumberField
            id="set-retries"
            label="Try a failed request again"
            unit="times"
            value={settings.maxRetries}
            min={0}
            max={6}
            onCommit={(maxRetries) => void app.saveSettings({ maxRetries })}
          />
        </div>
      </section>

      <section aria-labelledby="set-look">
        <h2 id="set-look">Light or dark</h2>
        <fieldset className="options options-inline">
          <legend className="sr-only">Light or dark</legend>
          {THEMES.map((theme) => (
            <label key={theme.id} className="option">
              <input
                type="radio"
                name="theme"
                checked={settings.theme === theme.id}
                onChange={() => void app.saveSettings({ theme: theme.id })}
              />
              <span className="option-name">{theme.label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section aria-labelledby="set-demo">
        <h2 id="set-demo">Demo</h2>
        <p className="lead">
          {info.demo
            ? 'You are in the demo: sample numbers and simulated answers. Nothing is sent anywhere, and your own lists and key are untouched.'
            : 'Try the app with sample numbers and simulated answers. No key is needed, nothing is sent anywhere, and your own lists and key are untouched.'}
        </p>
        <button type="button" className="btn" onClick={() => void app.setDemo(!info.demo)}>
          {info.demo ? 'Leave the demo' : 'Open the demo'}
        </button>
      </section>

      <section aria-labelledby="set-lists">
        <h2 id="set-lists">Your lists</h2>
        <p className="lead">
          {sessions.length === 0
            ? 'No lists are stored yet.'
            : `${plural(sessions.length, 'list')} and ${sessions.length === 1 ? 'its' : 'their'} results are stored on this computer, and nowhere else.`}
        </p>
        <button
          type="button"
          className="btn btn-danger"
          disabled={sessions.length === 0}
          onClick={() => void app.clearAll()}
        >
          Delete every list…
        </button>
      </section>

      <section aria-labelledby="set-about">
        <h2 id="set-about">About</h2>
        <p className="lead">
          WhatsApp Number Checker {info.version}. Free and open source under the MIT licence. An independent tool, not
          affiliated with WhatsApp or Meta.
        </p>
        <p className="links">
          <button type="button" className="link" onClick={() => void checker.open(GUIDE_URL)}>
            User guide
          </button>
          <button type="button" className="link" onClick={() => void checker.open(REPO_URL)}>
            Source code
          </button>
          <button type="button" className="link" onClick={() => void checker.open(ISSUES_URL)}>
            Report a problem
          </button>
          <button type="button" className="link" onClick={() => void checker.open(OPT_OUT_URL)}>
            Remove a number from the database
          </button>
        </p>
      </section>
    </div>
  );
}
