# Changelog

## 2.0.1 (2026-11-16)

Fixes from a review of the engine. Nothing changes in how you use the app;
your lists and settings stay as they are.

### A check that stops for the right reason

- **A direct key with no requests left** was treated as "slow down": the app
  kept retrying, marked numbers as failed and finally blamed your connection.
  It now stops at once and says the key has no requests left.
- **Clicking Start or Continue twice** could start two checks of the same list.
  Each number was asked twice, and Stop reached only one of them.

### Reading your list

- **Numbers a data tool exported as decimals** (`436641234567.0`) were read as a
  different number, or all rejected. They are read as the whole number.
- **Numbers a spreadsheet wrote in scientific notation** (`9.19877E+11`) were
  read as a different, valid-looking number. They are now shown as invalid,
  with the way to fix the file: the notation has already dropped digits.
- **A column of dates** (`2026-11-15`, `15.11.2026`) could be taken for a phone
  column in some countries, and each date cost a request.
- **Two numbers in one cell** (`099 123 451 - 098 297 150`) were dropped without
  a word. Both are read. A cell of the phone column that cannot be read at all
  is listed as invalid instead of vanishing.
- **Changing the default country** after opening a file now looks for the phone
  columns again, so a column of numbers without a country code is found.
- **Text files in UTF-16**, which Excel saves as "Unicode Text", read as empty.

### Your answers and your key

- **Continuing after a crash** could lose the first new answer: it was written
  onto the half line the crash left behind.
- **A results file that could not be read** (locked by another program) passed
  for an empty one, so Continue would have asked the whole list again. The app
  now says it could not read the file.
- **A star or a rename during a check** could be undone by the check saving its
  totals at the same moment, or stop the check with a file error.
- **A list whose check finished just as the app closed** came back as "Stopped
  at N of N" with no way to finish it. It now comes back as completed.
- **One refusal from the system keychain** made the app forget the stored key
  the next time any setting changed. The stored key is now kept until you save
  or forget a key yourself.

### The window and the exports

- **Opening a list while it is being checked** could leave one row showing
  "Pending" although its answer had arrived.
- **Search** finds a number typed the way your list has it (`099123456`), not
  only with its country code.
- **Exports** keep a number written with its `+` exactly as your list has it;
  it used to get an apostrophe in front. A failed Excel export no longer leaves
  a temporary file beside the target.

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
