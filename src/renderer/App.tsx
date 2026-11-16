import { DragEvent, useEffect, useRef, useState } from 'react';
import { checker } from './bridge';
import { Icon, Mark } from './components/Marks';
import { NewCheck } from './components/NewCheck';
import { Rail } from './components/Rail';
import { SessionView } from './components/SessionView';
import { Settings } from './components/Settings';
import { useChecker } from './useChecker';

export function App() {
  const app = useChecker();
  const [dragging, setDragging] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const dragDepth = useRef(0);

  // Menu bar commands (File → New Check, Open a List…, Export Results…, Settings…).
  const { addFile, showNew, showSettings, view, session, notice, setNotice } = app;
  useEffect(
    () =>
      checker.onMenu((command) => {
        if (command === 'new') showNew();
        else if (command === 'open') void addFile(false);
        else if (command === 'settings') showSettings();
        else if (command === 'export') {
          if (view.kind === 'session' && session) setExportOpen(true);
          else setNotice({ kind: 'error', text: 'Open a list first, then export its results.' });
        }
      }),
    [addFile, showNew, showSettings, view, session, setNotice]
  );

  // Good news leaves by itself; a problem stays until it is read.
  useEffect(() => {
    if (notice?.kind !== 'ok') return;
    const timer = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  // A file dropped anywhere on the window starts a new list (or adds to the one being prepared).
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const onDragEnter = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void app.addDrop(file, app.view.kind === 'new' && Boolean(app.draft));
  };

  if (!app.ready || !app.info || !app.settings) {
    return (
      <div className="boot" role="status">
        Opening…
      </div>
    );
  }

  return (
    <div
      className="app"
      data-ready
      data-demo={app.info.demo ? '' : undefined}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(event) => hasFiles(event) && event.preventDefault()}
      onDrop={onDrop}
    >
      <Rail app={app} />

      <main className="main" id="main">
        {app.view.kind === 'new' && <NewCheck app={app} />}
        {app.view.kind === 'session' && <SessionView app={app} exportOpen={exportOpen} onExportOpen={setExportOpen} />}
        {app.view.kind === 'settings' && <Settings app={app} />}
      </main>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <Mark kind={notice.kind === 'error' ? 'failed' : 'on_whatsapp'} />
          <span className="notice-text">{notice.text}</span>
          {notice.path && (
            <button type="button" className="link" onClick={() => void checker.reveal(notice.path!)}>
              Show in folder
            </button>
          )}
          <button type="button" className="iconbtn" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {dragging && (
        <div className="dropveil" aria-hidden="true">
          <div className="dropveil-card">
            <Icon name="file" size={28} />
            <strong>Drop the file to read its numbers</strong>
            <span>CSV, Excel or text</span>
          </div>
        </div>
      )}
    </div>
  );
}
