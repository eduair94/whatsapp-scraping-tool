# Contributing

Thanks for helping. Bug reports, fixes and ideas are all welcome; open an
[issue](https://github.com/eduair94/whatsapp-scraping-tool/issues) first for
anything larger than a small fix, so we can agree on the approach.

## Set up

You need Node.js 22 or later and Git.

```
git clone https://github.com/eduair94/whatsapp-scraping-tool.git
cd whatsapp-scraping-tool
npm install
npm run demo        # build and open the app in demo mode (no key needed)
```

| Command | What it does |
| --- | --- |
| `npm start` | Build and open the app with your own key. |
| `npm run demo` | Build and open the app in demo mode. |
| `npm test` | Run the engine's tests (Vitest). |
| `npm run typecheck` | Type-check the main process and the window. |
| `npm run lint` | ESLint, including accessibility rules for the window. |
| `npm run smoke` | Build, open the real window, run a demo check through it, export it, and write what it saw to `smoke.json`. |
| `npm run screenshots` | Retake the pictures in `docs/images/` from demo mode. |
| `npm run icons` | Render `build/icon.svg` to `build/icon.png`. |
| `npm run dist` | Build the installers for your system into `release/`. |

## How the code is organised

```
src/
  shared/      Plain TypeScript used on both sides: types, channels, the words
               for outcomes and profile facts. No Electron, Node or React here.
  core/        The engine, with no Electron in it, so all of it is tested:
    phone.ts        reading numbers out of text, files and cells
    inputFiles.ts   CSV, Excel and text files, finding the phone column
    apiClient.ts    one paced, abortable request per number, with retries
    classify.ts     one API answer → one outcome and its profile, or an error
    checker.ts      one run over a session: append each answer, stop cleanly
    sessionStore.ts sessions on disk: meta.json, numbers.json, results.jsonl
    exporter.ts     CSV, Excel and JSON exports
    settingsStore.ts settings, with the key encrypted by the system
    legacy.ts       moves version 1 sessions over and removes their keys
    demo.ts         the simulated API and sample numbers of demo mode
    backend.ts      everything the window can ask for, in one object
  main.ts      Electron: the window, the menu, dialogs, and the bridge
  preload.ts   The only door between the window and the rest of the app
  renderer/    The window (React): App.tsx, components/, styles.css
```

The window never sees the API key, never touches the disk and never makes a
request: it asks the main process through `window.checker` (see `preload.ts`).

## Rules of the house

- **Tests for behaviour.** A change to `src/core` comes with a test that fails
  without it. `npm test`, `npm run typecheck` and `npm run lint` must pass.
- **Never lose an answer, never spend a request the person did not ask for.**
  Anything that touches the run, the session files or the client keeps those two
  promises.
- **The key is a secret.** It is never logged, never written outside the
  encrypted settings, never sent anywhere but the API.
- **Plain words on screen.** Buttons say what they do; errors say what went
  wrong and what to do next. The words for outcomes and profile facts live in
  `src/shared` so the window and the exports always agree.
- **The design** is described in [DESIGN.md](DESIGN.md) (the register: drawn
  marks, ink on a pale tint, one red margin rule). Keep to it; no badges or pills
  for outcomes, no icons from fonts or emoji.
- **Demo mode stays fictional.** Sample numbers come only from the 555-0100 to
  555-0199 range; demo pictures are drawings that never show a person.

## Sending a change

1. Fork the repository and create a branch.
2. Make the change, with tests.
3. Run `npm test && npm run typecheck && npm run lint`, and `npm run smoke` if
   you touched the window or the main process.
4. Open a pull request that says what changed and why.

## Releases

Pushing a tag such as `v2.0.1` builds every system, installs and starts each
file, and uploads them to a draft release with checksums. The draft is
published by hand.
