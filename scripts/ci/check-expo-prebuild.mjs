#!/usr/bin/env node
// Checks what `expo prebuild` generated for scripts/ci/expo-fixture: the
// Android manifest and the iOS Info.plist must carry the plugin's entries.
//
//   node scripts/ci/check-expo-prebuild.mjs <fixture app directory>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const app = path.resolve(process.argv[2] ?? '.');
const problems = [];
const expect = (condition, message) => {
  if (!condition) problems.push(message);
};

const manifest = readFileSync(path.join(app, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const permission = (name) =>
  [...manifest.matchAll(/<uses-permission\b[^>]*\/?>/g)]
    .map(([element]) => element)
    .filter((element) => element.includes(`"android.permission.${name}"`));

for (const name of ['BLUETOOTH', 'BLUETOOTH_ADMIN', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION']) {
  const entries = permission(name);
  expect(entries.length === 1, `${name}: expected one entry, found ${entries.length}`);
  expect(entries[0]?.includes('android:maxSdkVersion="30"'), `${name}: expected maxSdkVersion 30`);
}
const scan = permission('BLUETOOTH_SCAN');
expect(scan.length === 1 && scan[0].includes('android:usesPermissionFlags="neverForLocation"'), 'BLUETOOTH_SCAN: expected one entry with neverForLocation');
expect(permission('BLUETOOTH_CONNECT').length === 1, 'BLUETOOTH_CONNECT: expected one entry');
expect(
  (manifest.match(/<uses-feature\b[^>]*android\.hardware\.bluetooth"/g) ?? []).length === 1,
  'uses-feature android.hardware.bluetooth: expected one entry'
);

const iosDir = path.join(app, 'ios');
const project = readdirSync(iosDir).find((entry) => existsSync(path.join(iosDir, entry, 'Info.plist')));
const plist = readFileSync(path.join(iosDir, project, 'Info.plist'), 'utf8');
const array = (key) => {
  const match = plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`));
  return match ? [...match[1].matchAll(/<string>([^<]*)<\/string>/g)].map(([, value]) => value) : null;
};
expect(
  JSON.stringify(array('UISupportedExternalAccessoryProtocols')) === JSON.stringify(['com.acme.serial', 'com.acme.update']),
  `UISupportedExternalAccessoryProtocols: got ${JSON.stringify(array('UISupportedExternalAccessoryProtocols'))}`
);
expect(
  JSON.stringify(array('UIBackgroundModes')) === JSON.stringify(['audio', 'external-accessory']),
  `UIBackgroundModes: got ${JSON.stringify(array('UIBackgroundModes'))}`
);

if (problems.length > 0) {
  console.error(`expo prebuild output is wrong:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('expo prebuild output has the plugin entries.');
