---
name: WhatsApp Number Checker
description: A desktop register for checking phone lists against the WhatsApp Data API; every number gets one drawn mark.
colors:
  ground: "#eef5f1"
  rail: "#e2ece6"
  panel: "#ffffff"
  wash: "#f3f8f5"
  rule: "#d5e0da"
  selected: "#e8f3ed"
  ink: "#16233b"
  ink-hover: "#283b60"
  soft: "#536070"
  pencil: "#7a8794"
  tick: "#1f8a5b"
  tick-text: "#176b46"
  bang: "#d64545"
  bang-text: "#b42f2f"
  margin: "#d64545"
  register-blue: "#3b5b92"
  link: "#2a4884"
  ground-dark: "#0f1826"
  rail-dark: "#0b1320"
  panel-dark: "#162235"
  wash-dark: "#1c2b42"
  rule-dark: "#27374e"
  selected-dark: "#1b3340"
  ink-dark: "#e6edf3"
  soft-dark: "#a3b3c5"
  pencil-dark: "#8193a8"
  cross-dark: "#8fa0b5"
  tick-dark: "#4cc38a"
  tick-text-dark: "#5fd19a"
  bang-dark: "#f07070"
  bang-text-dark: "#f58a8a"
  margin-dark: "#d86464"
  register-blue-dark: "#86a8e7"
  link-dark: "#9dbaf0"
  stage: "#0b1320"
typography:
  figure:
    fontFamily: "Figtree Variable, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: "2.25rem"
    letterSpacing: "-0.012em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Figtree Variable, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: "2rem"
    letterSpacing: "-0.012em"
    fontFeature: "tnum"
  title:
    fontFamily: "Figtree Variable, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 700
    lineHeight: "1.5rem"
    fontFeature: "tnum"
  lead:
    fontFamily: "Figtree Variable, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    fontFeature: "tnum"
  body:
    fontFamily: "Figtree Variable, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
    fontFeature: "tnum"
  small:
    fontFamily: "Figtree Variable, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
    lineHeight: "1.25rem"
    fontFeature: "tnum"
  label:
    fontFamily: "Figtree Variable, system-ui, Segoe UI, Roboto, Helvetica Neue, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
    fontFeature: "tnum"
rounded:
  hair: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
spacing:
  2xs: "0.25rem"
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  gutter: "2.75rem"
  strip: "3.5rem"
  rail: "15rem"
  detail: "20rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "0 1.125rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 1.125rem"
    height: "2.5rem"
  button-secondary-hover:
    backgroundColor: "{colors.wash}"
  button-stop:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.bang-text}"
    rounded: "{rounded.sm}"
    padding: "0 1.125rem"
    height: "2.5rem"
  button-small:
    rounded: "{rounded.sm}"
    padding: "0 0.75rem"
    height: "2rem"
  icon-button:
    textColor: "{colors.soft}"
    rounded: "{rounded.sm}"
    size: "2rem"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 0.75rem"
    height: "2.5rem"
  tab:
    textColor: "{colors.soft}"
    height: "2.5rem"
  tab-active:
    textColor: "{colors.ink}"
  rail-session:
    rounded: "{rounded.md}"
    padding: "0.6875rem 0.75rem 0.8125rem"
  rail-session-current:
    backgroundColor: "{colors.panel}"
  sheet:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
  sheet-row-hover:
    backgroundColor: "{colors.wash}"
  sheet-row-selected:
    backgroundColor: "{colors.selected}"
  tally:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "1.5rem 2rem 1.375rem"
  mark-strip:
    backgroundColor: "{colors.panel}"
    width: "{spacing.strip}"
  detail-panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
    padding: "1.125rem 1.25rem 1.5rem"
    width: "{spacing.detail}"
  picture:
    backgroundColor: "{colors.rule}"
    rounded: "{rounded.sm}"
    size: "6rem"
---

# Design System: WhatsApp Number Checker

## Overview

**Creative North Star: "The Register"**

