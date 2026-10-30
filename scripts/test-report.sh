#!/usr/bin/env bash
# Runs every automated suite that has its toolchain here and writes
# docs/test-report.md from the results (see scripts/test-report.mjs).
#   yarn test:report
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
args=(--jest "$work/jest.json")

cd "$root"
npx jest --json --outputFile="$work/jest.json" >/dev/null 2>&1

if command -v java >/dev/null 2>&1; then
  (cd example/android && ./gradlew -q :dynlabs_react-native-bluetooth-classic:cleanTestDebugUnitTest \
    :dynlabs_react-native-bluetooth-classic:testDebugUnitTest >/dev/null 2>&1)
  args+=(--android "$root/android/build/test-results/testDebugUnitTest")
fi

if command -v swift >/dev/null 2>&1; then
  (cd ios/Core && swift test --parallel --xunit-output "$work/ios.xml" >/dev/null 2>&1)
  args+=(--ios "$work/ios.xml")
fi

env="$(uname -s), Node $(node --version)"
# JAVA_TOOL_OPTIONS makes the JVM print a "Picked up" line first; it is local setup, not the version.
command -v java >/dev/null 2>&1 && env+=", $(java -version 2>&1 | grep -v '^Picked up' | head -1 | tr -d '"')"
command -v swift >/dev/null 2>&1 && env+=", $(swift --version 2>/dev/null | head -1)"

node scripts/test-report.mjs "${args[@]}" --env "$env"
npx prettier --write docs/test-report.md >/dev/null
