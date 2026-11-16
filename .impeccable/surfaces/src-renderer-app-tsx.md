---
version: 1
slug: "src-renderer-app-tsx"
primary_target: "src/renderer/App.tsx"
related_targets: ["src/renderer/styles.css"]
---

# Surface brief: the app window

**Scope:** the whole Electron window (`src/renderer`): add numbers, review, check, results, sessions, settings.
**Visitor mode:** Operate.

**Audience and job:** marketing and sales staff cleaning a contact list (primary), OSINT and fraud analysts, developers trying the API. They load a list, start a check that can run for an hour or more, come back to it, read who is on WhatsApp and export.
**Task states that matter:** no key yet; list loaded with invalid entries; run in progress; run stopped (by the user, by quota, by a rejected key); run complete; a past session reopened; demo mode.
**Content:** the user's numbers, five outcomes (On WhatsApp, Not on WhatsApp, Not in database, Invalid number, Failed) plus Pending, profile fields when the channel returns them, quota left.
**Constraints:** follows the system light or dark setting (owner: "both about equally"); standard controls only; nothing may look like a generic SaaS template, a hacking tool, a toy, or a dense technical console (owner, 2026-11-15). No WhatsApp logo.

**Chosen direction:** The Register, chosen by the owner on the decision page on 2026-11-15 (it was the model's own top-ranked grounded direction; the roll had assigned Returns Night).
**Memorable moment:** the mark strip: a full-height column in which every number of the list is one mark, so ten thousand answers read at a glance and any stretch of the list is one click away.

**Unresolved:** none.

## Direction contract

THESIS: A check is a roll call. Every number gets exactly one mark, and the marks are the interface: in the row, in the totals, and in a strip that holds the whole list. It refuses the stat-card dashboard with coloured badges.

OWN-WORLD: Ink on a pale register tint; panels white in light, deep ink in dark. Tick green and margin red are the only strong colours; pencil grey carries everything secondary. Marks are drawn glyphs (tick, cross, open ring, dash, bang, empty ring), never pills. One thin red margin rule runs the height of every list. A humanist sans with tabular figures; no monospace.

STORY: The visitor sees their list as a register, starts the call, leaves, and returns to a column of marks that tells them how it went before they read a single row; then filters, opens a profile, exports.

FIRST VIEWPORT: Left rail (240px): app name, New check, sessions with a miniature mark bar each, key and quota at the foot. Main: session title and status line, the five totals each led by its mark, a thin progress line, filter tabs and search, then the table with a 44px mark gutter and the red margin rule. Right: the 56px mark strip, full height, with a bracket over the rows in view. Primary action (Start, Stop, Continue) top right of the main area.

FORM: The Register, position 1 on the ordered list of seven; seed:ecfe9c742e3d55f9. Signature interaction: the mark strip scrubs the table (click or drag to jump; the bracket follows scrolling). Motion grammar: a mark is written once, in 140ms, when its answer arrives; nothing else moves.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