A check is a roll call. Every number on a list gets exactly one mark, and the marks are the interface: in the row gutter, in the totals, in the miniature bar under each list in the rail, and in the mark strip that holds the whole list down the right edge. The window reads like a ruled register kept in ink on a pale tinted sheet: a quiet, dense working surface for people who start a long run, leave, and come back to see how it went before reading a single row.

The register is calm by construction. Ink and pencil grey carry almost everything; tick green and margin red are the only colours that speak loudly, and they speak about outcomes. Panels are white sheets on a green-grey ground in light, deep ink sheets on a near-black ground in dark. One thin red margin rule runs the height of every list, the way a ledger page has one. The drawn marks, the drawn icons and the demo monograms share one hand: a round-capped single stroke on a 16-unit grid.

It refuses the stat-card dashboard with coloured badges, outcome pills, and anything that looks like WhatsApp itself.

**Key Characteristics:**
- Six drawn marks (tick, cross, question, dash, bang, small empty ring) are the outcome signal, always paired with words.
- A 2.75rem mark gutter, then the red margin rule, then the columns, on every list including the paste box.
- One humanist sans (Figtree Variable) with tabular figures everywhere; no monospace.
- Flat sheets on a tinted ground; shadow only on things that float.
- Motion is one gesture: a mark is written in 140ms when its answer arrives. Nothing else moves.

## Colors

Ink on a pale register tint, with two signal colours reserved for outcomes and one register blue for focus and links. Every light token has a dark counterpart (the `-dark` keys), switched by `prefers-color-scheme`.

### Primary
- **Register Ink** (ink): text, primary buttons, the progress fill, the active tab underline, the strip bracket. In dark mode it inverts to pale ink (ink-dark), so the primary button becomes a pale button on a dark ground.
- **Tick Green** (tick): the "on WhatsApp" mark and its share of every mark bar and of the strip. Where green is read as text it steps down to tick-text for contrast.

### Secondary
- **Margin Red** (margin, bang): the margin rule down every list, the "failed" mark, stop and delete buttons, the error notice border. As text it steps to bang-text. In dark mode the margin rule (margin-dark) sits a step quieter than the failed mark (bang-dark).

### Tertiary
- **Register Blue** (register-blue): the focus ring and the "not in database" mark, which only the database-only channel produces. Links use the deeper link blue. It never fills a surface.

### Neutral
- **Register Tint** (ground): the window ground behind every sheet.
- **Rail Tint** (rail): the left rail, one step deeper than the ground.
- **Sheet White** (panel): every working surface: tables, the tally, the detail panel, the strip, popovers, inputs.
- **Wash** (wash): row hover and secondary-button hover.
- **Selected Wash** (selected): the selected row, a breath of tick green.
- **Ruling** (rule): every 1px border and row divider, the progress track, empty picture frames, skeletons.
- **Soft Ink** (soft): secondary text, column headers, status lines, placeholders, idle icon buttons.
- **Pencil** (pencil): the cross, dash and pending marks (dark: cross-dark for cross and dash), input borders, dashed "hidden" frames, the mark-bar hairline. Graphic use only; never body text.
- **Stage** (stage): the fixed dark stage behind a picture in the viewer, the same in both themes.

