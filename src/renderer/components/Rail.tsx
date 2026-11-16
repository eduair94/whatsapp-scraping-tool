import { CHANNELS } from '../../shared/channels';
import { quotaLine, sessionSummary } from '../format';
import { Checker } from '../useChecker';
import { Icon, MarkBar } from './Marks';

/** The left rail: where you are, what you have checked, and which key is in use. */
export function Rail({ app }: { app: Checker }) {
  const { sessions, view, settings, info, quota } = app;
  const starred = sessions.filter((s) => s.starred);
  const others = sessions.filter((s) => !s.starred);
  const openId = view.kind === 'session' ? view.id : null;

  const entry = (meta: (typeof sessions)[number]) => (
    <li key={meta.id}>
      <button
        type="button"
        className="session"
        aria-current={openId === meta.id ? 'page' : undefined}
        onClick={() => void app.openSession(meta.id)}
      >
        <span className="session-name">
          {meta.starred && <Icon name="star-filled" size={12} />}
          <span className="clip">{meta.name}</span>
        </span>
        <span className="session-line">{sessionSummary(meta)}</span>
        <MarkBar counts={meta.counts} />
      </button>
    </li>
  );

  const channel = settings?.resolvedChannel ? CHANNELS[settings.resolvedChannel].label : null;
  const left = quotaLine(quota);

  return (
    <nav className="rail" aria-label="Lists">
      <div className="rail-head">
        <span className="brand">WhatsApp Number Checker</span>
        {info?.demo && <span className="tag">Demo, simulated answers</span>}
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        aria-current={view.kind === 'new' ? 'page' : undefined}
        onClick={app.showNew}
      >
        <Icon name="plus" />
        New check
      </button>

      <div className="rail-scroll">
        {sessions.length === 0 ? (
          <p className="rail-empty">Lists you check are kept here, so you can come back, continue and export them.</p>
        ) : (
          <>
            {starred.length > 0 && (
              <>
                <h2 className="rail-title">Starred</h2>
                <ul className="sessions">{starred.map(entry)}</ul>
              </>
            )}
            {others.length > 0 && (
              <>
                <h2 className="rail-title">{starred.length > 0 ? 'Other lists' : 'Lists'}</h2>
                <ul className="sessions">{others.map(entry)}</ul>
              </>
            )}
          </>
        )}
      </div>

      <div className="rail-foot">
        <button
          type="button"
          className="railbtn"
          aria-current={view.kind === 'settings' ? 'page' : undefined}
          onClick={app.showSettings}
        >
          <Icon name="gear" />
          Settings
        </button>
        {info?.demo ? (
          <>
            <p className="rail-key">{left ? `Demo key, ${left}` : 'Demo key'}</p>
            <button type="button" className="link rail-leave" onClick={() => void app.setDemo(false)}>
              Leave the demo
            </button>
          </>
        ) : settings?.hasKey ? (
          <p className="rail-key">{left ? `${channel}, ${left}` : channel}</p>
        ) : (
          <p className="rail-key">No API key yet</p>
        )}
      </div>
    </nav>
  );
}
