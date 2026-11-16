Find out which numbers of a list are on WhatsApp, and what their profiles say: name, about, profile picture and the whole business profile. Open a CSV or Excel file (or paste the numbers), start the check, and export the answers to Excel, CSV or JSON.

**New in 2.0.1:** fixes from a review of the engine. A direct key with no requests left now stops the check with that reason instead of "check your connection"; two clicks on Start no longer start two checks; numbers exported as decimals or in scientific notation, date columns and two numbers in one cell are read correctly; continuing after a crash never loses the next answer. Details: [CHANGELOG.md](https://github.com/eduair94/whatsapp-scraping-tool/blob/master/CHANGELOG.md).

**Version 2 works again.** Version 1 stopped working on 4 November 2026, when the RapidAPI listing it used was removed. This release rewrites the engine and the window; your version 1 lists are carried over the first time it starts. What changed: [CHANGELOG.md](https://github.com/eduair94/whatsapp-scraping-tool/blob/master/CHANGELOG.md).

## Download

| System | File |
| --- | --- |
| Windows (installer) | `whatsapp-number-checker-windows-setup.exe` |
| Windows (portable, no install) | `whatsapp-number-checker-windows-portable.exe` |
| macOS, Apple silicon (M1 and later) | `whatsapp-number-checker-mac-arm64.dmg` |
| macOS, Intel | `whatsapp-number-checker-mac-x64.dmg` |
| Linux: Ubuntu, Debian, Mint… | `whatsapp-number-checker-linux-x64.deb` |
| Linux: any distribution | `whatsapp-number-checker-linux-x64.AppImage` |

You need an API key: a direct key from https://whatsapp.checkleaked.cc/api, or a RapidAPI key for the Number Validator or DB Only listing. To look around without a key, open **Help → Try the Demo**.

The builds are not code-signed yet:
- **Windows** may show "Windows protected your PC": click **More info → Run anyway**.
- **macOS 15 and later**: after the first try, open **System Settings → Privacy & Security** and click **Open Anyway**. On macOS 14 and earlier, right-click the app → **Open**, then **Open** again. If macOS says the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/WhatsApp Number Checker.app"` once.
- **Linux**: `sudo apt install ./whatsapp-number-checker-linux-x64.deb`, or `chmod +x` the AppImage and run it (it needs FUSE 2: `libfuse2t64` on Ubuntu 24.04).

Verify a download with `SHA256SUMS.txt`. Every file here was installed and started on its own system before this release was published.

**New to the app?** The [user guide](https://github.com/eduair94/whatsapp-scraping-tool/blob/master/docs/GUIDE.md) walks through installing, your key, checking a list, reading the results and exporting, with screenshots.

## What it does

- Reads CSV, Excel, text or pasted numbers, finds the phone column, removes duplicates, and shows how every line was read before a request is spent
- One mark per number: On WhatsApp, Not on WhatsApp, Not in database, Invalid number, Failed
- The whole profile: name, about, picture, and the business profile (category, description, email, websites, address and map, opening hours, member since, verification, linked accounts, catalog), plus what earlier checks saw
- Pictures in every row, at full size in a viewer, and all at once on a picture wall
- Stop and continue at any time; every answer is saved the moment it arrives
- Exports to Excel, CSV and JSON with every field
- Your key is stored encrypted by your system and sent only to the API; no telemetry

These are profiles of real people. Use it only where the law allows, and message only people who agreed to it. Anyone can hide their number at https://whatsapp.checkleaked.cc/opt-out. Not affiliated with WhatsApp or Meta.
