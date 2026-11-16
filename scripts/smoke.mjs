// Launch the app once and check that its window came up and works: it switches
// to demo mode in place, checks twelve sample numbers through the window like a
// person would, and exports them.
//   node scripts/smoke.mjs "<path to the app executable>" [--sandbox] [--appimage-extract-and-run]
//   node scripts/smoke.mjs --dev      the development build (electron .)
//   node scripts/smoke.mjs --unpacked the app electron-builder left in release/
// On Linux it runs under xvfb-run, with Chromium's sandbox off unless --sandbox
// is given (an installed .deb must start with it on). Exits non-zero, with the
// reason, on any failure.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

/** The executable electron-builder left in release/ for this system. */
function unpackedApp() {
  const root = path.resolve('release')
  if (process.platform === 'win32') {
    const dir = path.join(root, 'win-unpacked')
    const exe = readdirSync(dir).find((name) => name.endsWith('.exe') && !/^uninstall/i.test(name))
    return exe ? path.join(dir, exe) : ''
  }
  if (process.platform === 'darwin') {
    const dir = path.join(root, process.arch === 'arm64' ? 'mac-arm64' : 'mac')
    const bundle = readdirSync(dir).find((name) => name.endsWith('.app'))
    if (!bundle) return ''
    const plist = readFileSync(path.join(dir, bundle, 'Contents', 'Info.plist'), 'utf8')
    const name = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/)?.[1]
    return name ? path.join(dir, bundle, 'Contents', 'MacOS', name) : ''
  }
  return path.join(root, 'linux-unpacked', 'whatsapp-number-checker')
}

const dev = process.argv.includes('--dev')
let exe = ''
let appArgs = []
if (process.argv.includes('--unpacked')) {
  exe = unpackedApp()
} else if (dev) {
  // In plain Node, the electron package exports the path of its binary.
  exe = (await import('electron')).default
  appArgs = ['.']
} else {
  exe = process.argv[2] ? path.resolve(process.argv[2]) : ''
}
if (!exe || !existsSync(exe)) {
  console.error(`smoke: app not found: ${exe || process.argv[2]}`)
  process.exit(1)
}
const out = path.resolve('smoke.json')
rmSync(out, { force: true })

const linux = process.platform === 'linux'
const sandbox = process.argv.includes('--sandbox')
// An AppImage only reads its own options as the first argument.
const extract = process.argv.includes('--appimage-extract-and-run') ? ['--appimage-extract-and-run'] : []
const args = [...extract, ...appArgs, ...(linux && !sandbox ? ['--no-sandbox'] : []), `--smoke=${out}`]
const [cmd, cmdArgs] = linux
  ? ['xvfb-run', ['--auto-servernum', '--server-args=-screen 0 1920x1080x24', exe, ...args]]
  : [exe, args]

// The shell may carry ELECTRON_RUN_AS_NODE from other tools; the app must start as an app.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(cmd, cmdArgs, { stdio: 'inherit', env }) // NOSONAR: launches the app the caller names, by design
const timer = setTimeout(() => {
  console.error('smoke: no answer within 180 s')
  child.kill('SIGKILL')
}, 180_000)

child.on('error', (err) => {
  clearTimeout(timer)
  console.error(`smoke: could not start the app: ${err.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  clearTimeout(timer)
  if (!existsSync(out)) {
    console.error(`smoke: the app exited (code ${code}, signal ${signal}) without writing ${out}`)
    process.exit(1)
  }
  const result = JSON.parse(readFileSync(out, 'utf8'))
  console.log('smoke:', JSON.stringify(result))
  if (result.error) {
    console.error(`smoke: the app reported an error: ${result.error}`)
    process.exit(1)
  }
  const ok =
    result.ready === true &&
    result.bridge === 'object' &&
    result.title === 'WhatsApp Number Checker' &&
    result.windowTitle === 'WhatsApp Number Checker' &&
    typeof result.keyStorage === 'boolean' &&
    // The key is only stored where the system really protects it.
    result.canStoreKey === result.keyStorage
  if (!ok) {
    console.error('smoke: the window did not show the app as expected')
    process.exit(1)
  }
  // Help → Try the Demo, switched in place: twelve sample numbers checked and exported.
  const d = result.demo
  const demoOk =
    result.demoTitle === 'WhatsApp Number Checker (demo)' &&
    d?.rows === 12 &&
    d.marked === 12 &&
    d.strip === true &&
    d.font === true &&
    d.status === 'completed' &&
    d.checked === 12 &&
    d.exportedRows === 12 &&
    d.exportBytes === true &&
    d.key === true
  if (!demoOk) {
    console.error('smoke: demo mode did not work as expected')
    process.exit(1)
  }
  console.log('smoke: ok')
})
