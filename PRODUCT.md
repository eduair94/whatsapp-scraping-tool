# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(An Electron desktop app for Windows, macOS and Linux. The interface is web technology inside a desktop window, with a native menu bar, native file dialogs and OS-level key encryption.)

## Users

Confirmed by the owner on 2026-11-15, in this order:

1. **Marketing and sales teams** cleaning their own contact lists before a campaign. They arrive with a spreadsheet or a pasted column of numbers, often in national format, and want to know which numbers are on WhatsApp and which are business accounts. They are not developers.
2. **OSINT and fraud analysts** checking numbers that are part of an investigation. They care about each number's profile details and about an exportable record of what was checked and when.
3. **Developers** evaluating the WhatsApp Data API, who use the app as a working reference client.

## Product Purpose

Check a list of phone numbers against the WhatsApp Data API (checkleaked.cc) and report, per number, whether it is registered on WhatsApp, with the profile and business details the user's API channel provides. Success: a non-technical person installs it, loads a list, gets a trustworthy answer for every number, and exports it, without losing work if they stop, close the app or run out of quota.

## Positioning

An open-source (MIT) desktop client for the API. The list, the results and the API key stay on the user's computer; the only network traffic is the lookups themselves, sent to the API host the user's key belongs to.

## Operating Context

- Input: CSV, Excel (.xlsx, .xls) or text files, drag and drop, or pasted text. Lists range from a handful to tens of thousands of numbers.
- A run is long: the API accepts about two requests per second per key, so 10,000 numbers take roughly an hour and a half. People start a run and come back to it.
- Output: CSV, Excel or JSON, opened in Excel, Google Sheets or imported into a CRM.
- Every run is kept as a session that can be reopened, continued and exported later.

## Capabilities and Constraints

- **Three API channels** (owner decision 2026-11-15: accept all three). They return different depths of data, and the interface must say which one is in use:
  - *Direct key* (`wapi_…` / `wa_…`, from whatsapp.checkleaked.cc/api, host `whatsapp-proxy.checkleaked.cc`): live lookup with the full profile (name, about, picture, business details).
  - *RapidAPI, Number Validator* (`whatsapp-number-validator18.p.rapidapi.com`): registered yes/no only. No profile data; the API masks the number in its answer.
  - *RapidAPI, DB Only* (`wp-data-db-only.p.rapidapi.com`): profiles from the database cache, no live check. A number can be "not in the database", which is not the same as "not on WhatsApp".
- The RapidAPI "WP Data" listing the app was built on (`whatsapp-data1.p.rapidapi.com`) was removed on 2026-11-04. Keys that only had that subscription no longer work anywhere.
- Lookups are sequential and paced (the API refuses requests closer together than 0.5 s).
- **Sample numbers exist only in demo mode** (owner decision 2026-11-15). Demo mode uses a simulated API and numbers from ranges reserved for fiction; nothing is sent over the network. Real checks require the user's own list.
- No ethnicity, age or other profiling filters. The app answers "is this number on WhatsApp, and what does its public profile say".
- Terminology: a *session* is one list plus its results. *On WhatsApp* / *Not on WhatsApp* / *Not in database* / *Invalid number* / *Failed* are the five outcomes; *Pending* means not checked yet.

## Brand Commitments

- App name: **WhatsApp Number Checker** (unchanged; owner decision).
- An original app icon. The WhatsApp logo is not used anywhere (owner decision 2026-11-15), and the app states that it is not affiliated with WhatsApp or Meta.
- Repository: `eduair94/whatsapp-scraping-tool` (renamed from `whatsapp-scrapping-tool` on 2026-11-15; the old URL redirects).
- Voice: plain, direct, says what happened and what to do next. No hype.

## Evidence on Hand

- 18 GitHub stars and 8 forks at the time of writing; no releases, no screenshots, no testimonials. None may be invented.
- Live API behaviour measured on 2026-11-15 on the direct channel: a number not on WhatsApp answers HTTP 200 with `exists: false` and `code: "NUMBER_NOT_FOUND"`; an invalid number answers 400; the cache endpoint answers 404 `NOT_IN_DATABASE` for a miss.
- The RapidAPI channels could not be exercised live while writing this (no RapidAPI key on hand); their behaviour is taken from the API's own source and tests.

## Product Principles

1. **Never lose work.** Every result is on disk the moment it arrives; stopping, closing or crashing costs nothing.
2. **Never spend what the user did not ask for.** Stop means stop; a failed request is not silently retried forever; the quota left is always visible.
3. **Say exactly what is known.** "Not on WhatsApp", "not in the database" and "the request failed" are different answers and are never merged.
4. **The key is a secret.** Encrypted by the operating system, never written into sessions or exports, never shown back.
5. **A non-developer can finish the job.** No terminal, no configuration file, no jargon in the main path.

## Accessibility & Inclusion

Keyboard-operable throughout, visible focus, WCAG AA contrast, no information carried by colour alone (each outcome has a label as well as a colour), respects reduced-motion.
