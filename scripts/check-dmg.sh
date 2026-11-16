#!/usr/bin/env bash
# Install a macOS disk image the way the user guide says (copy the app to
# /Applications), check its signature and architecture, and launch it once.
#   scripts/check-dmg.sh <file.dmg> <arm64|x86_64>
set -euo pipefail
dmg="$1"
want="$2"
mnt="$(mktemp -d)"
hdiutil attach -nobrowse -mountpoint "$mnt" "$dmg" > /dev/null
bundle="$(cd "$mnt" && ls -d *.app | head -n 1)"
app="/Applications/$bundle"
rm -rf "$app"
cp -R "$mnt/$bundle" /Applications/
hdiutil detach "$mnt" > /dev/null
codesign --verify --deep --strict "$app"
bin="$app/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")"
archs="$(lipo -archs "$bin")"
echo "$dmg: $bundle, $archs"
[ "$bundle" = "WhatsApp Number Checker.app" ] || { echo "expected WhatsApp Number Checker.app"; exit 1; }
[ "$archs" = "$want" ] || { echo "expected $want"; exit 1; }
node scripts/smoke.mjs "$bin"
