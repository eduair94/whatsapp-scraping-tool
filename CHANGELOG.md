# Changelog

## 2.0.0 (2026-11-16)

Version 1 stopped working on 4 November 2026: the RapidAPI listing it was built
on (`whatsapp-data1`) was removed, and every check failed with "API doesn't
exist". Version 2 rewrites the engine and the window. Your lists from version 1
are carried over the first time 2.0 starts.

### Works again, with three kinds of key

- A **direct key** from [whatsapp.checkleaked.cc/api](https://whatsapp.checkleaked.cc/api):
  a live check with the full profile. The app shows its remaining requests and
  expiry date.
- **RapidAPI: Number Validator**: a live check, on WhatsApp or not.
- **RapidAPI: DB Only**: profiles from the database, without a live check.

The app recognises a direct key by its shape. Settings chooses where a RapidAPI
key goes.

### New

- **Every field the API returns about a profile**: name, about and when it was
  set, profile picture (or whether it is hidden by privacy settings), personal
  or business account, WhatsApp Business app or Business Platform, verification
  level, category, description, email, every website, address, location with a
  map link, opening hours, member since, linked Instagram or Facebook, product
  catalog, and the about texts and pictures earlier checks saw. The kind of line
  (mobile, fixed line, VoIP…) is worked out on your computer for every number.
- **Pictures**: a thumbnail on every row, a larger one in the details, a
  full-size viewer that steps through the list with the arrow keys, a picture
  wall of every profile at once, and **Save picture…**. Settings can turn
  pictures off, and then none are loaded.
- **The mark strip**: the whole list as one column of marks next to the table.
  Click or drag it to jump anywhere; the bracket shows the rows in view.
- **Five outcomes, never merged**: On WhatsApp, Not on WhatsApp, Not in
  database, Invalid number, Failed.
- **Review before spending**: see how each line was read, which country, what
  could not be read and why, and how many requests and minutes the check takes.
- **One country for national numbers**, chosen by you, instead of a guess.
- **Exports** to Excel, CSV and JSON, all numbers or one outcome, with every
  field in its own column.
- **Demo mode** (Help → Try the Demo): sample numbers from the range kept for
  film and television, simulated answers, nothing sent anywhere.
- **Light and dark**, following the system or your choice.
- Installers for Windows (and a portable app), macOS (Apple silicon and Intel)
  and Linux (.deb and AppImage), each one installed and started on its system
  before a release is published.

### Fixed

- **Cancel did not stop.** The old engine kept checking, and spending requests,
  after Cancel; its late answers could overwrite the next session. Stop now
  aborts the request in flight and nothing is asked after it.
- **Lost results.** Starring or pausing a session saved a summary over its
  results; opening a session from History could crash; resuming re-checked only
  some numbers and replaced the earlier answers. Every answer is now appended to
  disk as it arrives and never rewritten, and **Continue** asks only what has no
  answer yet, failed numbers included.
- **The API key was stored in plain text** in every session file. It is now kept
  only in the settings, encrypted by the operating system (DPAPI, Keychain or a
  Linux keyring); without a keyring it is kept in memory only. Starting 2.0
  removes the key from the old files.
- **National numbers were read against ten countries in a fixed order**, so some
  were filed under the wrong country.
- **Exports**: text from a profile could run as a spreadsheet formula, and
  accents and emoji broke in Excel. Formula-like text is now neutralised, and
  the CSV carries a byte-order mark.
- **The window froze during checks** (the old dependency waited in a busy loop).
- A wrong key could be reported as working: the key check now says exactly
  whether the API accepted it.
- Settings that did nothing (theme, concurrent requests, auto-export, default
  export format) were removed or now work. The "Export Results" menu item works.
- The app no longer uses the WhatsApp logo, and says it is not affiliated with
  WhatsApp or Meta.

### Under the hood

- Electron 45, React 18, TypeScript; the engine has no Electron in it and is
  covered by 134 tests.
- The window is sandboxed with a strict content security policy; it can load
  pictures only from the API's picture server and open only the app's own links,
  plus the business websites, emails and map places you click.
- SheetJS 0.20.3 from the SheetJS CDN (the npm release has known
  vulnerabilities); production dependencies audit clean.

## 1.x

The original app, built on the `whatsapp-data1` RapidAPI listing.
