#!/usr/bin/env bash
# Runs the Swift core's XCTest suite (ios/Core) on an iOS simulator, so the
# ExternalAccessory adapters compile and the run-loop tests use real streams.
set -euo pipefail

cd "$(dirname "$0")/../../ios/Core"

# The newest iOS runtime's first available iPhone.
udid=$(xcrun simctl list devices available --json | python3 -c '
import json, re, sys
devices = json.load(sys.stdin)["devices"]
def version(runtime):
    return [int(part) for part in re.findall(r"\d+", runtime.split("iOS-")[-1])]
for runtime in sorted((r for r in devices if ".iOS-" in r), key=version, reverse=True):
    for device in devices[runtime]:
        if device["name"].startswith("iPhone"):
            print(device["udid"])
            sys.exit(0)
sys.exit("No iPhone simulator is available")
')

# Xcode names the scheme after the package when it has more than one target.
scheme=$(xcodebuild -list -json | python3 -c '
import json, sys
schemes = json.load(sys.stdin)["workspace"]["schemes"]
print("BluetoothClassicCore-Package" if "BluetoothClassicCore-Package" in schemes else "BluetoothClassicCore")
')

echo "Testing scheme $scheme on simulator $udid"
xcodebuild test -scheme "$scheme" -destination "platform=iOS Simulator,id=$udid" -quiet
