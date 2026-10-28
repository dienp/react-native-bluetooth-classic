#!/usr/bin/env bash
# Builds a freshly generated React Native app that depends on the packed
# library, to verify the package against a specific React Native version.
#
# Usage: scripts/ci/build-test-app.sh <react-native-version> <android|ios>
set -euo pipefail

RN_VERSION="${1:?react-native version required}"
PLATFORM="${2:?platform (android|ios) required}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK_DIR="${RUNNER_TEMP:-$(mktemp -d)}"
APP_NAME="RNBCTestApp"
TARBALL="$WORK_DIR/react-native-bluetooth-classic.tgz"

cd "$ROOT"
yarn prepare
yarn pack --out "$TARBALL"

cd "$WORK_DIR"
rm -rf "$APP_NAME"
npx --yes @react-native-community/cli@latest init "$APP_NAME" \
  --version "$RN_VERSION" \
  --pm npm \
  --skip-install \
  --skip-git-init \
  --install-pods false

cd "$APP_NAME"
npm install
npm install "$TARBALL"

case "$PLATFORM" in
  android)
    cd android
    ./gradlew assembleDebug --no-daemon --console=plain -PreactNativeArchitectures=arm64-v8a
    ;;
  ios)
    cd ios
    bundle install
    bundle exec pod install
    xcodebuild \
      -workspace "$APP_NAME.xcworkspace" \
      -scheme "$APP_NAME" \
      -configuration Debug \
      -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' \
      CODE_SIGNING_ALLOWED=NO \
      build
    ;;
  *)
    echo "Unknown platform: $PLATFORM" >&2
    exit 1
    ;;
esac
