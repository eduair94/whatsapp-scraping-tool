/**
 * The window's state. The main process owns every fact (settings, sessions,
 * the running check); this hook mirrors them and turns clicks into requests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppInfo,
  CheckResult,
  ExportFormat,
  ExportScope,
  KeyCheck,
  ParsedList,
  PublicSettings,
  Quota,
  Session,
  SessionMeta,
  SettingsPatch,
} from '../shared/types';
import { checker } from './bridge';

export type View = { kind: 'new' } | { kind: 'session'; id: string } | { kind: 'settings' };

export interface Live {
  rate: number;
  etaMs: number | null;
  waiting?: string;
  /** The number whose answer arrived last, so the table can follow the check. */
  lastNumber?: string;
}

export interface Notice {
  kind: 'ok' | 'error';
  text: string;
  /** A file the notice is about, offered as "Show in folder". */
  path?: string;
}

const message = (err: unknown): string => {
  const text = err instanceof Error ? err.message : String(err);
  // Electron prefixes errors that cross the bridge.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
};

export function useChecker() {
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [view, setView] = useState<View>({ kind: 'new' });
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [draft, setDraft] = useState<ParsedList | null>(null);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [quota, setQuota] = useState<Quota>({ remaining: null, limit: null });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [keyCheck, setKeyCheck] = useState<KeyCheck | null>(null);
  /** Bumped whenever an answer changes, so lists derived from the results recompute. */
  const [version, setVersion] = useState(0);

  const results = useRef(new Map<string, CheckResult>());
  const openId = useRef<string | null>(null);

  const fail = useCallback((err: unknown) => setNotice({ kind: 'error', text: message(err) }), []);

  const loadSessions = useCallback(async () => {
    const all = await checker.sessions.all();
    setSessions(all);
    return all;
  }, []);

  const openSession = useCallback(
    async (id: string) => {
      openId.current = id;
      setView({ kind: 'session', id });
      setSessionLoading(true);
      try {
        const loaded = await checker.sessions.get(id);
        if (openId.current !== id) return; // another session was opened meanwhile
        if (!loaded) {
          setSession(null);
          setView({ kind: 'new' });
          await loadSessions();
          return;
        }
        results.current = new Map(loaded.results.map((r) => [r.number, r]));
        setSession(loaded);
        setVersion((v) => v + 1);
      } catch (err) {
        fail(err);
      } finally {
        if (openId.current === id) setSessionLoading(false);
      }
    },
    [fail, loadSessions]
  );

  const boot = useCallback(async () => {
    const [appInfo, appSettings, list, all, running, current] = await Promise.all([
      checker.info(),
      checker.settings.get(),
      checker.countries(),
      checker.sessions.all(),
      checker.run.current(),
      checker.list.current(),
    ]);
    setInfo(appInfo);
    setSettings(appSettings);
    setCountries(list);
    setSessions(all);
    setRunningId(running);
    setDraft(current);
    setLive(null);
    setKeyCheck(null);
    setQuota({ remaining: null, limit: null });
    setSession(null);
    results.current = new Map();
    openId.current = null;
    const first = running ?? (current ? null : all[0]?.id ?? null);
    if (first) await openSession(first);
    else setView({ kind: 'new' });
    setReady(true);
  }, [openSession]);

  useEffect(() => {
    void boot().catch(fail);
  }, [boot, fail]);

  // ── What the main process tells us ───────────────────────────────────────
  useEffect(() => {
    const offProgress = checker.onProgress((p) => {
      setRunningId(p.sessionId);
      if (p.quota.remaining !== null) setQuota(p.quota);
      setSessions((list) => list.map((m) => (m.id === p.sessionId ? { ...m, status: 'running', counts: p.counts } : m)));
      if (openId.current !== p.sessionId) return;
      if (p.result) {
        results.current.set(p.result.number, p.result);
        setVersion((v) => v + 1);
      }
      setLive({ rate: p.rate, etaMs: p.etaMs, waiting: p.waiting, lastNumber: p.result?.number });
      setSession((s) =>
        s && s.meta.id === p.sessionId ? { ...s, meta: { ...s.meta, status: 'running', stopReason: undefined, counts: p.counts } } : s
      );
    });
    const offEnd = checker.onEnd((end) => {
      setRunningId(null);
      setLive(null);
      // The stored record knows more than the event (the channel, when it finished).
      void loadSessions().then((all) => {
        const fresh = all.find((m) => m.id === end.sessionId);
        if (fresh && openId.current === end.sessionId) {
          setSession((s) => (s && s.meta.id === end.sessionId ? { ...s, meta: fresh } : s));
        }
      });
      if (openId.current === end.sessionId) {
        setSession((s) =>
          s && s.meta.id === end.sessionId
            ? { ...s, meta: { ...s.meta, status: end.status, stopReason: end.stopReason, counts: end.counts } }
            : s
        );
      }
    });
    const offMode = checker.onMode(() => {
      setReady(false);
      void boot().catch(fail);
    });
    return () => {
      offProgress();
      offEnd();
      offMode();
    };
  }, [boot, fail, loadSessions]);

  // ── Preparing a list ─────────────────────────────────────────────────────
  const withBusy = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setNotice(null);
      try {
        return await work();
      } catch (err) {
        fail(err);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [fail]
  );

  const showNew = useCallback(() => {
    openId.current = null;
    setView({ kind: 'new' });
  }, []);

  const addFile = useCallback(
    (append: boolean) =>
      withBusy(async () => {
        const parsed = await checker.list.openFile(append);
        if (parsed) {
          setDraft(parsed);
          showNew();
        }
      }),
    [showNew, withBusy]
  );

  const addDrop = useCallback(
    (file: File, append: boolean) =>
      withBusy(async () => {
        setDraft(await checker.list.fromDrop(file, append));
        showNew();
      }),
    [showNew, withBusy]
  );

  const addText = useCallback(
    (text: string, append: boolean) =>
      withBusy(async () => {
        setDraft(await checker.list.fromText(text, append));
      }),
    [withBusy]
  );

  const addSample = useCallback(
    (count: number) =>
      withBusy(async () => {
        setDraft(await checker.list.sample(count));
      }),
    [withBusy]
  );

  const discardDraft = useCallback(async () => {
    await checker.list.clear();
    setDraft(null);
  }, []);

  const saveSettings = useCallback(
    async (patch: SettingsPatch) => {
      try {
        const next = await checker.settings.update(patch);
        setSettings(next);
        if ('apiKey' in patch || 'channel' in patch) setKeyCheck(null);
        // The default country decides how a list is read, so read it again.
        if ('defaultCountry' in patch) setDraft(await checker.list.current());
        return next;
      } catch (err) {
        fail(err);
        return null;
      }
    },
    [fail]
  );

  const checkKey = useCallback(async () => {
    setKeyCheck(null);
    try {
      const check = await checker.settings.checkKey();
      setKeyCheck(check);
      if (check.quota.remaining !== null) setQuota(check.quota);
      return check;
    } catch (err) {
      fail(err);
      return null;
    }
  }, [fail]);

  // ── Sessions and the run ─────────────────────────────────────────────────
  const start = useCallback(
    async (id: string) => {
      setNotice(null);
      const outcome = await checker.run.start(id).catch((err) => ({ ok: false as const, error: message(err) }));
      if (!outcome.ok) {
        setNotice({ kind: 'error', text: outcome.error });
        return false;
      }
      setRunningId(id);
      return true;
    },
    []
  );

  /** Turns the prepared list into a session, opens it and starts checking. */
  const startDraft = useCallback(
    (name: string) =>
      withBusy(async () => {
        const meta = await checker.sessions.create(name);
        setDraft(null);
        await loadSessions();
        await openSession(meta.id);
        await start(meta.id);
      }),
    [loadSessions, openSession, start, withBusy]
  );

  const stop = useCallback(async () => {
    await checker.run.stop().catch(fail);
  }, [fail]);

  const remove = useCallback(
    async (id: string) => {
      await checker.sessions.remove(id).catch(fail);
      const all = await loadSessions();
      if (openId.current === id) {
        setSession(null);
        if (all[0]) await openSession(all[0].id);
        else showNew();
      }
    },
    [fail, loadSessions, openSession, showNew]
  );

  const patchSession = useCallback(
    async (id: string, patch: { starred?: boolean; name?: string }) => {
      try {
        const meta = await checker.sessions.update(id, patch);
        setSessions((list) => list.map((m) => (m.id === id ? { ...m, starred: meta.starred, name: meta.name } : m)));
        setSession((s) => (s && s.meta.id === id ? { ...s, meta: { ...s.meta, starred: meta.starred, name: meta.name } } : s));
      } catch (err) {
        fail(err);
      }
    },
    [fail]
  );

  const clearAll = useCallback(async () => {
    const removed = await checker.sessions.clear().catch(() => -1);
    if (removed < 0) return;
    setSession(null);
    setSessions([]);
    showNew();
  }, [showNew]);

  const exportSession = useCallback(
    async (id: string, format: ExportFormat, scope: ExportScope) => {
      setNotice(null);
      try {
        const out = await checker.exportSession(id, format, scope);
        if (out.saved) setNotice({ kind: 'ok', text: `Saved ${out.rows?.toLocaleString('en-US')} rows.`, path: out.path });
        else if (out.error) setNotice({ kind: 'error', text: out.error });
      } catch (err) {
        fail(err);
      }
    },
    [fail]
  );

  /** Opens a website, email address or place from a profile; says why when it is refused. */
  const openLink = useCallback(async (kind: 'website' | 'email' | 'map', value: string) => {
    const out = await checker.openProfileLink(kind, value).catch((err) => ({ opened: false, reason: message(err) }));
    if (!out.opened && out.reason) setNotice({ kind: 'error', text: out.reason });
  }, []);

  /** Asks where to save one profile picture, then saves it. */
  const savePicture = useCallback(async (url: string, name: string) => {
    const out = await checker
      .savePicture(url, name)
      .catch((err) => ({ saved: false, path: undefined, error: message(err) }));
    if (out.saved) setNotice({ kind: 'ok', text: 'Picture saved.', path: out.path });
    else if (out.error) setNotice({ kind: 'error', text: out.error });
  }, []);

  const setDemo = useCallback(
    async (on: boolean) => {
      setNotice(null);
      await checker.setDemo(on).catch(fail);
    },
    [fail]
  );

  return useMemo(
    () => ({
      ready,
      info,
      settings,
      countries,
      sessions,
      view,
      session,
      sessionLoading,
      results: results.current,
      version,
      draft,
      busy,
      runningId,
      live,
      quota,
      notice,
      keyCheck,
      setNotice,
      showNew,
      showSettings: () => {
        openId.current = null;
        setView({ kind: 'settings' });
      },
      openSession,
      addFile,
      addDrop,
      addText,
      addSample,
      discardDraft,
      saveSettings,
      checkKey,
      start,
      startDraft,
      stop,
      remove,
      patchSession,
      clearAll,
      exportSession,
      openLink,
      savePicture,
      setDemo,
    }),
    [
      ready, info, settings, countries, sessions, view, session, sessionLoading, version, draft, busy, runningId, live, quota,
      notice, keyCheck, showNew, openSession, addFile, addDrop, addText, addSample, discardDraft, saveSettings, checkKey,
      start, startDraft, stop, remove, patchSession, clearAll, exportSession, openLink, savePicture, setDemo,
    ]
  );
}

export type Checker = ReturnType<typeof useChecker>;