### Named Rules
**The Two Signals Rule.** Tick green and margin red are the only strong colours, and they speak about outcomes (plus red's one structural job, the margin rule). Everything secondary is pencil or soft ink.

**The Never Alone Rule.** No outcome is carried by colour alone. Every mark travels with its words: a label in the totals, the outcome column in the row, an accessible name on the mark.

## Typography

**Body Font:** Figtree Variable (bundled through @fontsource-variable/figtree; falls back to system-ui, Segoe UI, Roboto, Helvetica Neue)

**Character:** One humanist sans does every job; weight, not family, makes the hierarchy. Tabular figures are set on the body and inherited by every control, so counts, phone numbers and times align in columns.

### Hierarchy
- **Figure** (700, 1.5rem, 2.25rem line, -0.012em): the totals in the tally. Drops to 1.25rem in windows shorter than 44rem.
- **Headline** (700, 1.625rem, 2rem line, -0.012em): the list title and page titles. One per view.
- **Title** (700, 1.0625rem, 1.5rem line): the name in the detail panel and viewer, Settings section titles, the drop prompt.
- **Lead** (400, 0.9375rem, 1.5rem line): the status line under a headline, soft ink with the key state in bold ink. The app name in the rail uses this size at 700.
- **Body** (400, 0.875rem, 1.25rem line): everything else. Phone numbers, names and button labels are 600; outcome words and field labels 500. Running text caps at 68ch.
- **Small** (600, 0.8125rem): column headers, rail section titles, fact labels; notes and hints at 400.
- **Label** (600, 0.75rem, 1rem line): the strip's "List" label, the demo tag, empty-picture captions.

### Named Rules
**The One Family Rule.** One family, a fixed rem scale, weights 400, 500, 600 and 700 only. No monospace, not even for phone numbers; tabular figures do that job.

**The Sentence Case Rule.** Labels and headers are sentence case at normal tracking. Nothing is uppercase or letter-spaced; only headline and figure take the slight -0.012em tightening.

## Layout

A fixed desktop shell: the rail (15rem), the main area, and on a list view the mark strip (3.5rem) full height at the right edge. The main area pads 1.75rem top and 2rem sides (1.5rem sides below a 68rem window); text pages cap their content at 54rem.

A list view stacks: the head (title, status line, primary action top right), the tally sheet, filter tabs with the view switch and search, then the sheet filling the remaining height. The detail panel (20rem) sits beside the sheet; when the main area is narrower than 50rem it overlays the sheet from the right with the lift shadow.

The sheet narrows by container query, dropping columns least important first: the checked time below 58rem, about or category below 48rem, account type below 40rem, the outcome word below 28rem. The number and its owner never drop. Below a 54rem main area each total's label moves under its figure so the totals keep one aligned line. Windows shorter than 44rem tighten vertical padding and hide the progress line on a finished list.

Spacing is a rem rhythm of 0.25, 0.5, 0.75, 1, 1.5 and 2rem.

### Named Rules
**The Margin Rule.** Every list, including the box a list is pasted into, has a 2.75rem mark gutter followed by one 1px margin-red rule running its full height.

## Elevation & Depth

Flat by default. Sheets are white (or deep ink) panels separated from the tinted ground by tone and a 1px ruling border, never by shadow. One shadow, the lift, exists for things that float above the register: the export popover, the picture viewer, notices, the follow button, and the detail panel when it overlays the sheet. Its dark variant is deeper and pure black.

### Shadow Vocabulary
- **Lift** (`0 12px 28px -10px rgb(22 35 59 / 0.28), 0 3px 8px -3px rgb(22 35 59 / 0.14)`): floating layers only.

### Named Rules
**The Floating Only Rule.** If it does not sit above the register, it has no shadow.

## Shapes

Gently rounded rectangles throughout: controls and pictures at 6px, sheets and panels at 8px, the demo tag, skeletons and view-switch segments at 4px, the progress bar and strip bracket at 2px. Pictures are rounded squares, like photos pinned to a register, never circles. Borders are 1px ruling; a dashed border means "hidden" or "not here yet" (a privacy-hidden picture, the earlier-picture note, the drop target). Marks and icons are single round-capped strokes on a 16-unit grid: marks at 2px (the pending ring 1.4px), icons at 1.6px.

## Components

### Buttons
Plain, firm, ink-bordered.
- **Shape:** 6px corners, 2.5rem tall (2rem small), weight 600, 1px ink border.
- **Primary:** ink fill, sheet-white text. The one primary action per view (Start, Stop, Continue, Export) sits top right of the main area; New check is the rail's full-width primary.
- **Secondary:** sheet white with the ink border; hover to wash, press to ruling.
- **Stop / Danger:** margin-red border and bang-text on white; hover tints 9% red.
- **Quiet:** borderless, weight 500, hover to an 8% ink wash.
- **Icon button:** 2rem square, soft ink; hover to ink with an 8% ink wash.
- **Transitions:** background and border colour, 150ms ease-out. Disabled at 45% opacity. Focus is a 2px register-blue outline at 2px offset everywhere.

### Inputs / Fields
- **Style:** 2.5rem tall, 1px pencil border, 6px corners, sheet white, soft-ink placeholder.
- **Hover / Focus:** border to ink on hover; on focus the border turns register blue with the 2px outline at 0 offset.
- **Search:** the search icon sits inside at 0.75rem, text indented to 2.25rem.

### Navigation
- **Rail:** rail tint, app name, New check, then sessions grouped as Starred and Lists. Each session is a block with its name (600), a soft status line, and a 6px mark bar showing each outcome's share inside a pencil hairline. The current session is a sheet-white block with a ruling border. Settings, the key and the quota sit at the foot.
- **Filter tabs:** text tabs in soft ink, 600; the active tab is ink with a 2px ink underline.
- **View switch:** a segmented pair inside a ruled frame; the pressed segment fills with ink.

### The Sheet
The table of a list. Sheet white, 8px corners, ruling border; a sticky header in small soft type; rows divided by ruling, hover to wash, selected to selected wash. Column one is the 2.75rem mark gutter holding the row's mark, centred; the margin rule follows. The phone number is the row's button and its focus ring wraps the whole row. Row pictures are small rounded squares beside the name.

### The Tally
A sheet holding the totals: each figure led by its mark and followed by its word, then a 4px progress line (ink fill on a ruling track) with "n of N checked".

### The Mark Strip (signature)
The whole list as one column of marks at the right edge. A short list draws one 3px tick per number on a 5px pitch; a long one blends each pixel row by outcome share; an invalid number is half a tick, a pending one an empty box. A 2px ink bracket over a pencil wash holds the rows currently in the table and follows scrolling. Clicking or dragging the strip jumps the table there; arrow, page, Home and End keys move it.

### Pictures
- **With a picture:** a rounded square, cover-cropped, on a ruling tint. In the detail panel it is 6rem and opens the viewer on press.
- **Hidden by privacy:** a dashed pencil frame with the eye-off icon.
- **No picture or not loading:** a ruling frame with the picture-off icon.
- **Demo pictures:** drawn in six muted tone sets (sage, slate blue, sand, mauve, grey, ochre), each a ground, a mid and a deep tone; businesses get single-stroke monograms in the deep tone, drawn in the marks' hand with no font. Never a person, never a grey silhouette.

### Detail Panel and Viewer
The detail panel is a 20rem sheet: picture and name, the outcome with its mark, the number, then fact sections divided by ruling with small soft labels. The viewer is a dialog with the picture on the fixed dark stage and the owner's details in a 19rem side column (16rem below a 60rem window), over a 72% stage backdrop.

## Do's and Don'ts

### Do:
- **Do** give every number exactly one of the six drawn marks, and pair it with its words.
- **Do** run the 2.75rem gutter and the 1px margin-red rule down every list.
- **Do** keep tick green and margin red for outcomes; use pencil and soft ink for everything secondary.
- **Do** set figures in Figtree with tabular numerals, and show every time on the 24-hour clock.
- **Do** write a new mark with its 140ms stroke draw (cubic-bezier(0.16, 1, 0.3, 1)) when its answer arrives; beyond that, only 150ms colour transitions on hover.
- **Do** draw any new icon on the 16-unit grid with a 1.6px round-capped stroke.
- **Do** make pictures rounded squares, and say why a picture is missing with a drawn frame.

### Don't:
- **Don't** use pills, coloured badges or stat cards to show outcomes.
- **Don't** use circular avatars or anything that reads as the WhatsApp interface or logo.
- **Don't** use a monospace face, uppercase labels or letter-spaced captions.
- **Don't** put a drop shadow on anything that does not float (inset hairlines and the 2px ink hover ring on gallery pictures are borders, not elevation).
- **Don't** animate counts, rows or panels; only marks are written.
- **Don't** show the API's automated guesses about the people in a picture.
