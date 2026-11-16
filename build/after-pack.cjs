// macOS on Apple Silicon refuses to run an app without a valid signature, and
// packaging invalidates the one Electron ships with. Without a Developer ID
// (CSC_LINK / CSC_NAME), sign the app ad hoc so the downloaded build opens
// (after the usual right-click → Open for an unidentified developer).
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}
