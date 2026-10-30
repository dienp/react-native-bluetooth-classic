#!/usr/bin/env bash
# Runs `expo prebuild` twice on scripts/ci/expo-fixture with the packed
# library, and checks the generated manifest and Info.plist each time: the
# plugin's entries must be there, and a second run must change nothing.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
cp -R "$root/scripts/ci/expo-fixture/." "$work/"

(cd "$root" && npm pack --silent --pack-destination "$work" >/dev/null)
cd "$work"
npm install --no-audit --no-fund --ignore-scripts ./dynlabs-react-native-bluetooth-classic-*.tgz

export CI=1
snapshot() {
  cat android/app/src/main/AndroidManifest.xml ios/*/Info.plist | shasum | cut -d' ' -f1
}

npx expo prebuild --no-install
node "$root/scripts/ci/check-expo-prebuild.mjs" "$work"
first=$(snapshot)

npx expo prebuild --no-install
node "$root/scripts/ci/check-expo-prebuild.mjs" "$work"
if [ "$(snapshot)" != "$first" ]; then
  echo "A second expo prebuild changed the manifest or Info.plist" >&2
  exit 1
fi
echo "expo prebuild is idempotent."
