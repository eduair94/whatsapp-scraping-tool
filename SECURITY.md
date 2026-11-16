# Security

## Reporting a problem

Please do not open a public issue for a security problem. Report it privately
through GitHub: **Security → Report a vulnerability** on this repository. You
will get an answer within a few days.

Useful to include: the version (Settings → About), your system, what you did,
and what happened.

## What the app does with your data

- **The API key** is stored encrypted by the operating system (DPAPI on Windows,
  Keychain on macOS, GNOME Keyring or KWallet on Linux). Where no keyring is
  available, it is kept in memory only and asked for again next time. It is
  sent only to the API you chose, never to the window and never to a log.
- **Your lists and results** stay on your computer, in the app's data folder.
  Nothing is uploaded except the numbers you ask the API about.
- **Pictures** load from the API's picture server (`whatsapp-db.checkleaked.com`)
  as they come into view. **Settings → Profile pictures** turns this off.
- **No telemetry.** The app sends no usage data and has no account.

## How the app protects you

- The window is sandboxed, has no Node.js access, and runs under a strict
  content security policy: no remote scripts, no requests of its own, pictures
  from the picture server only.
- Links open in your browser only for the app's own pages, and for the business
  websites, email addresses and map places you click in a profile, which must be
  plain `https`, `http` or `mailto` addresses.
- Exports neutralise text that a spreadsheet would run as a formula.
- Packaged builds turn off Electron's `RunAsNode`, `NODE_OPTIONS` and inspector
  switches, and check the integrity of the app archive.
