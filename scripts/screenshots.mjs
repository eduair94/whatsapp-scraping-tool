/**
 * Takes the pictures in docs/GUIDE.md and the README. Run `npm run screenshots`:
 * it opens the app in demo mode (sample numbers from the range kept for film
 * and television, simulated answers, drawn pictures, nothing goes online),
 * uses it like a person would, and saves each step to docs/images/.
 *
 * With WNC_REVIEW_DIR set it also saves the extra states a design review
 * needs: dark mode, the smallest window, hidden and earlier pictures.
 *
 * src/main.ts loads this file in development only; it is not packaged.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function capture({ win, dir, backend, progress, theme }) {
  await mkdir(dir, { recursive: true })
  const reviewDir = process.env.WNC_REVIEW_DIR ? path.resolve(process.env.WNC_REVIEW_DIR) : null
  if (reviewDir) await mkdir(reviewDir, { recursive: true })

  const wc = win.webContents
  const js = (code) => wc.executeJavaScript(code, true)
  const call = (fn, ...args) => js(`(${fn})(...${JSON.stringify(args)})`)

  async function until(test, what, timeoutMs = 120_000) {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (typeof test === 'function' ? await test() : await js(`Boolean(${test})`)) return
      await sleep(100)
    }
    throw new Error(`Timed out waiting for ${what}`)
  }

  /** Saves the window once every picture in view has loaded and the frame is fresh. */
  async function shot(name, { review = false } = {}) {
    const target = review ? reviewDir : dir
    if (!target) return
    await js(`Promise.all([...document.images]
      .filter((img) => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.width > 0 })
      .map((img) => img.decode().catch(() => undefined)))`)
    await sleep(400)
    wc.invalidate()
    await js('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const image = await wc.capturePage()
    await writeFile(path.join(target, name), image.toPNG())
    console.log(`saved ${review ? 'review/' : ''}${name} ${image.getSize().width}×${image.getSize().height}`)
  }

  /** Clicks the button whose text is exactly `label`. */
  const press = (label, scope = 'document') =>
    call(
      (label, scope) => {
        const root = scope === 'document' ? document : document.querySelector(scope)
        const button = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label && !b.disabled)
        if (!button) throw new Error(`no button "${label}"`)
        button.click()
      },
      label,
      scope,
    )
  /** Types into a React-controlled field the way a keyboard would. */
  const type = (selector, value) =>
    call(
      (selector, value) => {
        const el = document.querySelector(selector)
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      },
      selector,
      value,
    )
  const click = (selector) => call((s) => document.querySelector(s).click(), selector)
  /** Picks an option of a React-controlled select. */
  const choose = (selector, value) =>
    call(
      (selector, value) => {
        const el = document.querySelector(selector)
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, value)
        el.dispatchEvent(new Event('change', { bubbles: true }))
      },
      selector,
      value,
    )
  const key = (keyCode) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode })
    wc.sendInputEvent({ type: 'keyUp', keyCode })
  }
  const status = () => js(`document.querySelector('.status b')?.textContent ?? ''`)
  const checked = () => progress()?.counts.checked ?? 0

  const b = backend()
  await until(`document.querySelector('[data-ready][data-demo]')`, 'the demo')
  await js('document.fonts.ready.then(() => true)')
  // The guide shows the light look; the review adds the dark one.
  theme('light')
  // Sample lists run as fast as the computer allows; the pace is set per step below.
  await b.updateSettings({ gapMs: 0 })

  // ── Two earlier lists for the rail ─────────────────────────────────────
  async function earlierList(count, name, stopAfter) {
    b.listFromSample(count)
    const meta = await b.createSession(name)
    await b.startRun(meta.id)
    if (stopAfter) {
      await until(() => checked() >= stopAfter, `${name} to reach ${stopAfter}`)
      await b.stopRun()
    }
    await until(() => !b.runningSessionId, `${name} to finish`)
    return meta
  }
  const dealers = await earlierList(300, 'Dealers north')
  await b.updateSession(dealers.id, { starred: true })
  await earlierList(800, 'Trade fair contacts', 310)
  await b.clearList()
  await press('New check')
  await until(`document.getElementById('sample-count')`, 'the new check page')
  await choose('#country-new', 'US')
  await until(`document.getElementById('country-new').value === 'US'`, 'the country')
  // Saving a setting from the window applies the stored look again.
  theme('light')
  await sleep(300)

  // 1. A new check
  await shot('01-new-check.png')

  // 2. The list, read and ready
  await type('#sample-count', '2400')
  await press('Use sample numbers')
  await until(`document.getElementById('list-name')`, 'the review')
  await type('#list-name', 'Spring campaign leads')
  await shot('02-review.png')

  // 3. Checking: run the first stretch fast, then at the pace of a real key.
  await press('Start check')
  await until(() => checked() >= 960, 'the first stretch')
  await press('Stop')
  await until(async () => (await status()) === 'Stopped', 'the stop')
  await b.updateSettings({ gapMs: 600 })
  await press('Continue')
  await until(async () => (await status()) === 'Checking.' && (await js(`/left/.test(document.querySelector('.status').textContent)`)), 'a steady pace')
  await sleep(14_000)
  await shot('03-checking.png')
  await press('Stop')
  await until(async () => (await status()) === 'Stopped', 'the second stop')
  await b.updateSettings({ gapMs: 0 })
  await press('Continue')
  await until(async () => (await status()) === 'Complete.', 'the end of the check', 300_000)
  await b.updateSettings({ gapMs: 550 })
  await js(`document.querySelector('.vlist-viewport').scrollTop = 0`)

  // 4. The results
  await shot('04-results.png')

  // 5. The details of a business with a full profile, near the top of the list
  const spring = (await b.listSessions()).find((s) => s.name === 'Spring campaign leads')
  const session = await b.getSession(spring.id)
  const results = new Map(session.results.map((r) => [r.number, r]))
  const score = (r) =>
    r?.outcome !== 'on_whatsapp' ? -1 : (r.pictureUrl ? 4 : 0) + (r.business ? 3 : 0) + (r.hours ? 2 : 0) + (r.location ? 2 : 0) + (r.websites?.length ? 1 : 0) + (r.links?.length ? 1 : 0) + (r.verifiedLevel ? 1 : 0)
  const rich = session.numbers.reduce((best, n) => (score(results.get(n.e164)) > score(results.get(best.e164)) ? n : best), session.numbers[0])
  const richAt = session.numbers.indexOf(rich)
  /** Scrolls the table to the rich profile and opens its details. */
  const openRich = async () => {
    if (await js(`Boolean(document.querySelector('.detail'))`)) return
    await js(`document.querySelector('.vlist-viewport').scrollTop = ${Math.max(0, (richAt - 3) * 44)}`)
    await until(`document.querySelector('[data-number="${rich.e164}"] .rowbtn')`, 'the rich row')
    await click(`[data-number="${rich.e164}"] .rowbtn`)
    await until(`document.querySelector('.detail')`, 'the details')
  }
  await openRich()
  await shot('05-details.png')
  await js("document.querySelector('.detail').scrollTop = document.querySelector('#detail-business').offsetTop - 16")
  await shot('05-details-business.png')
  await js("document.querySelector('.detail').scrollTop = 0")

  // 6. The picture at full size
  await click('.detail-picture')
  await until(`document.querySelector('dialog.viewer[open]')`, 'the viewer')
  await shot('06-picture.png')
  key('Escape')
  await until(`!document.querySelector('dialog.viewer[open]')`, 'the viewer to close')

  // 7. Every picture of the list
  await press('Pictures')
  await until(`document.querySelector('.card')`, 'the picture wall')
  await shot('07-pictures.png')
  if (reviewDir) {
    theme('dark')
    await sleep(500)
    await shot('pictures-dark.png', { review: true })
    theme('light')
    await sleep(300)
  }
  await press('Table')
  await until(`document.querySelector('[data-row]')`, 'the table')

  // 8. Export
  await click('.detail-close')
  await until(`!document.querySelector('.detail')`, 'the details to close')
  await press('Export')
  await until(`document.querySelector('.popover')`, 'the export panel')
  await shot('08-export.png')
  key('Escape')

  // 9. Settings
  await press('Settings')
  await until(`document.querySelector('.settings')`, 'the settings')
  await shot('09-settings.png')

  if (!reviewDir) return

  // ── Review only ────────────────────────────────────────────────────────
  const open = async (name) => {
    await call((name) => [...document.querySelectorAll('.session')].find((s) => s.textContent.includes(name)).click(), name)
    await until(`document.querySelector('[data-row]')`, `the list ${name}`)
  }
  /** Finds a number anywhere in the list with the search box, and opens its details. */
  const detailOf = async (test) => {
    const found = session.numbers.find((n) => test(results.get(n.e164)))
    if (!found) return false
    await type('input[type=search]', found.e164.slice(1))
    await until(`document.querySelectorAll('[data-row]').length === 1`, 'the search')
    await click(`[data-number="${found.e164}"] .rowbtn`)
    await until(`document.querySelector('.detail')`, 'the details')
    return true
  }
  const clearSearch = () => type('input[type=search]', '')

  theme('dark')
  await sleep(500)
  await shot('settings-dark.png', { review: true })
  await js('document.querySelector(".settings").scrollTop = 99999')
  await sleep(200)
  await shot('settings-dark-end.png', { review: true })
  await open('Spring campaign leads')
  await shot('results-dark.png', { review: true })
  await openRich()
  await shot('details-dark.png', { review: true })
  await click('.detail-picture')
  await until(`document.querySelector('dialog.viewer[open]')`, 'the viewer')
  await shot('viewer-dark.png', { review: true })
  key('Escape')
  await until(`!document.querySelector('dialog.viewer[open]')`, 'the viewer to close')
  await press('New check')
  await until(`document.getElementById('sample-count')`, 'the new check page')
  await shot('new-check-dark.png', { review: true })
  theme('light')
  await sleep(300)

  await open('Spring campaign leads')
  if (await detailOf((r) => r?.outcome === 'on_whatsapp' && r.picture === 'hidden')) await shot('details-hidden-picture.png', { review: true })
  await clearSearch()
  if (await detailOf((r) => r?.outcome === 'on_whatsapp' && r.picture === 'none')) await shot('details-no-picture.png', { review: true })
  await clearSearch()
  if (await detailOf((r) => r?.outcome === 'not_on_whatsapp' && r.pictureHistory?.length && r.aboutHistory?.length))
    await shot('details-earlier.png', { review: true })
  await clearSearch()
  if (await detailOf((r) => r?.outcome === 'on_whatsapp' && r.pictureHistory?.length && r.aboutHistory?.length && r.aboutSetAt))
    await shot('details-personal-history.png', { review: true })
  await clearSearch()
  await open('Trade fair contacts')
  await shot('stopped-list.png', { review: true })

  // The smallest window the app allows.
  win.setSize(940, 620)
  await sleep(600)
  await open('Spring campaign leads')
  await shot('results-small.png', { review: true })
  await openRich()
  await shot('details-small.png', { review: true })
  await press('Pictures')
  await until(`document.querySelector('.card')`, 'the picture wall')
  await shot('pictures-small.png', { review: true })
  await press('Table')
  theme('dark')
  await sleep(500)
  await shot('results-small-dark.png', { review: true })
  await openRich()
  await click('.detail-picture')
  await until(`document.querySelector('dialog.viewer[open]')`, 'the viewer')
  await shot('viewer-small-dark.png', { review: true })
  key('Escape')
  theme('light')
}
